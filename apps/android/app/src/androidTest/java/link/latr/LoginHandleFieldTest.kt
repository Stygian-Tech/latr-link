package link.latr

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class LoginHandleFieldTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun selectingNativeSuggestionFillsHandleAndDismissesWithoutAnotherLookup() {
        val requests = AtomicInteger()
        val search = LoginHandleSearch {
            requests.incrementAndGet()
            listOf(LoginHandleSuggestion("did:plc:sam", "sam.test", "Sam Example"))
        }
        compose.setContent {
            var handle by remember { mutableStateOf("") }
            MaterialTheme { LoginHandleField(handle, { handle = it }, enabled = true, search = search) }
        }
        compose.onNodeWithTag("login-handle").performTextInput("@sam")
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Sam Example").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("@sam.test").assertIsDisplayed()
        compose.onNodeWithTag("login-suggestion-did:plc:sam").performClick()
        compose.onNodeWithTag("login-handle").assertTextContains("sam.test")
        compose.onNodeWithTag("login-suggestions").assertDoesNotExist()
        assertEquals(1, requests.get())
    }

    @Test fun didInputSkipsSuggestionsAndUnavailableLookupLeavesFieldEditable() {
        val requests = AtomicInteger()
        val search = LoginHandleSearch { requests.incrementAndGet(); throw java.io.IOException("offline") }
        compose.setContent {
            var handle by remember { mutableStateOf("") }
            MaterialTheme { LoginHandleField(handle, { handle = it }, enabled = true, search = search) }
        }
        compose.onNodeWithTag("login-handle").performTextInput("did:plc:account")
        compose.onNodeWithTag("login-suggestions").assertDoesNotExist()
        assertEquals(0, requests.get())
        compose.onNodeWithTag("login-handle").performTextReplacement("sam")
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Suggestions unavailable. You can still enter your handle or DID.").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("login-handle").assertIsEnabled().performTextReplacement("did:plc:manual")
        compose.onNodeWithTag("login-handle").assertTextContains("did:plc:manual")
    }

    @Test fun archiveRestoreAndDeleteHaveDistinctAccessibleActions() {
        var archived = false
        var deleted = false
        compose.setContent {
            var isArchived by remember { mutableStateOf(false) }
            MaterialTheme { BookmarkActions(isArchived, true, { isArchived = !isArchived; archived = isArchived }, {}, { deleted = true }) }
        }
        compose.onNodeWithText("Archive").assertHasClickAction().performClick()
        compose.onNodeWithText("Restore").assertHasClickAction()
        compose.runOnIdle { assertEquals(true, archived); assertEquals(false, deleted) }
        compose.onNodeWithText("Delete").assertHasClickAction().performClick()
        compose.runOnIdle { assertEquals(true, deleted) }
    }
}
