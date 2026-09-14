package link.latr

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage

@Composable
fun LoginHandleField(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    search: LoginHandleSearch = remember { WaowLoginHandleSearch() },
) {
    val scope = rememberCoroutineScope()
    val typeahead = remember(search) { LoginHandleTypeahead(scope, search) }
    val state by typeahead.state.collectAsStateWithLifecycle()
    LaunchedEffect(enabled) { if (!enabled) typeahead.clear() }
    DisposableEffect(typeahead) { onDispose { typeahead.clear() } }
    Column(Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = { onValueChange(it); typeahead.update(it) },
            label = { Text("Handle or DID") },
            placeholder = { Text("you.bsky.social") },
            modifier = Modifier.fillMaxWidth().testTag("login-handle"),
            singleLine = true,
            enabled = enabled,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
        )
        if (enabled && state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (enabled && state.suggestions.isNotEmpty()) {
            Card(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                LazyColumn(Modifier.heightIn(max = 256.dp).testTag("login-suggestions")) {
                    items(state.suggestions, key = { it.did }) { suggestion ->
                        ListItem(
                            headlineContent = { Text(suggestion.displayName?.takeIf(String::isNotBlank) ?: suggestion.handle) },
                            supportingContent = { Text("@${suggestion.handle}") },
                            leadingContent = {
                                val avatar = suggestion.avatar?.takeIf { it.startsWith("https://") }
                                if (avatar != null) AsyncImage(avatar, contentDescription = null, modifier = Modifier.size(40.dp).clip(CircleShape), contentScale = ContentScale.Crop)
                                else Surface(Modifier.size(40.dp), shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer) {
                                    Box(contentAlignment = Alignment.Center) { Text(suggestion.handle.take(1).uppercase()) }
                                }
                            },
                            modifier = Modifier.fillMaxWidth().testTag("login-suggestion-${suggestion.did}").clickable {
                                typeahead.clear()
                                onValueChange(suggestion.handle)
                            },
                        )
                    }
                }
            }
        }
        if (enabled && state.failed) Text("Suggestions unavailable. You can still enter your handle or DID.", style = MaterialTheme.typography.bodySmall)
    }
}
