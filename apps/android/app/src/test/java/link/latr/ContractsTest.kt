package link.latr

import kotlinx.serialization.encodeToString
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature

class ContractsTest {
    private fun fixture(name: String) = JSONObject(checkNotNull(javaClass.classLoader?.getResourceAsStream(name)).bufferedReader().use { it.readText() })
    @Test fun nativeMetadataAndProofPlansMatchCanonicalContracts() {
        val fixture = fixture("contracts.v1.json")
        assertEquals(fixture.getString("scope"), Contracts.scope)
        val env = fixture.getJSONArray("environments").objects().first { it.getString("name") == BuildConfig.FLAVOR }
        assertEquals(env.getJSONObject("android").getString("client_id"), BuildConfig.CLIENT_METADATA)
        assertEquals(env.getJSONObject("android").getJSONArray("redirect_uris").getString(0), BuildConfig.REDIRECT_URI)
        fixture.getJSONArray("proofPlans").objects().forEach { plan ->
            val expected = plan.getJSONArray("specs").objects().flatMap { List(it.getInt("count")) { _ -> it.getString("httpMethod") to it.getString("xrpcMethod") } }
            assertEquals(plan.getString("nsid"), expected, Contracts.proofPlan(plan.getString("nsid").substringAfterLast('.')))
        }
    }
    @Test fun subjectsPreserveExactEncounteredURLsAndRequireSelectionForSeveral() {
        fixture("behavior.v1.json").getJSONArray("subjectCases").objects().forEach { case -> assertEquals(case.getJSONArray("expected").strings(), Contracts.sharedCandidates(case.getString("input"))) }
    }
    @Test fun decodingPreservesTagsMetadataAndOpaqueCursor() {
        val page = wireJSON.decodeFromString<BookmarkPage>(fixture("behavior.v1.json").getJSONObject("bookmarkPage").toString())
        assertEquals("opaque-next-page", page.cursor)
        val row = Bookmark(wireJSON.encodeToString(page.bookmarks.single()))
        assertTrue(row.archived)
        assertEquals(listOf("News", "news"), row.tags)
        assertEquals("https://example.com/Path?x=1#section", row.subject)
        assertEquals("Articles", row.bucket)
    }
    @Test fun tagsAreExactNotCaseFoldedOrUnicodeNormalized() {
        assertEquals(listOf("News", "news", "e\u0301", "é"), Contracts.tags(listOf(" News ", "News", "news", "e\u0301", "é")))
        assertThrows(IllegalArgumentException::class.java) { Contracts.tags(listOf(" ")) }
        assertThrows(IllegalArgumentException::class.java) { Contracts.tags(List(101) { "tag-$it" }) }
        assertThrows(IllegalArgumentException::class.java) { Contracts.tags(listOf("a".repeat(65))) }
    }
    @Test fun callbackRejectsDuplicatesFragmentsMissingAndMixedResultFields() {
        val redirect = "link.latr:/oauth/android"
        validateCallbackShape("$redirect?code=a&state=b&iss=https%3A%2F%2Fpds.example", redirect)
        listOf("code=a&code=b&state=c&iss=d", "code=a&state=b&state=c&iss=d", "code=a&state=b&iss=d&iss=e", "code=a&state=b&iss=c&error=d", "code=a&state=b", "code=a&state=b&iss=c#fragment", "code=a&state=b&%69ss=c&iss=d").forEach { query -> assertThrows(query, IllegalArgumentException::class.java) { validateCallbackShape("$redirect?$query", redirect) } }
    }
    @Test fun issuerPathsFollowRFC8414() {
        assertEquals("https://example.com/.well-known/oauth-authorization-server/tenant", authorizationMetadataURL("https://example.com/tenant"))
        assertEquals("https://example.com/.well-known/oauth-authorization-server", authorizationMetadataURL("https://example.com"))
    }
    @Test fun pkceMatchesRFC7636Vector() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", sha256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }
    @Test fun proofCanonicalizationRemovesQueryAndFragment() {
        assertEquals("https://example.com/xrpc/a", canonicalProofURL("https://example.com/xrpc/a?x=1#fragment"))
    }
    @Test fun p256SignaturesUseFixedWidthJoseEncoding() {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(java.security.spec.ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        repeat(100) {
            val signed = Signature.getInstance("SHA256withECDSA").apply { initSign(pair.private); update("sample $it".toByteArray()) }.sign()
            assertEquals(64, derToJose(signed).size)
        }
    }
    @Test fun unknownATRecordIsOtherAndBlueskyPostsAreSocial() {
        fun bookmark(subject: String) = Bookmark(JSONObject().put("uri", "at://did:plc:x/community.lexicon.bookmarks.bookmark/a").put("value", JSONObject().put("subject", subject)).toString())
        assertEquals("Other", bookmark("at://did:plc:x/app.example.record/a").bucket)
        assertEquals("Social", bookmark("at://did:plc:x/app.bsky.feed.post/a").bucket)
    }
    @Test fun expandedFeedbackScopesRemainUsable() {
        assertTrue(feedbackScopeAllowed("atproto include:app.userinput.authFull blob:*/*", true))
        assertTrue(feedbackScopeAllowed("atproto repo:app.userinput.discussion?action=create blob:image/*", true))
        assertTrue(feedbackScopeAllowed("repo?collection=app.userinput.discussion&action=create", false))
        assertFalse(feedbackScopeAllowed("repo:app.userinput.discussion?action=delete", false))
        assertFalse(feedbackScopeAllowed("include:app.userinput.authFull", true))
    }
}
