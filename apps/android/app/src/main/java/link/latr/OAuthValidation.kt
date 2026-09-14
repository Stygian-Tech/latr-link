package link.latr

import java.net.URI
import java.net.URLDecoder

fun authorizationMetadataURL(issuer: String): String {
    val uri = URI(issuer)
    require(uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null)
    return "${uri.scheme}://${uri.rawAuthority}/.well-known/oauth-authorization-server${uri.rawPath.trimEnd('/')}"
}
fun validateCallbackShape(callback: String, expected: String) {
    val uri = URI(callback)
    require(uri.rawFragment == null && callback.substringBefore('?') == expected) { "Unexpected OAuth callback." }
    val entries = uri.rawQuery.orEmpty().split('&').filter(String::isNotEmpty).map { URLDecoder.decode(it.substringBefore('='), "UTF-8") }
    require(listOf("state", "iss", "code", "error").all { key -> entries.count { it == key } <= 1 }) { "Duplicate OAuth callback fields." }
    require("state" in entries && "iss" in entries && (("code" in entries) != ("error" in entries))) { "Incomplete OAuth callback." }
}

fun feedbackScopeAllowed(scope: String, photos: Boolean): Boolean {
    val tokens = scope.split(Regex("\\s+")).filter(String::isNotBlank)
    fun parameters(token: String) = token.substringAfter('?', "").split('&').filter(String::isNotBlank).map {
        URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
    }
    fun canCreate(token: String): Boolean {
        val name = token.substringBefore('?')
        if (name == "include:app.userinput.authFull") return true
        val params = parameters(token)
        val collection = name in listOf("repo:app.userinput.discussion", "repo:*") || (name == "repo" && params.any { it.first == "collection" && it.second in listOf("app.userinput.discussion", "*") })
        val actions = params.filter { it.first == "action" }.map { it.second }
        return collection && (actions.isEmpty() || "create" in actions)
    }
    fun canUpload(token: String): Boolean {
        val name = token.substringBefore('?')
        val patterns = if (name.startsWith("blob:")) listOf(name.removePrefix("blob:")) else if (name == "blob") parameters(token).filter { it.first == "accept" }.map { it.second } else emptyList()
        return patterns.any { it in listOf("*/*", "image/*") }
    }
    return tokens.any(::canCreate) && (!photos || tokens.any(::canUpload))
}
