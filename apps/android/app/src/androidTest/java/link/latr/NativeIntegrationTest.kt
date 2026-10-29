package link.latr

import android.content.Intent
import android.content.pm.PackageManager
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeIntegrationTest {
    private val context get() = ApplicationProvider.getApplicationContext<android.content.Context>()
    @Test fun shareActivityResolvesPlainText() {
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain").setPackage(context.packageName).putExtra(Intent.EXTRA_TEXT, "https://example.com")
        val activities = context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        assertTrue(activities.any { it.activityInfo.name == ShareActivity::class.java.name })
    }
    @Test fun platformGraphemeSegmentationMatchesContract() {
        val fixture = JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("behavior.v1.json").bufferedReader().use { it.readText() })
        fixture.getJSONArray("tagCases").objects().forEach { case ->
            if (case.optBoolean("error")) assertThrows(IllegalArgumentException::class.java) { Contracts.tags(case.getJSONArray("input").strings(), ::graphemeCount) }
            else assertEquals(case.getJSONArray("expected").strings(), Contracts.tags(case.getJSONArray("input").strings(), ::graphemeCount))
        }
        assertEquals(1, graphemeCount("👨‍👩‍👧‍👦"))
        assertEquals(64, graphemeCount("👨‍👩‍👧‍👦".repeat(64)))
    }
    @Test fun roomQueueSurvivesReopenAndIsIsolatedByAccount() = runBlocking {
        val name = "queue-test-${UUID.randomUUID()}.db"
        var db = Room.databaseBuilder(context, LibraryDatabase::class.java, name).build()
        val first = PendingSave("first", "did:plc:a", "https://example.com/A", "[\"A\"]", 1)
        val second = PendingSave("second", "did:plc:b", "https://example.com/B", "[]", 2)
        try {
            db.library().enqueue(first); db.library().enqueue(second)
            db.close()
            db = Room.databaseBuilder(context, LibraryDatabase::class.java, name).build()
            assertEquals(listOf(first), db.library().pending("did:plc:a"))
            db.library().discard("first", "did:plc:b")
            assertEquals(1, db.library().pending("did:plc:a").size)
            db.library().clearCache("did:plc:a")
            assertEquals(1, db.library().pending("did:plc:a").size)
            db.library().update(first.copy(tags = "[\"A\",\"B\"]"))
            assertEquals("[\"A\",\"B\"]", db.library().pending("did:plc:a").single().tags)
        } finally { db.close(); context.deleteDatabase(name) }
    }
    @Test fun keystoreProofsAreFreshAndBoundToRequest() {
        val vault = SecureVault(context)
        val key = vault.createSigningKey()
        try {
            val first = vault.proof(key, "POST", "https://example.com/xrpc/save?q=1", "token", "nonce")
            val second = vault.proof(key, "POST", "https://example.com/xrpc/save?q=1", "token", "nonce")
            fun payload(jwt: String) = JSONObject(String(java.util.Base64.getUrlDecoder().decode(jwt.split('.')[1])))
            assertNotEquals(payload(first).getString("jti"), payload(second).getString("jti"))
            assertEquals("https://example.com/xrpc/save", payload(first).getString("htu"))
            assertEquals(sha256("token"), payload(first).getString("ath"))
            assertEquals("nonce", payload(first).getString("nonce"))
            assertEquals(64, java.util.Base64.getUrlDecoder().decode(first.split('.')[2]).size)
        } finally { vault.deleteKey(key) }
    }
}
