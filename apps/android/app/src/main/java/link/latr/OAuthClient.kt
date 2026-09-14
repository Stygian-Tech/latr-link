package link.latr

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.math.BigInteger
import java.security.*
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

fun base64url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
fun sha256(value: String) = base64url(MessageDigest.getInstance("SHA-256").digest(value.toByteArray()))
fun canonicalProofURL(url: String): String = java.net.URI(url).let { java.net.URI(it.scheme, it.authority, it.path.ifEmpty { "/" }, null, null).toASCIIString() }
fun derToJose(der: ByteArray): ByteArray {
    var offset = 2
    require(der[0] == 0x30.toByte() && der[offset++] == 2.toByte()) { "Invalid ECDSA signature" }
    val rLength = der[offset++].toInt() and 255
    val r = der.copyOfRange(offset, offset + rLength); offset += rLength
    require(der[offset++] == 2.toByte())
    val sLength = der[offset++].toInt() and 255
    val s = der.copyOfRange(offset, offset + sLength)
    fun padded(bytes: ByteArray) = bytes.takeLast(32).toByteArray().let { ByteArray(32 - it.size) + it }
    return padded(r) + padded(s)
}
class SecureVault(context: Context, namespace: String = "oauth-encrypted") {
    private val prefs = context.getSharedPreferences(namespace, Context.MODE_PRIVATE)
    private val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun encryptionKey(): SecretKey {
        (keys.getKey("latr.vault", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("latr.vault", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun put(name: String, value: JSONObject?) {
        if (value == null) { check(prefs.edit().remove(name).commit()); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, encryptionKey()) }
        val payload = cipher.iv + cipher.doFinal(value.toString().toByteArray())
        check(prefs.edit().putString(name, Base64.getEncoder().encodeToString(payload)).commit()) { "Could not securely save session." }
    }
    @Synchronized fun get(name: String): JSONObject? {
        val encoded = prefs.getString(name, null) ?: return null
        val bytes = Base64.getDecoder().decode(encoded)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size))))
    }
    fun createSigningKey(): String {
        val alias = "latr.dpop.${UUID.randomUUID()}"
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
        }.generateKeyPair()
        return alias
    }
    fun deleteKey(alias: String) { if (keys.containsAlias(alias)) keys.deleteEntry(alias) }
    fun proof(alias: String, method: String, url: String, token: String? = null, nonce: String? = null): String {
        val public = keys.getCertificate(alias).publicKey as ECPublicKey
        fun coordinate(value: BigInteger) = base64url(value.toByteArray().takeLast(32).toByteArray().let { ByteArray(32 - it.size) + it })
        val jwk = JSONObject().put("kty", "EC").put("crv", "P-256").put("x", coordinate(public.w.affineX)).put("y", coordinate(public.w.affineY))
        val header = JSONObject().put("typ", "dpop+jwt").put("alg", "ES256").put("jwk", jwk)
        val payload = JSONObject().put("jti", UUID.randomUUID().toString()).put("htm", method).put("htu", canonicalProofURL(url)).put("iat", System.currentTimeMillis() / 1000)
        token?.let { payload.put("ath", sha256(it)) }; nonce?.let { payload.put("nonce", it) }
        val unsigned = base64url(header.toString().toByteArray()) + "." + base64url(payload.toString().toByteArray())
        val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(keys.getKey(alias, null) as PrivateKey); update(unsigned.toByteArray()) }.sign()
        return "$unsigned.${base64url(derToJose(signature))}"
    }
}
class APIError(val status: Int, val code: String, message: String) : Exception(message)
data class HttpResult(val json: JSONObject, val nonce: String?, val status: Int)
class OAuthClient(
    context: Context,
    private val http: OkHttpClient = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).callTimeout(java.time.Duration.ofSeconds(40)).build(),
    vaultNamespace: String = "oauth-encrypted",
) {
    val vault = SecureVault(context, vaultNamespace)
    private val nonces = mutableMapOf<String, String>()
    var session: JSONObject? = runCatching { vault.get("session") }.getOrNull(); private set
    val did get() = session?.text("did")
    val handle get() = session?.text("handle") ?: did.orEmpty()
    private fun origin(url: String) = java.net.URI(url).let { "${it.scheme}://${it.authority}" }
    private fun https(url: String): String {
        val uri = java.net.URI(url)
        require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.fragment == null) { "Server supplied an invalid secure endpoint." }
        return url.trimEnd('/')
    }
    suspend fun request(url: String, method: String = "GET", body: RequestBody? = null, headers: Map<String, String> = emptyMap()): HttpResult = withContext(Dispatchers.IO) {
        https(url)
        val request = Request.Builder().url(url).method(method, body).apply { headers.forEach { (key, value) -> header(key, value) } }.build()
        http.newCall(request).execute().use { response ->
            val data = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(data) }.getOrElse { JSONObject() }
            val nonce = response.header("DPoP-Nonce")
            nonce?.let { synchronized(nonces) { nonces[origin(url)] = it } }
            HttpResult(json, nonce, response.code)
        }
    }
    private fun checked(result: HttpResult): JSONObject {
        if (result.status !in 200..299) throw APIError(result.status, result.json.optString("error"), result.json.text("message") ?: result.json.text("error_description") ?: result.json.text("error") ?: "Request failed (${result.status}).")
        return result.json
    }
    suspend fun publicJSON(url: String) = checked(request(url))
    private suspend fun dpopRequest(alias: String, url: String, method: String, body: RequestBody?, token: String? = null): HttpResult {
        repeat(2) { attempt ->
            val headers = mutableMapOf("DPoP" to vault.proof(alias, method, url, token, synchronized(nonces) { nonces[origin(url)] }))
            token?.let { headers["Authorization"] = "DPoP $it" }
            val result = request(url, method, body, headers)
            if (attempt == 0 && result.status in listOf(400, 401) && result.nonce != null && result.json.optString("error") in listOf("use_dpop_nonce", "invalid_dpop_proof")) return@repeat
            return result
        }
        error("The server did not accept its DPoP nonce. Retry sign in.")
    }
    suspend fun resolveDID(identifier: String): String {
        if (identifier.startsWith("did:plc:") || identifier.startsWith("did:web:")) return identifier
        val result = publicJSON("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${Uri.encode(identifier.trim().removePrefix("@"))}")
        return result.getString("did")
    }
    suspend fun resolvePDS(did: String, expectedHandle: String? = null): String {
        val documentURL = if (did.startsWith("did:plc:")) "https://plc.directory/${Uri.encode(did)}" else {
            require(did.startsWith("did:web:")) { "This DID method is not supported." }
            val parts = did.removePrefix("did:web:").split(':').map { Uri.decode(it) }
            "https://${parts.first()}/${if (parts.size == 1) ".well-known" else parts.drop(1).joinToString("/")}/did.json"
        }
        val document = publicJSON(documentURL)
        require(document.getString("id") == did) { "DID document identity mismatch." }
        expectedHandle?.let {
            require(document.optJSONArray("alsoKnownAs")?.strings()?.any { alias -> alias.equals("at://$it", true) } == true) { "The handle does not match its DID document." }
        }
        val pds = document.getJSONArray("service").objects().firstOrNull { it.optString("type") == "AtprotoPersonalDataServer" && it.optString("id") in listOf("#atproto_pds", "$did#atproto_pds") }?.getString("serviceEndpoint") ?: error("No personal data server was found.")
        return https(pds)
    }
    private suspend fun authority(pds: String): Pair<String, JSONObject> {
        val resource = publicJSON("$pds/.well-known/oauth-protected-resource")
        require(resource.text("resource")?.trimEnd('/') == pds) { "PDS resource metadata mismatch." }
        val issuer = https(resource.getJSONArray("authorization_servers").getString(0))
        val metadata = publicJSON(authorizationMetadataURL(issuer))
        require(metadata.getString("issuer").trimEnd('/') == issuer) { "Authorization issuer mismatch." }
        require(metadata.optBoolean("client_id_metadata_document_supported") && metadata.optJSONArray("code_challenge_methods_supported")?.strings()?.contains("S256") == true && metadata.optJSONArray("dpop_signing_alg_values_supported")?.strings()?.contains("ES256") == true) { "This authorization server does not support required ATProto OAuth features." }
        return issuer to metadata
    }
    suspend fun beginLogin(identifier: String): String {
        val did = resolveDID(identifier.trim())
        val pds = resolvePDS(did, identifier.trim().removePrefix("@").takeUnless { it.startsWith("did:") })
        val (issuer, metadata) = authority(pds)
        runCatching { vault.get("pending-auth")?.text("key")?.let(vault::deleteKey) }
        val alias = vault.createSigningKey()
        val verifier = base64url(ByteArray(32).also(SecureRandom()::nextBytes))
        val state = base64url(ByteArray(32).also(SecureRandom()::nextBytes))
        val pending = JSONObject().put("did", did).put("handle", identifier.trim()).put("pds", pds).put("issuer", issuer).put("tokenEndpoint", https(metadata.getString("token_endpoint"))).put("key", alias).put("verifier", verifier).put("state", state).put("createdAt", System.currentTimeMillis())
        vault.put("pending-auth", pending)
        val form = FormBody.Builder().add("client_id", BuildConfig.CLIENT_METADATA).add("redirect_uri", BuildConfig.REDIRECT_URI).add("response_type", "code").add("scope", Contracts.scope).add("state", state).add("code_challenge_method", "S256").add("code_challenge", sha256(verifier)).add("login_hint", identifier.trim()).build()
        try {
            val result = checked(dpopRequest(alias, https(metadata.getString("pushed_authorization_request_endpoint")), "POST", form))
            return Uri.parse(https(metadata.getString("authorization_endpoint"))).buildUpon().appendQueryParameter("client_id", BuildConfig.CLIENT_METADATA).appendQueryParameter("request_uri", result.getString("request_uri")).build().toString()
        } catch (error: Exception) { vault.put("pending-auth", null); vault.deleteKey(alias); throw error }
    }
    suspend fun completeLogin(callback: Uri) {
        validateCallbackShape(callback.toString(), BuildConfig.REDIRECT_URI)
        val pending = vault.get("pending-auth") ?: run {
            val completed = vault.get("completed-auth")
            if (completed?.text("callbackHash") == sha256(callback.toString()) && completed.text("did") == did) return
            error("This sign-in request has expired. Start again.")
        }
        require(System.currentTimeMillis() - pending.getLong("createdAt") < 10 * 60_000) { "This sign-in request has expired." }
        require(callback.getQueryParameter("state") == pending.getString("state")) { "OAuth state mismatch." }
        require(callback.getQueryParameter("iss")?.trimEnd('/') == pending.getString("issuer")) { "OAuth issuer mismatch." }
        callback.getQueryParameter("error")?.let { error("Sign in was not completed: $it") }
        val code = callback.getQueryParameter("code") ?: error("Missing authorization code.")
        // Claim the one-time authorization transaction before any network suspension.
        vault.put("pending-auth", null)
        val form = FormBody.Builder().add("grant_type", "authorization_code").add("client_id", BuildConfig.CLIENT_METADATA).add("redirect_uri", BuildConfig.REDIRECT_URI).add("code_verifier", pending.getString("verifier")).add("code", code).build()
        val token = checked(dpopRequest(pending.getString("key"), pending.getString("tokenEndpoint"), "POST", form))
        require(token.getString("sub") == pending.getString("did")) { "Authorized account identity mismatch." }
        val verifiedPds = resolvePDS(token.getString("sub"))
        require(authority(verifiedPds).first == pending.getString("issuer")) { "Authorized account issuer mismatch." }
        require(token.getString("scope").split(' ').contains("atproto") && token.optString("token_type").equals("DPoP", true)) { "Invalid OAuth token response." }
        val previous = session?.text("key")
        val established = JSONObject(pending.toString()).removeSecrets().put("pds", verifiedPds)
        storeTokens(established, token)
        vault.put("completed-auth", JSONObject().put("callbackHash", sha256(callback.toString())).put("did", token.getString("sub")))
        vault.put("pending-auth", null)
        if (previous != null && previous != established.getString("key")) vault.deleteKey(previous)
    }
    private fun JSONObject.removeSecrets(): JSONObject { remove("verifier"); remove("state"); remove("createdAt"); return this }
    private fun storeTokens(target: JSONObject, response: JSONObject) {
        target.put("accessToken", response.getString("access_token")).put("expiresAt", System.currentTimeMillis() + response.getLong("expires_in") * 1000)
        response.text("refresh_token")?.let { target.put("refreshToken", it) }
        response.text("scope")?.let { target.put("scope", it) }
        vault.put("session", target); session = target
    }
    suspend fun currentSession(forceRefresh: Boolean = false): JSONObject {
        val current = session ?: error("Sign in to continue.")
        if (forceRefresh || current.getLong("expiresAt") <= System.currentTimeMillis() + 60_000) {
            val refresh = current.text("refreshToken") ?: error("Your session expired. Sign in again.")
            val form = FormBody.Builder().add("grant_type", "refresh_token").add("client_id", BuildConfig.CLIENT_METADATA).add("refresh_token", refresh).build()
            val response = checked(dpopRequest(current.getString("key"), current.getString("tokenEndpoint"), "POST", form))
            require(response.optString("sub", current.getString("did")) == current.getString("did")) { "Refreshed account identity mismatch." }
            require(response.optString("token_type").equals("DPoP", true)) { "Invalid refreshed token type." }
            require(response.optString("scope", current.optString("scope")).split(' ').contains("atproto")) { "Refresh removed required ATProto permission." }
            storeTokens(current, response)
        }
        return session!!
    }
    suspend fun pdsRequest(path: String, method: String = "GET", body: RequestBody? = null): HttpResult {
        var current = currentSession()
        var response = dpopRequest(current.getString("key"), current.getString("pds") + path, method, body, current.getString("accessToken"))
        if (response.status == 401 && response.json.optString("error") != "use_dpop_nonce") {
            current = currentSession(true)
            response = dpopRequest(current.getString("key"), current.getString("pds") + path, method, body, current.getString("accessToken"))
        }
        checked(response)
        return response
    }
    suspend fun gateway(operation: String, method: String = "GET", input: JSONObject? = null, query: Map<String, String> = emptyMap()): JSONObject {
        repeat(2) { attempt ->
            val current = currentSession()
            val url = Uri.parse(BuildConfig.WEB_ORIGIN + "/api/latr-gateway/xrpc/link.latr.bookmarks.$operation").buildUpon().apply { query.forEach { (key, value) -> appendQueryParameter(key, value) } }.build().toString()
            val proofs = Contracts.proofPlan(operation).mapIndexed { index, (verb, xrpc) ->
                val token = current.getString("accessToken")
                val key = current.getString("key")
                val pds = current.getString("pds")
                var nonce: String? = null
                if (index == 0) {
                    val read = dpopRequest(key, "$pds/xrpc/com.atproto.repo.listRecords?repo=${Uri.encode(current.getString("did"))}&collection=${Contracts.collection}&limit=1", "GET", null, token)
                    if (read.status in 200..299) nonce = read.nonce
                }
                if (nonce == null) {
                    // A deliberately invalid body advances the nonce without any repository mutation.
                    val probeMethod = if (verb == "GET") "com.atproto.repo.createRecord" else xrpc
                    val probe = dpopRequest(key, "$pds/xrpc/$probeMethod", "POST", "{}".toRequestBody("application/json".toMediaType()), token)
                    require(probe.status in listOf(200, 400, 422)) { "The PDS could not authorize nonce preparation." }
                    nonce = probe.nonce ?: synchronized(nonces) { nonces[origin(pds)] }
                }
                require(nonce != null) { "The PDS did not provide a DPoP nonce. Retry the save." }
                vault.proof(key, verb, "$pds/xrpc/$xrpc", token, nonce)
            }.joinToString(",")
            val payload = JSONObject(input?.toString() ?: "{}")
            val headers = mutableMapOf("X-Latr-User-Authorization" to "DPoP ${current.getString("accessToken")}", "X-Latr-User-DPoP" to vault.proof(current.getString("key"), method, url, current.getString("accessToken"), synchronized(nonces) { nonces[origin(url)] }))
            if (operation == "migrateLegacy") payload.put("upstreamDpopProof", proofs) else if (proofs.isNotEmpty()) headers["X-ATProto-Upstream-DPoP"] = proofs
            val response = request(url, method, if (method == "GET") null else payload.toString().toRequestBody("application/json".toMediaType()), headers)
            if (attempt == 0 && response.status == 401) {
                if (response.json.optString("error") != "use_dpop_nonce" || response.nonce == null) currentSession(true)
                return@repeat
            }
            val proofError = response.json.toString().lowercase().let { "dpop" in it || "nonce" in it }
            if (attempt == 0 && response.status in listOf(400, 403, 502) && proofError) return@repeat
            return checked(response)
        }
        error("Your session could not be refreshed. Sign in again.")
    }
    fun signOut() {
        session?.text("key")?.let(vault::deleteKey)
        vault.get("pending-auth")?.text("key")?.let(vault::deleteKey)
        vault.put("session", null); vault.put("pending-auth", null); vault.put("completed-auth", null); session = null
        synchronized(nonces) { nonces.clear() }
    }
}
