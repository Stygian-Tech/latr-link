package link.latr

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private fun isLoginWhitespace(value: Char): Boolean = value in '\u0009'..'\u000D' ||
    value in '\u2000'..'\u200A' || value in listOf(' ', '\u00A0', '\u1680', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF')

fun loginHandleSearchQuery(value: String): String? {
    val query = value.trim(::isLoginWhitespace).removePrefix("@")
    return query.takeUnless { it.length < 2 || ':' in it || '/' in it || it.any(::isLoginWhitespace) }
}

@Serializable
data class LoginHandleSuggestion(val did: String, val handle: String, val displayName: String? = null, val avatar: String? = null)
@Serializable
private data class ActorTypeaheadResponse(val actors: List<LoginHandleSuggestion> = emptyList())

fun interface LoginHandleSearch {
    suspend fun search(value: String): List<LoginHandleSuggestion>
}

/** Public directory lookup, independent of OAuth credentials and UI lifecycle. */
class WaowLoginHandleSearch(
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(5, TimeUnit.SECONDS).build(),
    private val endpoint: HttpUrl = "https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead".toHttpUrl(),
) : LoginHandleSearch {
    override suspend fun search(value: String): List<LoginHandleSuggestion> {
        val query = loginHandleSearchQuery(value) ?: return emptyList()
        val url = endpoint.newBuilder().addQueryParameter("q", query).addQueryParameter("limit", "6").build()
        val call = client.newCall(Request.Builder().url(url).build())
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(error)
                }
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        try {
                            if (!response.isSuccessful) throw IOException("Actor typeahead failed (${response.code})")
                            val result = wireJSON.decodeFromString<ActorTypeaheadResponse>(response.body?.string() ?: "{}").actors.take(6)
                            if (continuation.isActive) continuation.resume(result)
                        } catch (error: Exception) {
                            if (continuation.isActive) continuation.resumeWithException(error)
                        }
                    }
                }
            })
        }
    }
}

data class LoginHandleTypeaheadState(
    val suggestions: List<LoginHandleSuggestion> = emptyList(),
    val loading: Boolean = false,
    val failed: Boolean = false,
)

/** Each edit replaces pending debounce/network work and immediately hides stale results. */
class LoginHandleTypeahead(private val scope: CoroutineScope, private val search: LoginHandleSearch) {
    private val mutableState = MutableStateFlow(LoginHandleTypeaheadState())
    val state = mutableState.asStateFlow()
    private var job: Job? = null
    private var generation = 0

    fun clear() {
        generation++
        job?.cancel()
        job = null
        mutableState.value = LoginHandleTypeaheadState()
    }

    fun update(value: String) {
        clear()
        val query = loginHandleSearchQuery(value) ?: return
        val requestGeneration = generation
        job = scope.launch {
            delay(200)
            mutableState.value = LoginHandleTypeaheadState(loading = true)
            try {
                val results = search.search(query)
                ensureActive()
                if (generation == requestGeneration) mutableState.value = LoginHandleTypeaheadState(suggestions = results.take(6))
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (generation == requestGeneration) mutableState.value = LoginHandleTypeaheadState(failed = true)
            }
        }
    }
}
