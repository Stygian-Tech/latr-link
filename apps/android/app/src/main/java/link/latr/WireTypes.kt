package link.latr

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

val wireJSON = Json { ignoreUnknownKeys = true; explicitNulls = false }
@Serializable data class BookmarkValue(
    @SerialName("\$type") val type: String = Contracts.collection,
    val subject: String,
    val createdAt: String,
    val tags: List<String> = emptyList(),
)
@Serializable data class BookmarkWire(val uri: String, val cid: String, val value: BookmarkValue, val metadataRecord: JsonObject? = null, val preview: JsonObject? = null)
@Serializable data class BookmarkPage(val bookmarks: List<BookmarkWire> = emptyList(), val cursor: String? = null)
