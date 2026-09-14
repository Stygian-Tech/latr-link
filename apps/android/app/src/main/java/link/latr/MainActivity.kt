package link.latr

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Bookmarks
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONArray

class LibraryViewModel(application: android.app.Application, val repository: LibraryRepository) : AndroidViewModel(application) {
    constructor(application: android.app.Application) : this(application, (application as LatrApplication).repository)
    val app = application as LatrApplication
    var did by mutableStateOf(repository.auth.did); private set
    var rows by mutableStateOf<List<Bookmark>>(emptyList()); private set
    var pending by mutableStateOf<List<PendingSave>>(emptyList()); private set
    var tags by mutableStateOf<List<TagCount>>(emptyList()); private set
    var busy by mutableStateOf(false); private set
    var message by mutableStateOf<String?>(null)
    var shared by mutableStateOf(repository.auth.vault.get("share-draft")?.text("subject").orEmpty())
    var draftTags by mutableStateOf(repository.auth.vault.get("share-draft")?.text("tags").orEmpty())
    var candidates by mutableStateOf(repository.auth.vault.get("share-draft")?.optJSONArray("candidates")?.strings().orEmpty())
    var nextCursor by mutableStateOf<String?>(null); private set
    private val pageCursors = mutableSetOf<String>()
    private val attemptedMigrations = mutableSetOf<String>()
    private suspend fun migrateAfterLibrary() {
        val account = repository.auth.did ?: return
        if (!repository.needsMigration() || !attemptedMigrations.add(account)) return
        try {
            message = "Checking legacy bookmarks…"
            repository.migrate(account) { message = it }
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            message = "Legacy migration needs a retry in Settings: ${error.message}"
        }
    }
    fun cancelLogin() {
        val state = repository.auth.vault.get("pending-auth")?.text("state") ?: return
        viewModelScope.launch {
            // Give the Custom Tabs fallback's delivered Intent a chance to claim its transaction.
            delay(400)
            repository.mutex.withLock { repository.auth.cancelPendingLogin(state) }
            if (repository.auth.did == null) message = "Sign in canceled. Your draft is preserved."
        }
    }
    fun action(block: suspend () -> Unit) {
        if (busy) return
        viewModelScope.launch {
            busy = true
            message = null
            try {
                require(did == repository.auth.did) { "The signed-in account changed. Reload this screen and review the action again." }
                block()
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                message = error.message ?: "The operation failed. Please retry."
            } finally {
                if (did != repository.auth.did) { rows = emptyList(); pending = emptyList(); tags = emptyList(); nextCursor = null }
                did = repository.auth.did
                busy = false
            }
        }
    }
    private suspend fun local() {
        val account = repository.auth.did
        val cached = repository.cached()
        val queued = repository.pending()
        if (repository.auth.did == account) { rows = cached; pending = queued; did = account }
    }
    fun updateDraft(subject: String, tags: String) {
        shared = subject
        draftTags = tags
        repository.auth.vault.put("share-draft", JSONObject().put("subject", subject).put("tags", tags).put("candidates", JSONArray(candidates)))
    }
    private suspend fun refresh() {
        val account = repository.auth.did
        local()
        if (repository.auth.did == null) return
        repository.drainQueue { if (account == repository.auth.did) pending = repository.pending() }
        if (account != repository.auth.did) return
        pending = repository.pending()
        val page = repository.page()
        if (account != repository.auth.did) return
        rows = page.first
        nextCursor = page.second
        pageCursors.clear()
        page.second?.let(pageCursors::add)
        val inventory = repository.tags()
        if (account == repository.auth.did) tags = inventory
    }
    fun more() = action {
        val account = repository.auth.did
        val cursor = nextCursor ?: return@action
        val page = repository.page(cursor)
        if (account != repository.auth.did) return@action
        require(page.second == null || pageCursors.add(page.second!!)) { "The server repeated a library cursor." }
        rows = (rows + page.first).distinctBy { it.uri }
        nextCursor = page.second
    }
    fun editPending(item: PendingSave, subject: String, tags: String, done: () -> Unit) = action {
        repository.editPending(item, subject, Contracts.authoredTags(tags)); pending = repository.pending(); done()
    }
    fun shareForeground() {
        if (repository.auth.did != null && !busy) action { local(); repository.drainQueue { pending = repository.pending() }; local() }
    }
    fun foreground() { if (repository.auth.did != null && !busy && repository.auth.vault.get("pending-auth") == null) action { refresh(); migrateAfterLibrary() } }
    fun login(handle: String, open: (String) -> Unit) = action {
        val url = repository.mutex.withLock { repository.auth.beginLogin(handle) }
        open(url)
    }
    fun callback(uri: Uri) {
        // OAuth callbacks are never discarded because another screen is refreshing.
        viewModelScope.launch {
            busy = true
            try {
                repository.mutex.withLock { repository.auth.completeLogin(uri) }
                did = repository.auth.did
                shared = repository.auth.vault.get("share-draft")?.text("subject").orEmpty()
                draftTags = repository.auth.vault.get("share-draft")?.text("tags").orEmpty()
                refresh()
                migrateAfterLibrary()
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                message = error.message
            } finally { busy = false }
        }
    }
    fun save(subject: String, authoredTags: String, success: () -> Unit) = action {
        repository.enqueue(subject, Contracts.authoredTags(authoredTags), did ?: error("Sign in to continue."))
        shared = ""
        repository.auth.vault.put("share-draft", null)
        pending = repository.pending()
        repository.drainQueue { pending = repository.pending() }
        local()
        message = if (pending.any { it.subject == subject.trim() }) "Saved to your pending queue. Retry here or on the next app visit." else "Saved to L@tr.link."
        success()
    }
    fun signOut() = action {
        repository.mutex.withLock { repository.auth.signOut() }
        did = null; rows = emptyList(); pending = emptyList(); tags = emptyList()
        message = "Signed out. Pending saves remain assigned to their original account."
    }
    fun state(row: Bookmark) = action { repository.changeState(row); refresh() }
    fun remove(row: Bookmark) = action { repository.remove(row); refresh() }
    fun editTags(row: Bookmark, value: String, done: () -> Unit) = action { repository.setTags(row, Contracts.authoredTags(value)); refresh(); done() }
    fun bulk(tag: String, replacement: String?, done: () -> Unit) = action {
        replacement?.let { require(Contracts.authoredTags(it).size == 1 && it.trim() != tag) { "Enter one different replacement tag." } }
        repository.bulkTag(tag, replacement?.trim(), did ?: error("Sign in to continue.")) { message = it }; refresh(); done()
    }
    fun discard(item: PendingSave) = action { repository.discard(item.id); pending = repository.pending() }
    fun migrate() = action { repository.migrate(did ?: error("Sign in to continue.")) { message = it }; refresh(); message = "Migration complete." }
    fun clearCache() = action { repository.clearCache(); rows = emptyList(); message = "Local library cache cleared. Pending saves are preserved." }
    fun appearance(value: Appearance) { viewModelScope.launch { app.settings.set(value) } }
}
open class MainActivity : ComponentActivity() {
    protected val model by lazy { ViewModelProvider(this)[LibraryViewModel::class.java] }
    protected open val shareMode = false
    private val authLauncher = AuthTabIntent.registerActivityResultLauncher(this) { result ->
        if (result.resultCode == AuthTabIntent.RESULT_OK) result.resultUri?.let(model::callback)
        else if (result.resultCode == AuthTabIntent.RESULT_CANCELED) model.cancelLogin()
        else model.message = "Browser verification did not complete. Retry sign in."
    }
    fun launchLogin(url: String) {
        AuthTabIntent.Builder().build().launch(authLauncher, Uri.parse(url), Uri.parse(BuildConfig.REDIRECT_URI).scheme!!)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) readIntent(intent)
        setContent { LatrRoot(model, shareMode, onClose = ::finish) }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); readIntent(intent) }
    override fun onResume() { super.onResume(); if (shareMode) model.shareForeground() else model.foreground() }
    protected open fun readIntent(intent: Intent) {
        intent.data?.takeIf { it.scheme == Uri.parse(BuildConfig.REDIRECT_URI).scheme }?.let(model::callback)
    }
}
class ShareActivity : MainActivity() {
    override val shareMode = true
    override fun readIntent(intent: Intent) {
        model.shared = ""
        model.draftTags = ""
        model.candidates = emptyList()
        model.repository.auth.vault.put("share-draft", null)
        if (intent.action != Intent.ACTION_SEND || intent.type != "text/plain") { model.message = "Share one text link to L@tr.link."; return }
        try {
            val raw = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: error("No text was shared.")
            model.candidates = Contracts.sharedCandidates(raw)
            require(model.candidates.isNotEmpty()) { "No supported link was shared." }
            model.shared = model.candidates.singleOrNull().orEmpty()
            model.repository.auth.vault.put("share-draft", JSONObject().put("subject", model.shared).put("candidates", JSONArray(model.candidates)))
        } catch (error: Exception) { model.message = error.message }
    }
}
@Composable fun LatrRoot(model: LibraryViewModel, shareMode: Boolean, onClose: () -> Unit) {
    val appearance by model.app.settings.appearance.collectAsStateWithLifecycle(Appearance())
    val dark = appearance.theme == "Dark" || (appearance.theme == "System" && isSystemInDarkTheme())
    val family = when (appearance.font) { "Serif" -> FontFamily.Serif; "Mono" -> FontFamily.Monospace; else -> FontFamily.SansSerif }
    val base = Typography()
    fun style(value: androidx.compose.ui.text.TextStyle) = value.copy(fontFamily = family, fontWeight = if (appearance.bold) FontWeight.Bold else value.fontWeight)
    val typography = Typography(bodyLarge = style(base.bodyLarge), bodyMedium = style(base.bodyMedium), bodySmall = style(base.bodySmall), titleLarge = style(base.titleLarge), titleMedium = style(base.titleMedium), titleSmall = style(base.titleSmall), headlineLarge = style(base.headlineLarge), headlineMedium = style(base.headlineMedium), headlineSmall = style(base.headlineSmall), labelLarge = style(base.labelLarge), labelMedium = style(base.labelMedium), labelSmall = style(base.labelSmall))
    MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme(), typography = typography) {
        Surface(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                if (model.did == null) LoginScreen(model, shareMode, onClose)
                else LibraryScreen(model, appearance, shareMode, onClose)
            }
        }
    }
}
@Composable fun LoginScreen(model: LibraryViewModel, shareMode: Boolean, onClose: () -> Unit) {
    val context = LocalContext.current
    var handle by rememberSaveable { mutableStateOf("") }
    Column(Modifier.safeDrawingPadding().imePadding().widthIn(max = 640.dp).fillMaxWidth().fillMaxHeight().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text("L@tr.link", style = MaterialTheme.typography.headlineLarge)
        Text("Your links, on your account.")
        Text("Sign in with your AT Protocol handle to save and read across devices.")
        if (model.shared.isNotBlank()) Text("Ready to save: ${model.shared}")
        if (shareMode) {
            Text("Open L@tr.link to sign in, then confirm this saved draft.")
            Button(onClick = { context.startActivity(Intent(context, MainActivity::class.java)); onClose() }) { Text("Open L@tr.link") }
        } else {
            LoginHandleField(handle, { handle = it }, enabled = !model.busy)
            Text("L@tr.link requests bookmark access and migration permissions. Sending public feedback also uses User Input and image upload permissions.", style = MaterialTheme.typography.bodySmall)
            Button(onClick = { model.login(handle) { (context as MainActivity).launchLogin(it) } }, enabled = handle.isNotBlank() && !model.busy) { Text("Sign in") }
        }
        if (model.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        model.message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        TextButton(onClick = { openExternal(context, "${BuildConfig.WEB_ORIGIN}/privacy") }) { Text("Privacy policy") }
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun LibraryScreen(model: LibraryViewModel, appearance: Appearance, shareMode: Boolean, onClose: () -> Unit) {
    var section by rememberSaveable { mutableStateOf("Unread") }
    var bucket by rememberSaveable { mutableStateOf("All") }
    var selectedTag by rememberSaveable { mutableStateOf<String?>(null) }
    var sort by rememberSaveable { mutableStateOf("Newest") }
    var subject by rememberSaveable { mutableStateOf(model.shared) }
    var authoredTags by rememberSaveable { mutableStateOf(model.draftTags) }
    var remove by remember { mutableStateOf<Bookmark?>(null) }
    var edit by remember { mutableStateOf<Bookmark?>(null) }
    var tagOperation by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var feedback by remember { mutableStateOf(false) }
    var unavailable by remember { mutableStateOf<Bookmark?>(null) }
    var editingPending by remember { mutableStateOf<PendingSave?>(null) }
    val context = LocalContext.current
    LaunchedEffect(model.shared, model.draftTags) { subject = model.shared; authoredTags = model.draftTags }
    val createDocument = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) model.action {
            val json = model.repository.exportJSON()
            withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(json.toByteArray()) } ?: error("Could not open the export file.") }
            model.message = "JSON exported."
        }
    }
    val visible = model.rows.filter { it.archived == (section == "Archive") && (bucket == "All" || it.bucket == bucket) && (selectedTag == null || selectedTag in it.tags) }.let { rows -> when (sort) { "Oldest" -> rows.sortedBy { it.createdAt }; "Title" -> rows.sortedBy { it.title.lowercase() }; "Recently archived" -> rows.sortedByDescending { it.archivedAt ?: it.createdAt }; else -> rows.sortedByDescending { it.createdAt } } }
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val wide = maxWidth >= 600.dp && !shareMode
    Row(Modifier.fillMaxSize()) {
    if (wide) NavigationRail(Modifier.safeDrawingPadding().fillMaxHeight()) {
        listOf("Unread", "Archive", "Tags", "Settings").forEach { tab ->
            NavigationRailItem(selected = section == tab, onClick = { section = tab }, icon = { Icon(when (tab) { "Unread" -> Icons.Default.Bookmarks; "Archive" -> Icons.Default.Archive; "Tags" -> Icons.Default.Tag; else -> Icons.Default.Settings }, contentDescription = null) }, label = { Text(tab) })
        }
    }
    Scaffold(modifier = Modifier.weight(1f), topBar = { TopAppBar(title = { Text(if (shareMode) "Save to L@tr.link" else "L@tr.link") }, actions = { if (shareMode) TextButton(onClick = onClose) { Text("Close") } else TextButton(onClick = model::foreground, enabled = !model.busy) { Text("Refresh") } }) }, bottomBar = {
        if (!shareMode && !wide) NavigationBar { listOf("Unread", "Archive", "Tags", "Settings").forEach { tab -> NavigationBarItem(selected = section == tab, onClick = { section = tab }, icon = { Icon(when (tab) { "Unread" -> Icons.Default.Bookmarks; "Archive" -> Icons.Default.Archive; "Tags" -> Icons.Default.Tag; else -> Icons.Default.Settings }, contentDescription = null) }, label = { Text(tab) }) } }
    }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = 840.dp), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (model.busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            model.message?.let { item { Text(it); TextButton(onClick = { model.message = null }) { Text("Dismiss") } } }
            if (section == "Unread" || shareMode) item {
                Text("Save link or AT URI", style = MaterialTheme.typography.titleMedium)
                Text("Saving as ${model.repository.auth.handle}", style = MaterialTheme.typography.bodyMedium)
                Text(model.did.orEmpty(), style = MaterialTheme.typography.bodySmall)
                if (shareMode) TextButton(onClick = onClose) { Text("Cancel") }
                if (model.candidates.size > 1) {
                    Text("Choose a shared link")
                    model.candidates.forEach { candidate -> TextButton(onClick = { subject = candidate; model.updateDraft(candidate, authoredTags) }) { Text(candidate, maxLines = 2) } }
                }
                OutlinedTextField(subject, { subject = it; model.updateDraft(it, authoredTags) }, Modifier.fillMaxWidth(), label = { Text("Link") }, enabled = !model.busy)
                OutlinedTextField(authoredTags, { authoredTags = it; model.updateDraft(subject, it) }, Modifier.fillMaxWidth(), label = { Text("Tags, separated by commas") }, enabled = !model.busy)
                if (model.tags.isNotEmpty()) Text("Your tags: ${model.tags.take(12).joinToString { it.tag }}", style = MaterialTheme.typography.bodySmall)
                Button(onClick = { model.save(subject, authoredTags) { subject = ""; authoredTags = "" } }, enabled = subject.isNotBlank() && !model.busy) { Text("Save") }
            }
            if (model.pending.isNotEmpty()) {
                item { Text("Pending saves (${model.pending.size})", style = MaterialTheme.typography.titleMedium); Text("Retried when you open the app or share again. Saved links stay assigned to this account.", style = MaterialTheme.typography.bodySmall) }
                items(model.pending, key = { "pending-${it.id}" }) { pending -> Card { Column(Modifier.padding(12.dp)) { Text(pending.subject); pending.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }; Row { TextButton(onClick = model::foreground, enabled = !model.busy) { Text("Retry") }; TextButton(onClick = { editingPending = pending }, enabled = !model.busy) { Text("Edit") }; TextButton(onClick = { model.discard(pending) }, enabled = !model.busy) { Text("Discard") } } } } }
            }
            if (!shareMode) when (section) {
                "Unread", "Archive" -> {
                    item {
                        Text(section, style = MaterialTheme.typography.headlineMedium)
                        Choice("Content", listOf("All", "Articles", "Social", "Other"), bucket) { bucket = it }
                        Choice("Sort", listOf("Newest", "Oldest", "Title", "Recently archived"), sort) { sort = it }
                        selectedTag?.let { tag -> TextButton(onClick = { selectedTag = null }) { Text("Tag: $tag · Clear") } }
                        Text("${visible.size} loaded items · ${visible.sumOf { it.readingMinutes }} min reading", style = MaterialTheme.typography.labelMedium)
                    }
                    if (model.nextCursor != null) item { TextButton(onClick = model::more, enabled = !model.busy) { Text("Load more bookmarks") } }
                    if (visible.isEmpty() && !model.busy && model.nextCursor == null) item { Text("No matching bookmarks. Save a link or change your filters.") }
                    items(visible, key = { it.uri }) { row -> BookmarkCard(row, !model.busy, open = {
                        val link = row.subject
                        if (link.startsWith("https://") || link.startsWith("http://")) {
                            if (row.bucket == "Articles") openExternal(context, link) else openInAppBrowser(context, link)
                        } else if (link.contains("/app.bsky.feed.post/")) {
                            val parts = link.removePrefix("at://").split('/')
                            openInAppBrowser(context, "https://bsky.app/profile/${parts[0]}/post/${parts.last()}")
                        } else model.action {
                            val resolved = runCatching { model.repository.resolveReadingURL(link) }.getOrNull()
                            if (resolved == null) unavailable = row
                            else if (row.bucket == "Articles") openExternal(context, resolved) else openInAppBrowser(context, resolved)
                        }
                    }, archive = { model.state(row) }, tags = { edit = row }, remove = { remove = row }) }
                }
                "Tags" -> {
                    item { Text("Tags", style = MaterialTheme.typography.headlineMedium); Text("Exact, case-sensitive tags across your complete library.") }
                    items(model.tags, key = { it.tag }) { tag -> Card { Column(Modifier.padding(12.dp)) { TextButton(onClick = { selectedTag = tag.tag; section = "Unread" }) { Text("${tag.tag} (${tag.count})") }; Row { TextButton(onClick = { tagOperation = tag.tag to true }, enabled = !model.busy) { Text("Rename") }; TextButton(onClick = { tagOperation = tag.tag to false }, enabled = !model.busy) { Text("Remove tag") } } } } }
                }
                "Settings" -> {
                    item {
                        Text("Settings", style = MaterialTheme.typography.headlineMedium)
                        Text(model.repository.auth.handle)
                        Text(model.did.orEmpty(), style = MaterialTheme.typography.bodySmall)
                        Choice("Theme", listOf("System", "Light", "Dark"), appearance.theme) { model.appearance(appearance.copy(theme = it)) }
                        Choice("Font", listOf("Sans", "Serif", "Mono"), appearance.font) { model.appearance(appearance.copy(font = it)) }
                        Row { Text("Bold text", Modifier.weight(1f)); Switch(appearance.bold, { model.appearance(appearance.copy(bold = it)) }) }
                        TextButton(onClick = { createDocument.launch("latr-export.json") }, enabled = !model.busy) { Text("Export complete library as JSON") }
                        TextButton(onClick = model::clearCache, enabled = !model.busy) { Text("Clear local library cache") }
                        Text("Migrate legacy bookmarks", style = MaterialTheme.typography.titleMedium)
                        Text("Resume conversion of old L@tr records into community bookmarks. Existing community bookmarks remain readable if migration fails.")
                        TextButton(onClick = model::migrate, enabled = !model.busy) { Text("Run or resume migration") }
                        TextButton(onClick = { feedback = true }, enabled = !model.busy) { Text("Send public feedback") }
                        TextButton(onClick = { openExternal(context, "${BuildConfig.WEB_ORIGIN}/support") }) { Text("Support") }
                        TextButton(onClick = { openExternal(context, "${BuildConfig.WEB_ORIGIN}/privacy") }) { Text("Privacy") }
                        TextButton(onClick = model::signOut, enabled = !model.busy) { Text("Sign out") }
                        Text("${BuildConfig.FLAVOR} · ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
    }
    }
    remove?.let { row -> AlertDialog(onDismissRequest = { remove = null }, title = { Text("Delete saved item?") }, text = { Text("Archive moves this item out of Unread. Delete permanently removes the bookmark.") }, confirmButton = { TextButton(onClick = { model.remove(row); remove = null }, enabled = !model.busy, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Icon(Icons.Default.DeleteOutline, contentDescription = null); Spacer(Modifier.width(8.dp)); Text("Delete permanently") } }, dismissButton = { Row { if (!row.archived) TextButton(onClick = { model.state(row); remove = null }) { Icon(Icons.Default.Archive, contentDescription = null); Spacer(Modifier.width(8.dp)); Text("Archive instead") }; TextButton(onClick = { remove = null }) { Text("Cancel") } } }) }
    edit?.let { row -> TextEditorDialog("Edit tags", row.tags.joinToString(", "), "Replace or clear this bookmark's tags.", !model.busy, dismiss = { edit = null }) { model.editTags(row, it) { edit = null } } }
    tagOperation?.let { (tag, rename) -> TextEditorDialog(if (rename) "Rename $tag" else "Remove $tag?", "", if (rename) "Changes this exact tag throughout your library. Retry resumes an interrupted batch." else "Removes this tag from every bookmark. Bookmarks are preserved.", !model.busy, showInput = rename, dismiss = { tagOperation = null }) { model.bulk(tag, if (rename) it else null) { tagOperation = null } } }
    editingPending?.let { item ->
        var editedSubject by rememberSaveable(item.id) { mutableStateOf(item.subject) }
        var editedTags by rememberSaveable(item.id) { mutableStateOf(JSONArray(item.tags).strings().joinToString(", ")) }
        AlertDialog(onDismissRequest = { editingPending = null }, title = { Text("Edit pending save") }, text = { Column {
            OutlinedTextField(editedSubject, { editedSubject = it }, label = { Text("Link") })
            OutlinedTextField(editedTags, { editedTags = it }, label = { Text("Tags") })
        } }, confirmButton = { TextButton(onClick = { model.editPending(item, editedSubject, editedTags) { editingPending = null } }, enabled = !model.busy) { Text("Save changes") } }, dismissButton = { TextButton(onClick = { editingPending = null }) { Text("Cancel") } })
    }
    unavailable?.let { row -> AlertDialog(onDismissRequest = { unavailable = null }, title = { Text("Reading link unavailable") }, text = { Text("This AT record has no supported web reading link. The original URI remains saved.") }, confirmButton = { TextButton(onClick = { model.action {
        val link = runCatching { model.repository.resolveReadingURL(row.subject) }.getOrNull()
        if (link != null) { unavailable = null; if (row.bucket == "Articles") openExternal(context, link) else openInAppBrowser(context, link) }
        else model.message = "No reading link was found."
    } }, enabled = !model.busy) { Text("Retry") } }, dismissButton = { Row {
        TextButton(onClick = { (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("AT URI", row.subject)) }) { Text("Copy URI") }
        TextButton(onClick = { unavailable = null }) { Text("Close") }
    } }) }
    if (feedback) FeedbackDialog(model) { feedback = false }
}
@Composable fun Choice(label: String, choices: List<String>, selected: String, select: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box { TextButton(onClick = { expanded = true }) { Text("$label: $selected") }; DropdownMenu(expanded, { expanded = false }) { choices.forEach { value -> DropdownMenuItem(text = { Text(value) }, onClick = { select(value); expanded = false }) } } }
}
@Composable fun BookmarkCard(row: Bookmark, enabled: Boolean, open: () -> Unit, archive: () -> Unit, tags: () -> Unit, remove: () -> Unit) {
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp)) {
        Row(Modifier.fillMaxWidth().clickable(onClick = open), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            row.image?.let { AsyncImage(it, null, Modifier.size(72.dp)) }
            Column(Modifier.weight(1f)) { Text(row.title, style = MaterialTheme.typography.titleMedium); Text(row.site, style = MaterialTheme.typography.bodySmall); if (row.description.isNotEmpty()) Text(row.description, maxLines = 3); Text("${row.bucket} · ${row.createdAt.take(10)}", style = MaterialTheme.typography.labelSmall) }
        }
        if (row.tags.isNotEmpty()) Text(row.tags.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
        BookmarkActions(row.archived, enabled, archive, tags, remove)
    } }
}
@Composable fun TextEditorDialog(title: String, initial: String, detail: String, enabled: Boolean, showInput: Boolean = true, dismiss: () -> Unit, submit: (String) -> Unit) {
    var value by rememberSaveable(title) { mutableStateOf(initial) }
    AlertDialog(onDismissRequest = dismiss, title = { Text(title) }, text = { Column { Text(detail); if (showInput) OutlinedTextField(value, { value = it }, enabled = enabled) } }, confirmButton = { TextButton(onClick = { submit(value) }, enabled = enabled) { Text("Confirm") } }, dismissButton = { TextButton(onClick = dismiss, enabled = enabled) { Text("Cancel") } })
}
fun openExternal(context: android.content.Context, url: String) {
    if (Uri.parse(url).scheme !in listOf("http", "https")) return
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
}
fun openInAppBrowser(context: android.content.Context, url: String) {
    if (Uri.parse(url).scheme !in listOf("http", "https")) return
    runCatching { CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, Uri.parse(url)) }
        .onFailure { openExternal(context, url) }
}
@Composable fun FeedbackDialog(model: LibraryViewModel, dismiss: () -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var body by rememberSaveable { mutableStateOf("") }
    var selected by remember { mutableStateOf<List<String>>(emptyList()) }
    var available by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var photos by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { photos = it.take(4) }
    LaunchedEffect(Unit) { try { val board = model.repository.auth.publicJSON("https://userinput.app/api/board/${Contracts.boardDid}/${Contracts.boardKey}"); available = board.getJSONObject("board").getJSONObject("value").optJSONArray("tags")?.objects()?.map { it.getString("value") to it.getString("label") }.orEmpty() } catch (failure: Exception) { error = failure.message } }
    AlertDialog(onDismissRequest = { if (!model.busy) dismiss() }, title = { Text("Public feedback") }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Feedback and photos are published publicly to your AT Protocol account and the L@tr.link User Input board.")
        OutlinedTextField(title, { title = it.take(200) }, label = { Text("Title") }, enabled = !model.busy)
        OutlinedTextField(body, { body = it.take(10_000) }, label = { Text("Details") }, maxLines = 5, enabled = !model.busy)
        available.forEach { (value, label) -> Row { Checkbox(value in selected, { checked -> selected = if (checked) selected + value else selected - value }, enabled = !model.busy); Text(label, Modifier.padding(top = 12.dp)) } }
        TextButton(onClick = { picker.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !model.busy) { Text("Choose up to 4 photos (${photos.size})") }
        if (photos.isNotEmpty()) TextButton(onClick = { photos = emptyList() }, enabled = !model.busy) { Text("Remove photos") }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (model.busy) LinearProgressIndicator()
    } }, confirmButton = { TextButton(onClick = {
        model.action {
            try {
                val expectedDID = model.did ?: error("Sign in to publish feedback.")
                val attachments = withContext(Dispatchers.IO) { photos.mapIndexed { index, uri ->
                    val mime = context.contentResolver.getType(uri) ?: error("The selected photo has no image type.")
                    val bytes = context.contentResolver.openInputStream(uri)?.use { stream -> readBounded(stream, 5 * 1024 * 1024) } ?: error("Could not read the selected photo.")
                    FeedbackPhoto(bytes, mime, "Feedback photo ${index + 1}")
                } }
                model.repository.feedback(title, body, selected, attachments, expectedDID)
                model.message = "Public feedback sent."; dismiss()
            } catch (failure: Exception) { error = failure.message; throw failure }
        }
    }, enabled = title.isNotBlank() && !model.busy) { Text("Publish feedback") } }, dismissButton = { TextButton(onClick = dismiss, enabled = !model.busy) { Text("Cancel") } })
}

@Composable
fun BookmarkActions(archived: Boolean, enabled: Boolean, archive: () -> Unit, tags: () -> Unit, delete: () -> Unit) {
    Row {
        TextButton(onClick = archive, enabled = enabled, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.primary)) {
            Icon(if (archived) Icons.Default.Unarchive else Icons.Default.Archive, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(4.dp))
            Text(if (archived) "Restore" else "Archive")
        }
        TextButton(onClick = tags, enabled = enabled) { Icon(Icons.Default.Tag, contentDescription = null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Tags") }
        TextButton(onClick = delete, enabled = enabled, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
            Icon(Icons.Default.DeleteOutline, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(4.dp))
            Text("Delete")
        }
    }
}
