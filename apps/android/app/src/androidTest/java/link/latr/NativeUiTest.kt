package link.latr

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Drives the real Compose screen through an injected repository; no release demo mode. */
@RunWith(AndroidJUnit4::class)
class NativeUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun nativeLibraryFixtureRenders() {
        val application = ApplicationProvider.getApplicationContext<LatrApplication>()
        val namespace = "ui-fixture-${UUID.randomUUID()}"
        val vault = SecureVault(application, namespace)
        vault.put("session", JSONObject().put("did", "did:plc:fixture").put("handle", "preview.test").put("key", vault.createSigningKey()))
        vault.put("migration-did:plc:fixture", JSONObject().put("complete", true))
        val raw = InstrumentationRegistry.getInstrumentation().context.assets.open("behavior.v1.json").bufferedReader().use { it.readText() }
        val page = JSONObject(raw).getJSONObject("bookmarkPage").apply {
            remove("cursor")
            getJSONArray("bookmarks").getJSONObject(0).apply {
                getJSONObject("metadataRecord").getJSONObject("value").put("state", "unread")
                getJSONObject("preview").remove("image")
            }
        }
        val auth = object : OAuthClient(application, vaultNamespace = namespace) {
            override suspend fun gateway(operation: String, method: String, input: JSONObject?, query: Map<String, String>): JSONObject = when (operation) {
                "listBookmarks" -> page
                "listTags" -> JSONObject("""{"tagCounts":[{"tag":"News","count":1},{"tag":"news","count":1}]}""")
                "syncMetadata" -> JSONObject()
                else -> error("Unexpected fixture operation: $operation")
            }
        }
        val database = Room.inMemoryDatabaseBuilder(application, LibraryDatabase::class.java).build()
        try {
            val model = LibraryViewModel(application, LibraryRepository(auth, database.library()))
            compose.setContent { LatrRoot(model, shareMode = false, onClose = {}) }
            compose.runOnIdle { model.foreground() }
            compose.waitUntil(10_000) { !model.busy && model.rows.isNotEmpty() }
            compose.onNodeWithText("A saved article").assertIsDisplayed()
            compose.onNodeWithText("Saving as preview.test").assertIsDisplayed()
            val size = if (compose.activity.resources.configuration.screenWidthDp >= 600) "tablet" else "phone"
            val destination = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
                ?: application.getExternalFilesDir("qa")!!.absolutePath
            File(destination).mkdirs()
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
                File(destination, "android-library-$size.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
        } finally { auth.signOut(); database.close() }
    }
}
