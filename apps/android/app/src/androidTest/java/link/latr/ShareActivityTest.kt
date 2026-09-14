package link.latr

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ShareActivityTest {
    @Test fun sharedDraftSurvivesActivityRecreation() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val intent = Intent(context, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Read https://example.com/one and https://example.com/two")
        ActivityScenario.launch<ShareActivity>(intent).use { scenario ->
            scenario.recreate()
            scenario.onActivity { activity ->
                val app = activity.application as LatrApplication
                val draft = app.auth.vault.get("share-draft")!!
                assertEquals(listOf("https://example.com/one", "https://example.com/two"), draft.getJSONArray("candidates").strings())
                assertEquals(null, draft.text("subject"))
                app.auth.vault.put("share-draft", null)
            }
        }
    }
    @Test fun invalidRepeatedShareClearsThePreviousDraft() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val valid = Intent(context, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://example.com/previous")
        ActivityScenario.launch<ShareActivity>(valid).use { scenario ->
            scenario.onActivity { activity ->
                val invalid = Intent(activity, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "not a link").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                activity.startActivity(invalid)
            }
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            scenario.onActivity { activity -> assertNull((activity.application as LatrApplication).auth.vault.get("share-draft")) }
        }
    }
}
