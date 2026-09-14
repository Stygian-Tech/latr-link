package link.latr

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** All HTTP is intercepted in process. These tests never reach a PDS or public board. */
@RunWith(AndroidJUnit4::class)
class TransportIntegrationTest {
    private val context get() = ApplicationProvider.getApplicationContext<android.content.Context>()
    private fun seededAuth(client: OkHttpClient): OAuthClient {
        val namespace = "test-session-${UUID.randomUUID()}"
        val vault = SecureVault(context, namespace)
        vault.put("session", JSONObject().put("did", "did:plc:fixture").put("handle", "fixture.test").put("pds", "https://pds.example").put("issuer", "https://auth.example").put("tokenEndpoint", "https://auth.example/token").put("key", vault.createSigningKey()).put("accessToken", "fixture-access-token").put("refreshToken", "fixture-refresh-token").put("scope", Contracts.scope).put("expiresAt", System.currentTimeMillis() + 3_600_000))
        return OAuthClient(context, client, namespace)
    }
    private fun response(request: okhttp3.Request, json: String, code: Int = 200) = Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("Fixture").header("DPoP-Nonce", "nonce-${UUID.randomUUID()}").body(json.toResponseBody()).build()
    private val saved = """{"uri":"at://did:plc:fixture/community.lexicon.bookmarks.bookmark/a","cid":"bafyfixture","value":{"subject":"https://example.com/A","createdAt":"2026-09-14T00:00:00Z","tags":["News"]}}"""
    @Test fun gatewayMintsOrderedFreshProofsAndDoesNotShipAppCredentials() = runBlocking {
        val requests = mutableListOf<okhttp3.Request>()
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { chain ->
            requests += chain.request()
            response(chain.request(), if (chain.request().url.host == "pds.example") "{\"records\":[]}" else saved)
        }.build())
        try {
            auth.gateway("saveBookmark", "POST", JSONObject().put("subject", "https://example.com/A").put("tags", org.json.JSONArray(listOf("News"))))
            val gateway = requests.last()
            assertEquals(BuildConfig.WEB_ORIGIN.substringAfter("https://"), gateway.url.host)
            assertNull(gateway.header("X-Latr-API-Key"))
            assertNull(gateway.header("X-Latr-Client-Id"))
            val proofs = gateway.header("X-ATProto-Upstream-DPoP")!!.split(',')
            val claims = proofs.map { JSONObject(String(java.util.Base64.getUrlDecoder().decode(it.split('.')[1]))) }
            assertEquals(11, proofs.size)
            assertEquals(11, claims.map { it.getString("jti") }.distinct().size)
            assertEquals(Contracts.proofPlan("saveBookmark").map { it.first }, claims.map { it.getString("htm") })
            assertEquals(Contracts.proofPlan("saveBookmark").map { "https://pds.example/xrpc/${it.second}" }, claims.map { it.getString("htu") })
            assertEquals(12, requests.size)
        } finally { auth.signOut() }
    }
    @Test fun offlineQueuePreservesTagsThenRetriesWithoutDuplication() = runBlocking {
        var offline = true
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { chain ->
            if (offline) throw java.io.IOException("Offline fixture")
            response(chain.request(), if (chain.request().url.host == "pds.example") "{\"records\":[]}" else saved)
        }.build())
        val db = Room.inMemoryDatabaseBuilder(context, LibraryDatabase::class.java).build()
        val repo = LibraryRepository(auth, db.library())
        try {
            repo.enqueue("https://example.com/A", listOf("News"))
            repo.enqueue("https://example.com/A", listOf("News", "Later"))
            assertEquals(1, repo.pending().size)
            assertEquals(listOf("News", "Later"), org.json.JSONArray(repo.pending().single().tags).strings())
            repo.drainQueue()
            assertEquals("Offline fixture", repo.pending().single().error)
            offline = false
            repo.drainQueue()
            assertTrue(repo.pending().isEmpty())
            assertEquals(1, repo.cached().size)
        } finally { auth.signOut(); db.close() }
    }
    @Test fun invalidCallbackDoesNotConsumeValidPendingTransaction() = runBlocking {
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { error("A rejected callback must not perform network requests") }.build())
        val pending = JSONObject().put("state", "expected").put("issuer", "https://auth.example").put("createdAt", System.currentTimeMillis()).put("key", auth.vault.createSigningKey())
        auth.vault.put("pending-auth", pending)
        try {
            try { auth.completeLogin(android.net.Uri.parse("${BuildConfig.REDIRECT_URI}?state=wrong&iss=https%3A%2F%2Fauth.example&code=fixture")); fail("Expected rejection") } catch (_: IllegalArgumentException) { }
            assertEquals("expected", auth.vault.get("pending-auth")!!.getString("state"))
        } finally { auth.signOut() }
    }
    @Test fun feedbackBoardMustMatchCanonicalIdentityBeforeAnyWrite() = runBlocking {
        val requests = mutableListOf<okhttp3.Request>()
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { chain ->
            requests += chain.request()
            response(chain.request(), """{"board":{"uri":"at://did:plc:attacker/app.userinput.space/other","cid":"bafyfixture","value":{"tags":[]}}}""")
        }.build())
        val db = Room.inMemoryDatabaseBuilder(context, LibraryDatabase::class.java).build()
        try {
            try { LibraryRepository(auth, db.library()).feedback("Fixture", "Never public", emptyList(), emptyList()); fail("Expected board rejection") } catch (_: IllegalArgumentException) { }
            assertTrue(requests.all { it.method == "GET" })
        } finally { auth.signOut(); db.close() }
    }
    @Test fun refreshRejectsChangedSubjectAndPersistsValidRotation() = runBlocking {
        var mismatch = true
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { chain ->
            val token = JSONObject().put("sub", if (mismatch) "did:plc:other" else "did:plc:fixture")
                .put("access_token", "rotated-access").put("refresh_token", "rotated-refresh")
                .put("expires_in", 3600).put("token_type", "DPoP").put("scope", Contracts.scope)
            response(chain.request(), token.toString())
        }.build())
        try {
            try { auth.currentSession(true); fail("Expected account rejection") } catch (_: IllegalArgumentException) { }
            assertEquals("fixture-access-token", auth.vault.get("session")!!.getString("accessToken"))
            mismatch = false
            auth.currentSession(true)
            assertEquals("rotated-refresh", auth.vault.get("session")!!.getString("refreshToken"))
            assertEquals("did:plc:fixture", auth.did)
        } finally { auth.signOut() }
    }
    @Test fun discoveryRejectsMismatchedIssuerBeforePAR() = runBlocking {
        val requests = mutableListOf<okhttp3.Request>()
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { chain ->
            requests += chain.request()
            val json = when (chain.request().url.host) {
                "public.api.bsky.app" -> """{"did":"did:plc:fixture"}"""
                "plc.directory" -> """{"id":"did:plc:fixture","alsoKnownAs":["at://fixture.test"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"""
                "pds.example" -> """{"resource":"https://pds.example","authorization_servers":["https://auth.example"]}"""
                else -> """{"issuer":"https://wrong.example"}"""
            }
            response(chain.request(), json)
        }.build())
        try {
            try { auth.beginLogin("fixture.test"); fail("Expected issuer rejection") } catch (_: IllegalArgumentException) { }
            assertTrue(requests.all { it.method == "GET" })
            assertNull(auth.vault.get("pending-auth"))
        } finally { auth.signOut() }
    }
    @Test fun publicFeedbackPayloadAndPhotoStayInsideMockTransport() = runBlocking {
        val requests = mutableListOf<okhttp3.Request>()
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests += request
            val json = when {
                request.url.host == "userinput.app" -> JSONObject().put("board", JSONObject().put("uri", "at://${Contracts.boardDid}/app.userinput.space/${Contracts.boardKey}").put("cid", "bafyboard").put("value", JSONObject().put("tags", org.json.JSONArray()))).toString()
                request.url.encodedPath.endsWith("uploadBlob") -> """{"blob":{"${'$'}type":"blob","ref":{"${'$'}link":"bafyimage"},"mimeType":"image/png","size":3}}"""
                else -> """{"uri":"at://did:plc:fixture/app.userinput.discussion/test","cid":"bafydiscussion"}"""
            }
            response(request, json)
        }.build())
        val db = Room.inMemoryDatabaseBuilder(context, LibraryDatabase::class.java).build()
        try {
            LibraryRepository(auth, db.library()).feedback("Fixture title", "Mock only", emptyList(), listOf(FeedbackPhoto(byteArrayOf(1, 2, 3), "image/png", "Fixture photo")))
            val create = requests.single { it.url.encodedPath.endsWith("createRecord") }
            val buffer = okio.Buffer(); create.body!!.writeTo(buffer)
            val record = JSONObject(buffer.readUtf8()).getJSONObject("record")
            assertEquals("Fixture title", record.getString("title"))
            assertEquals(1, record.getJSONArray("images").length())
            assertEquals("at://${Contracts.boardDid}/app.userinput.space/${Contracts.boardKey}", record.getJSONObject("space").getString("uri"))
            assertTrue(requests.filter { it.method == "POST" }.all { it.header("DPoP") != null && it.url.host == "pds.example" })
            assertTrue(requests.any { it.url.encodedPath.endsWith("putRecord") })
        } finally { auth.signOut(); db.close() }
    }
    @Test fun proxyNonceChallengeRegeneratesProofWithoutRefreshingToken() = runBlocking {
        var calls = 0
        var issuedNonce: String? = null
        val requests = mutableListOf<okhttp3.Request>()
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests += request
            if (request.url.host == "pds.example") response(request, """{"records":[]}""")
            else if (calls++ == 0) response(request, """{"error":"use_dpop_nonce"}""", 401).also { issuedNonce = it.header("DPoP-Nonce") }
            else {
                val proof = request.header("X-Latr-User-DPoP")!!
                val claim = JSONObject(String(java.util.Base64.getUrlDecoder().decode(proof.split('.')[1])))
                assertEquals(issuedNonce, claim.getString("nonce"))
                response(request, """{"tagCounts":[]}""")
            }
        }.build())
        try {
            auth.gateway("listTags")
            assertEquals(2, calls)
            assertTrue(requests.none { it.url.encodedPath == "/token" })
        } finally { auth.signOut() }
    }
    @Test fun migrationConflictsRemainRetryableInsteadOfBeingMarkedComplete() = runBlocking {
        val namespace = "migration-test-${UUID.randomUUID()}"
        val vault = SecureVault(context, namespace)
        vault.put("session", JSONObject().put("did", "did:plc:fixture").put("key", vault.createSigningKey()))
        var conflicts = 1
        val auth = object : OAuthClient(context, vaultNamespace = namespace) {
            override suspend fun gateway(operation: String, method: String, input: JSONObject?, query: Map<String, String>): JSONObject {
                assertEquals("migrateLegacy", operation)
                return JSONObject().put("skippedConflict", conflicts)
            }
        }
        val db = Room.inMemoryDatabaseBuilder(context, LibraryDatabase::class.java).build()
        try {
            val repo = LibraryRepository(auth, db.library())
            try { repo.migrate {}; fail("Expected retryable conflict") } catch (_: IllegalArgumentException) { }
            assertFalse(vault.get("migration-did:plc:fixture")!!.getBoolean("complete"))
            conflicts = 0
            repo.migrate {}
            assertTrue(vault.get("migration-did:plc:fixture")!!.getBoolean("complete"))
        } finally { auth.signOut(); db.close() }
    }
    @Test fun cancellationClearsOnlyTheMatchingPendingTransactionAndPreservesDraft() {
        val auth = seededAuth(OkHttpClient())
        val pendingKey = auth.vault.createSigningKey()
        auth.vault.put("pending-auth", JSONObject().put("state", "pending-state").put("key", pendingKey))
        auth.vault.put("share-draft", JSONObject().put("subject", "https://example.com").put("tags", "News"))
        try {
            auth.cancelPendingLogin("other-state")
            assertNotNull(auth.vault.get("pending-auth"))
            auth.cancelPendingLogin("pending-state")
            assertNull(auth.vault.get("pending-auth"))
            assertEquals("News", auth.vault.get("share-draft")!!.getString("tags"))
        } finally { auth.signOut(); auth.vault.put("share-draft", null) }
    }
    @Test fun feedbackRejectsAccountChangeBeforeUploadingAnything() = runBlocking {
        var calls = 0
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { calls++; error("No request is allowed after the account changes") }.build())
        val db = Room.inMemoryDatabaseBuilder(context, LibraryDatabase::class.java).build()
        try {
            try {
                LibraryRepository(auth, db.library()).feedback("Draft", "Written for another account", emptyList(), listOf(FeedbackPhoto(byteArrayOf(1), "image/png", "Photo")), "did:plc:previous")
                fail("Expected account mismatch")
            } catch (_: IllegalArgumentException) { }
            assertEquals(0, calls)
        } finally { auth.signOut(); db.close() }
    }
    @Test fun refreshMustIncludeTheAccountSubject() = runBlocking {
        val auth = seededAuth(OkHttpClient.Builder().addInterceptor { chain -> response(chain.request(), """{"access_token":"rotated","refresh_token":"rotated","expires_in":3600,"token_type":"DPoP"}""") }.build())
        try {
            try { auth.currentSession(true); fail("Expected missing-sub rejection") } catch (_: org.json.JSONException) { }
            assertEquals("fixture-access-token", auth.vault.get("session")!!.getString("accessToken"))
        } finally { auth.signOut() }
    }
}
