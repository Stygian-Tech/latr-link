package link.latr

import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

object Contracts {
    const val scope = "atproto repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete include:link.latr.authFull repo:link.latr.saved.external?action=delete repo:link.latr.saved.item?action=delete repo:com.latr.saved.external?action=delete repo:com.latr.saved.item?action=delete include:app.userinput.authFull blob:*/*"
    const val collection = "community.lexicon.bookmarks.bookmark"
    const val boardDid = "did:plc:qy5pluw2bsuq2x6albsgkvx3"
    const val boardKey = "3msgeiqdplp2m"
    const val boardURL = "https://userinput.app/s/$boardDid/$boardKey?lang=en"
    fun subject(input: String): String {
        val value = input.trim()
        require(value.length <= 16_384) { "This link is too long." }
        val uri = runCatching { URI(value) }.getOrNull()
        require(uri != null && when (uri.scheme?.lowercase()) {
            "http", "https" -> !uri.host.isNullOrBlank() && uri.userInfo == null
            "at" -> !uri.rawAuthority.isNullOrBlank() && uri.path.split('/').filter(String::isNotEmpty).size == 2
            else -> false
        }) { "Enter an HTTP(S) link or AT URI." }
        return value
    }
    fun sharedCandidates(text: String): List<String> {
        runCatching { return listOf(subject(text)) }
        return Regex("(?:https?://|at://)[^\\s<>]+", RegexOption.IGNORE_CASE).findAll(text)
            .map { it.value.trimEnd('.', ',', ')', ']', '}', '!') }
            .filter { runCatching { subject(it) }.isSuccess }.distinct().toList()
    }
    fun sharedSubject(text: String): String {
        val matches = sharedCandidates(text)
        require(matches.size == 1) { if (matches.isEmpty()) "No supported link was shared." else "Several links were shared. Choose one link to save." }
        return matches.single()
    }
    fun tags(values: List<String>, graphemes: (String) -> Int = { it.codePointCount(0, it.length) }): List<String> {
        val result = values.map(String::trim).onEach {
            require(it.isNotEmpty()) { "Tags cannot be empty." }
            require(graphemes(it) <= 64 && it.toByteArray(Charsets.UTF_8).size <= 640) { "Tags must fit 64 characters and 640 UTF-8 bytes." }
        }.distinct()
        require(result.size <= 100) { "Bookmarks can have at most 100 tags." }
        return result
    }
    fun authoredTags(text: String) = tags(text.split(',').map(String::trim).filter(String::isNotEmpty), ::graphemeCount)
    fun proofPlan(operation: String): List<Pair<String, String>> {
        fun get(name: String, count: Int) = List(count) { "GET" to "com.atproto.repo.$name" }
        fun write(count: Int = 1) = List(count) { "POST" to "com.atproto.repo.applyWrites" }
        return when (operation) {
            "listBookmarks" -> get("listRecords", 9)
            "listTags" -> get("listRecords", 1)
            "getBookmark" -> get("listRecords", 8) + get("getRecord", 1)
            "saveBookmark" -> get("listRecords", 8) + get("getRecord", 2) + write()
            "setTags" -> get("getRecord", 3) + write()
            "setState", "deleteBookmark" -> get("getRecord", 2) + write()
            "renameTag", "deleteTag" -> get("listRecords", 1) + write()
            "syncMetadata" -> get("listRecords", 9) + write()
            "migrateLegacy" -> get("listRecords", 40) + get("getRecord", 25) + write(25)
            else -> emptyList()
        }
    }
}
fun graphemeCount(value: String): Int {
    val iterator = android.icu.text.BreakIterator.getCharacterInstance(java.util.Locale.ROOT)
    iterator.setText(value)
    var count = 0
    while (iterator.next() != android.icu.text.BreakIterator.DONE) count++
    return count
}
fun JSONArray.strings() = (0 until length()).map { getString(it) }
fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }
fun JSONObject.text(key: String) = optString(key).takeUnless { it.isBlank() || it == "null" }

data class Bookmark(val json: String) {
    private val record get() = JSONObject(json)
    val uri get() = record.getString("uri")
    val cid get() = record.optString("cid")
    val subject get() = record.getJSONObject("value").getString("subject")
    val archivedAt get() = record.text("_archivedAt")
    val readingMinutes get() = (kotlin.math.round((title + " " + description).length / 140.0).toInt() + 2).coerceIn(2, 12)
    val createdAt get() = record.getJSONObject("value").optString("createdAt")
    val tags get() = record.getJSONObject("value").optJSONArray("tags")?.strings().orEmpty()
    val archived get() = record.optJSONObject("metadataRecord")?.optJSONObject("value")?.optString("state") == "archived"
    private val preview get() = record.optJSONObject("preview") ?: JSONObject()
    val title get() = preview.text("title") ?: subject
    val description get() = preview.text("description").orEmpty()
    val image get() = preview.text("image")
    val author get() = preview.text("author")
    val site get() = preview.text("siteName") ?: runCatching { URI(subject).host }.getOrNull().orEmpty()
    val bucket get(): String {
        if (subject.contains("/app.bsky.feed.post/") || Regex("https?://(?:www\\.)?bsky.app/profile/[^/]+/post/[^/]+").containsMatchIn(subject)) return "Social"
        val path = runCatching { URI(subject).path.orEmpty() }.getOrDefault("")
        if (listOf("standard.site", "site.standard", "whtwnd.blog", "blog.entry", ".article/").any(subject::contains)) return "Articles"
        if (title != subject && !title.lowercase().startsWith("saved from ") && (author != null || path.split('/').filter(String::isNotEmpty).size > 1 || path.substringAfterLast('/').let { '-' in it || it.length > 18 })) return "Articles"
        return "Other"
    }
}

fun readBounded(input: java.io.InputStream, maximum: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val count = input.read(buffer, 0, minOf(buffer.size, maximum + 1 - output.size()))
        if (count == -1) break
        output.write(buffer, 0, count)
        require(output.size() <= maximum) { "Each photo must be smaller than 5 MB." }
    }
    return output.toByteArray()
}
