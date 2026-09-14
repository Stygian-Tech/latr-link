package link.latr

import android.net.Uri
import kotlinx.serialization.encodeToString
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

data class FeedbackPhoto(val bytes: ByteArray, val mime: String, val alt: String)
data class TagCount(val tag: String, val count: Int)
class LibraryRepository(val auth: OAuthClient, private val dao: LibraryDao) {
    // Token rotation, nonce generation, queue draining and interactive mutations share one session lock.
    val mutex = Mutex()
    private fun did() = auth.did ?: error("Sign in to continue.")
    suspend fun cached(): List<Bookmark> = auth.did?.let { dao.bookmarks(it).map { row -> Bookmark(row.json) } }.orEmpty()
    suspend fun pending(): List<PendingSave> = auth.did?.let { dao.pending(it) }.orEmpty()
    suspend fun enqueue(subject: String, tags: List<String>, expectedDID: String = did()) = mutex.withLock {
        val account = did()
        require(account == expectedDID) { "The signed-in account changed. Review the save again." }
        val exactSubject = Contracts.subject(subject)
        val existing = dao.pendingSubject(account, exactSubject)
        val combined = Contracts.tags(existing?.let { JSONArray(it.tags).strings() }.orEmpty() + tags, ::graphemeCount)
        dao.enqueue(PendingSave(existing?.id ?: UUID.randomUUID().toString(), account, exactSubject, JSONArray(combined).toString(), existing?.createdAt ?: System.currentTimeMillis()))
    }
    suspend fun editPending(item: PendingSave, subject: String, tags: List<String>) = mutex.withLock {
        require(item.did == did()) { "This save belongs to a different account." }
        val exact = Contracts.subject(subject)
        val collision = dao.pendingSubject(item.did, exact)
        require(collision == null || collision.id == item.id) { "This link is already queued. Edit that pending save instead." }
        dao.update(item.copy(subject = exact, tags = JSONArray(tags).toString(), error = null))
    }
    suspend fun discard(id: String) = mutex.withLock { dao.discard(id, did()) }
    suspend fun drainQueue(onProgress: suspend () -> Unit = {}) = mutex.withLock {
        val account = did()
        for (item in dao.pending(account)) {
            if (auth.did != account) break
            try {
                val saved = auth.gateway("saveBookmark", "POST", JSONObject().put("subject", item.subject).put("tags", JSONArray(item.tags)))
                val bookmark = Bookmark(saved.toString())
                dao.cache(listOf(CachedBookmark(account, bookmark.uri, bookmark.json)))
                dao.discard(item.id, account)
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                dao.pendingError(item.id, error.message ?: "Save failed. Retry when connected.")
                onProgress()
                // Retain failed items, including the exact subject and tags, until successful retry or explicit removal.
                break
            }
            onProgress()
        }
    }
    suspend fun page(cursor: String? = null): Pair<List<Bookmark>, String?> = mutex.withLock {
        val account = did()
        val input = JSONObject().put("limit", 50).apply { cursor?.let { put("cursor", it) } }
        try { auth.gateway("syncMetadata", "POST", input) } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error }
        val raw = auth.gateway("listBookmarks", query = buildMap { put("limit", "50"); cursor?.let { put("cursor", it) } })
        val page = wireJSON.decodeFromString<BookmarkPage>(raw.toString())
        val localArchive = auth.vault.get("archive-times-$account") ?: JSONObject()
        val rows = page.bookmarks.map {
            val json = JSONObject(wireJSON.encodeToString(it))
            localArchive.text(it.uri)?.let { time -> json.put("_archivedAt", time) }
            Bookmark(json.toString())
        }
        dao.cache(rows.map { CachedBookmark(account, it.uri, it.json) })
        rows to page.cursor
    }
    private suspend fun allPages(onPage: suspend (List<Bookmark>) -> Unit = {}): Pair<String, List<Bookmark>> = mutex.withLock {
        val account = did()
        val accumulated = linkedMapOf<String, Bookmark>()
        val seen = mutableSetOf<String>()
        var cursor: String? = null
        do {
            val options = JSONObject().put("limit", 50).apply { cursor?.let { put("cursor", it) } }
            try { auth.gateway("syncMetadata", "POST", options) } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error }
            val page = auth.gateway("listBookmarks", query = buildMap { put("limit", "50"); cursor?.let { put("cursor", it) } })
            val rows = page.optJSONArray("bookmarks")?.objects().orEmpty().map { Bookmark(it.toString()) }
            rows.forEach { accumulated[it.uri] = it }
            dao.cache(rows.map { CachedBookmark(account, it.uri, it.json) })
            onPage(accumulated.values.toList())
            cursor = page.text("cursor")
            require(cursor == null || seen.add(cursor)) { "The server repeated a library cursor." }
        } while (cursor != null)
        dao.replaceCache(account, accumulated.values.map { CachedBookmark(account, it.uri, it.json) })
        account to accumulated.values.toList()
    }
    suspend fun tags(): List<TagCount> = mutex.withLock { completeTags() }
    private suspend fun completeTags(): List<TagCount> {
        val counts = mutableMapOf<String, Int>()
        var cursor: String? = null
        val seen = mutableSetOf<String>()
        do {
            val response = auth.gateway("listTags", query = buildMap { put("limit", "100"); cursor?.let { put("cursor", it) } })
            response.optJSONArray("tagCounts")?.objects()?.forEach { counts.merge(it.getString("tag"), it.getInt("count"), Int::plus) }
            cursor = response.text("cursor")
            require(cursor == null || seen.add(cursor)) { "The server repeated a tag cursor." }
        } while (cursor != null)
        return counts.toSortedMap().map { TagCount(it.key, it.value) }
    }
    private fun requireOwnBookmark(bookmark: Bookmark) {
        require(java.net.URI(bookmark.uri).rawAuthority == did()) { "The account changed. Reload the library before editing this bookmark." }
    }
    suspend fun changeState(bookmark: Bookmark) = mutex.withLock {
        requireOwnBookmark(bookmark)
        val updated = auth.gateway("setState", "PATCH", JSONObject().put("bookmarkUri", bookmark.uri).put("state", if (bookmark.archived) "unread" else "archived"))
        val key = "archive-times-${did()}"
        val times = auth.vault.get(key) ?: JSONObject()
        if (bookmark.archived) times.remove(bookmark.uri) else times.put(bookmark.uri, Instant.now().toString())
        auth.vault.put(key, times)
        if (updated.has("uri")) dao.cache(listOf(CachedBookmark(did(), bookmark.uri, updated.toString())))
    }
    suspend fun setTags(bookmark: Bookmark, tags: List<String>) = mutex.withLock {
        requireOwnBookmark(bookmark)
        val updated = auth.gateway("setTags", "POST", JSONObject().put("bookmarkUri", bookmark.uri).put("tags", JSONArray(tags)))
        dao.cache(listOf(CachedBookmark(did(), bookmark.uri, updated.toString())))
    }
    suspend fun remove(bookmark: Bookmark) = mutex.withLock {
        requireOwnBookmark(bookmark)
        auth.gateway("deleteBookmark", "POST", JSONObject().put("bookmarkUri", bookmark.uri))
        dao.remove(did(), bookmark.uri)
    }
    suspend fun bulkTag(tag: String, replacement: String?, expectedDID: String = did(), progress: (String) -> Unit) = mutex.withLock {
        require(expectedDID == did()) { "The account changed. Review this tag operation again." }
        val key = "bulk-tag-${did()}"
        val prior = auth.vault.get(key)
        var state = if (prior?.text("tag") == tag && prior.text("replacement") == replacement) prior else JSONObject().put("tag", tag).apply { replacement?.let { put("replacement", it) } }.put("updated", 0).put("pass", 1)
        var pass = state.optInt("pass", 1)
        while (pass <= 3) {
            var cursor = state.text("cursor")
            val seen = mutableSetOf<String>()
            do {
                val input = JSONObject().put("tag", tag).put("limit", 25).apply { replacement?.let { put("replacement", it) }; cursor?.let { put("cursor", it) } }
                auth.vault.put(key, state)
                val op = if (replacement == null) "deleteTag" else "renameTag"
                val response = try { auth.gateway(op, "POST", input) } catch (error: APIError) { if (error.status == 409) auth.gateway(op, "POST", input) else throw error }
                cursor = response.text("cursor")
                require(cursor == null || seen.add(cursor)) { "The server repeated a tag cursor." }
                state.put("updated", state.optInt("updated") + response.optInt("updated")); state.remove("cursor"); cursor?.let { state.put("cursor", it) }
                auth.vault.put(key, state)
                progress("Updated ${state.optInt("updated")} bookmarks · pass $pass")
            } while (cursor != null)
            if (completeTags().none { it.tag == tag && it.count > 0 }) { auth.vault.put(key, null); return@withLock }
            pass++; state.put("pass", pass)
        }
        state.put("pass", 1); auth.vault.put(key, state)
        error("Concurrent changes reintroduced this tag. Retry when edits have settled.")
    }
    suspend fun migrate(expectedDID: String = did(), progress: (String) -> Unit) = mutex.withLock {
        require(expectedDID == did()) { "The account changed. Review migration again." }
        val key = "migration-${did()}"
        var state = auth.vault.get(key) ?: JSONObject()
        var cursor = state.text("cursor")
        var conflicts = if (cursor == null) 0 else state.optInt("skippedConflict")
        val seen = mutableSetOf<String>()
        do {
            val input = JSONObject().put("limit", 25).apply { cursor?.let { put("cursor", it) } }
            val response = auth.gateway("migrateLegacy", "POST", input)
            cursor = response.text("cursor")
            require(cursor == null || seen.add(cursor)) { "The server repeated a migration cursor." }
            conflicts += response.optInt("skippedConflict")
            state = JSONObject().put("complete", cursor == null && conflicts == 0).put("skippedConflict", conflicts).apply { cursor?.let { put("cursor", it) } }
            auth.vault.put(key, state)
            progress(if (cursor == null && conflicts == 0) "Migration complete." else "Migrating another batch…")
        } while (cursor != null)
        require(conflicts == 0) { "Migration retained $conflicts conflicting records. Run migration again after concurrent edits settle." }
    }
    suspend fun clearCache() = mutex.withLock { dao.clearCache(did()) }
    suspend fun exportJSON(): String {
        val (account, rows) = allPages()
        return JSONObject().put("exportedAt", Instant.now().toString()).put("did", account).put("savedItems", JSONArray(rows.map { val item = JSONObject(it.json); JSONObject().put("uri", item.getString("uri")).put("cid", item.getString("cid")).put("value", item.getJSONObject("value")) })).toString(2)
    }
    fun needsMigration() = auth.did?.let { auth.vault.get("migration-$it")?.optBoolean("complete") != true } ?: false
    suspend fun resolveReadingURL(subject: String): String? {
        if (subject.startsWith("https://") || subject.startsWith("http://")) return subject
        val uri = java.net.URI(Contracts.subject(subject))
        val parts = uri.path.split('/')
        val owner = auth.resolveDID(uri.rawAuthority)
        if (parts[1] == "app.bsky.feed.post") return "https://bsky.app/profile/$owner/post/${parts[2]}"
        val pds = auth.resolvePDS(owner)
        val record = auth.publicJSON("$pds/xrpc/com.atproto.repo.getRecord?repo=${Uri.encode(owner)}&collection=${Uri.encode(parts[1])}&rkey=${Uri.encode(parts[2])}").getJSONObject("value")
        if (record.optString("\$type") in listOf("link.latr.saved.external", "com.latr.saved.external")) {
            val link = record.text("normalizedUrl") ?: record.text("url") ?: return null
            if (runCatching { Contracts.subject(link) }.isSuccess && (link.startsWith("https://") || link.startsWith("http://"))) return link
        }
        return null
    }
    suspend fun feedback(title: String, body: String, tags: List<String>, photos: List<FeedbackPhoto>, expectedDID: String = did()): String = mutex.withLock {
        require(expectedDID == did()) { "The signed-in account changed. Review your public feedback again." }
        require(title.trim().isNotEmpty() && title.length <= 200 && body.length <= 10_000 && photos.size <= 4) { "Feedback requires a title up to 200 characters, details up to 10,000 characters, and at most four photos." }
        val scope = auth.currentSession().optString("scope")
        require(feedbackScopeAllowed(scope, photos.isNotEmpty())) { "Sign in again to grant feedback permissions." }
        val board = auth.publicJSON("https://userinput.app/api/board/${Contracts.boardDid}/${Contracts.boardKey}").getJSONObject("board")
        require(board.getString("uri") == "at://${Contracts.boardDid}/app.userinput.space/${Contracts.boardKey}") { "Feedback board identity mismatch." }
        val allowed = board.optJSONObject("value")?.optJSONArray("tags")?.objects()?.map { it.getString("value") }.orEmpty()
        require(tags.all { it in allowed }) { "The board's feedback tags changed. Try again." }
        val images = JSONArray()
        for (photo in photos) {
            require(photo.mime.startsWith("image/") && photo.bytes.size <= 5 * 1024 * 1024) { "Each photo must be an image smaller than 5 MB." }
            val blob = auth.pdsRequest("/xrpc/com.atproto.repo.uploadBlob", "POST", photo.bytes.toRequestBody(photo.mime.toMediaType())).json.getJSONObject("blob")
            images.put(JSONObject().put("image", blob).put("alt", photo.alt))
        }
        val created = Instant.now().toString()
        val record = JSONObject().put("\$type", "app.userinput.discussion").put("space", JSONObject().put("uri", board.getString("uri")).put("cid", board.getString("cid"))).put("title", title.trim()).put("createdAt", created)
        if (body.isNotBlank()) record.put("body", body.trim())
        if (tags.isNotEmpty()) record.put("tags", JSONArray(tags))
        if (images.length() > 0) record.put("images", images)
        val request = JSONObject().put("repo", did()).put("collection", "app.userinput.discussion").put("record", record)
        val response = auth.pdsRequest("/xrpc/com.atproto.repo.createRecord", "POST", request.toString().toRequestBody("application/json".toMediaType())).json
        val ref = JSONObject().put("uri", response.getString("uri")).put("cid", response.getString("cid"))
        val upvote = JSONObject().put("repo", did()).put("collection", "app.userinput.upvote").put("rkey", response.getString("uri").substringAfterLast('/')).put("record", JSONObject().put("\$type", "app.userinput.upvote").put("subject", ref).put("createdAt", created))
        try { auth.pdsRequest("/xrpc/com.atproto.repo.putRecord", "POST", upvote.toString().toRequestBody("application/json".toMediaType())) } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error }
        "https://userinput.app/d/${did()}/${response.getString("uri").substringAfterLast('/')}"
    }
}
