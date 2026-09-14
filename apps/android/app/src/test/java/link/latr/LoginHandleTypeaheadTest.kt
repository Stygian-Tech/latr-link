package link.latr

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@OptIn(ExperimentalCoroutinesApi::class)
class LoginHandleTypeaheadTest {
    @Test fun queryMatchesWebNormalizationAndExclusions() {
        assertEquals("sam", loginHandleSearchQuery("  @sam  "))
        assertEquals("sam", loginHandleSearchQuery("\uFEFF@sam\uFEFF"))
        listOf("", "@a", "did:plc:abc", "https://example.com", "two words", "ab\tcd", "ab\u00A0cd", "ab\uFEFFcd").forEach { assertNull(it, loginHandleSearchQuery(it)) }
    }

    @Test fun lookupEncodesQueryAndLimitWithoutOAuthHeaders() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"actors":[{"did":"did:plc:one","handle":"sam.test","displayName":"Sam","avatar":"https://example.com/avatar.png","extra":true}]}"""))
            val search = WaowLoginHandleSearch(endpoint = server.url("/xrpc/app.bsky.actor.searchActorsTypeahead"))
            assertTrue(search.search("did:plc:no-request").isEmpty())
            val result = search.search(" @sam ").single()
            assertEquals("Sam", result.displayName)
            assertEquals("https://example.com/avatar.png", result.avatar)
            val request = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("sam", request.requestUrl!!.queryParameter("q"))
            assertEquals("6", request.requestUrl!!.queryParameter("limit"))
            assertNull(request.getHeader("Authorization"))
            assertNull(request.getHeader("DPoP"))
            assertEquals(1, server.requestCount)
        }
    }

    @Test fun cancellationCancelsUnderlyingHttpCall() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val cancelled = AtomicBoolean()
            val client = OkHttpClient.Builder().eventListener(object : EventListener() {
                override fun canceled(call: Call) { cancelled.set(true) }
            }).build()
            val search = WaowLoginHandleSearch(client, server.url("/search"))
            val request = launch(Dispatchers.Default) { search.search("sam") }
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            request.cancelAndJoin()
            assertTrue(cancelled.get())
        }
    }

    @Test fun debounceCancelsSupersededQueriesAndInvalidInputClearsResults() = runTest {
        val queries = mutableListOf<String>()
        val typeahead = LoginHandleTypeahead(backgroundScope, LoginHandleSearch { query ->
            queries += query
            listOf(LoginHandleSuggestion("did:plc:one", "$query.test"))
        })
        typeahead.update("sa")
        advanceTimeBy(199); runCurrent()
        assertTrue(queries.isEmpty())
        typeahead.update("sam")
        advanceTimeBy(199); runCurrent()
        assertTrue(queries.isEmpty())
        advanceTimeBy(1); runCurrent()
        assertEquals(listOf("sam"), queries)
        assertEquals("sam.test", typeahead.state.value.suggestions.single().handle)
        typeahead.update("did:plc:sam")
        assertTrue(typeahead.state.value.suggestions.isEmpty())
        advanceTimeBy(500); runCurrent()
        assertEquals(1, queries.size)
    }

    @Test fun canceledLookupCannotPublishLateResultsAndSelectionClearCancels() = runTest {
        val stale = CompletableDeferred<List<LoginHandleSuggestion>>()
        val typeahead = LoginHandleTypeahead(backgroundScope, LoginHandleSearch { query ->
            if (query == "old") withContext(NonCancellable) { stale.await() }
            else listOf(LoginHandleSuggestion("did:plc:new", "new.test"))
        })
        typeahead.update("old"); advanceTimeBy(200); runCurrent()
        typeahead.update("new"); advanceTimeBy(200); runCurrent()
        stale.complete(listOf(LoginHandleSuggestion("did:plc:old", "old.test"))); runCurrent()
        assertEquals("new.test", typeahead.state.value.suggestions.single().handle)
        typeahead.clear()
        assertEquals(LoginHandleTypeaheadState(), typeahead.state.value)
    }

    @Test fun lookupFailuresPreserveManualLoginAndClearOnNextEdit() = runTest {
        val typeahead = LoginHandleTypeahead(backgroundScope, LoginHandleSearch { throw java.io.IOException("offline") })
        typeahead.update("sam"); advanceTimeBy(200); runCurrent()
        assertTrue(typeahead.state.value.failed)
        assertFalse(typeahead.state.value.loading)
        typeahead.update("s")
        assertEquals(LoginHandleTypeaheadState(), typeahead.state.value)
    }
}
