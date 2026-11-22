package dev.grokbuildremote.ui.session

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.grokbuildremote.GrokBuildRemoteApp
import dev.grokbuildremote.data.SessionInfo
import dev.grokbuildremote.ui.findActivity
import dev.grokbuildremote.ui.folderName
import dev.grokbuildremote.ui.requireUserPresence
import dev.grokbuildremote.ui.theme.Palette

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SessionScreen(app: GrokBuildRemoteApp, info: SessionInfo, onBack: () -> Unit) {
    val sid = info.sessionId
    val state by app.bridge.session(sid).collectAsStateWithLifecycle()
    val attached by app.bridge.attached.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var draft by remember(sid) { mutableStateOf("") }
    var menuOpen by remember { mutableStateOf(false) }
    var hiddenRequest by remember { mutableStateOf<String?>(null) }
    var listening by remember { mutableStateOf(false) }
    var askOnline by remember { mutableStateOf<String?>(null) }
    var language by remember { mutableStateOf(app.store.dictationLanguage) }
    val dictation = remember { Dictation(context) }
    val listState = rememberLazyListState()

    LaunchedEffect(sid) { app.bridge.attach(sid, info.cwd) }
    DisposableEffect(Unit) { onDispose { dictation.stop() } }

    // Follow the bottom as the transcript grows.
    LaunchedEffect(state.items.size) {
        if (state.items.isNotEmpty()) listState.animateScrollToItem(state.items.lastIndex)
    }

    val dictationCallback = remember {
        object : Dictation.Callback {
            override fun onPartial(text: String) { draft = text }
            override fun onFinal(text: String) {
                listening = false
                if (text.isNotBlank()) draft = text
            }
            override fun onError(message: String) {
                listening = false
                android.widget.Toast.makeText(context, message, android.widget.Toast.LENGTH_SHORT).show()
            }
            override fun onNeedsOnline(language: String) {
                listening = false
                askOnline = language
            }
        }
    }

    fun startDictation() {
        listening = true
        dictation.start(language, app.store.onlineDictationAllowed(language), dictationCallback)
    }

    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startDictation()
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        // Top bar
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 8.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to sessions", tint = Palette.Text)
            }
            Column(Modifier.weight(1f)) {
                Text(info.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val following = if (sid in attached) "following live" else "connecting…"
                Text("${folderName(info.cwd)} · $following", fontSize = 12.sp, color = Palette.Muted, maxLines = 1)
            }
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "More options", tint = Palette.Text)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(text = { Text("Stop following") }, onClick = {
                        menuOpen = false
                        app.bridge.detach(sid)
                        onBack()
                    })
                }
            }
        }
        HorizontalDivider(color = Palette.Surface2)

        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(state.items, key = { it.key }) { TranscriptItem(it) }
            if (state.items.isEmpty()) {
                item { Text("Loading the session from your Mac…", color = Palette.Muted, fontSize = 14.sp) }
            }
        }

        // A dismissed approval is still waiting in Grok: keep a way back to it.
        val waiting = state.pending
        if (waiting != null && hiddenRequest == waiting.id.toString()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Palette.Accent)
                    .combinedClickable(onClick = { hiddenRequest = null })
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Approval waiting: ${waiting.command ?: waiting.title}",
                    color = Palette.OnAccent,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(12.dp))
                Text("Review", color = Palette.OnAccent, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        HorizontalDivider(color = Palette.Surface2)
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 14.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            TextField(
                value = draft,
                onValueChange = { draft = it },
                placeholder = { Text(if (listening) "Listening…" else "Reply to Grok…") },
                shape = RoundedCornerShape(24.dp),
                maxLines = 6,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Palette.Surface,
                    unfocusedContainerColor = Palette.Surface,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
                trailingIcon = {
                    // Tap: dictate. Long-press: switch English / Hebrew.
                    val label = if (language.startsWith("he")) "HE" else "EN"
                    Box(
                        Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(if (listening) Palette.Accent else Color.Transparent)
                            .semantics { contentDescription = if (listening) "Stop dictation" else "Dictate ($label). Long-press to switch language" }
                            .combinedClickable(
                                onClick = {
                                    if (listening) {
                                        dictation.stop()
                                        listening = false
                                    } else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                        startDictation()
                                    } else {
                                        micPermission.launch(Manifest.permission.RECORD_AUDIO)
                                    }
                                },
                                onLongClick = {
                                    language = if (language.startsWith("he")) "en-US" else "he-IL"
                                    app.store.dictationLanguage = language
                                    android.widget.Toast.makeText(
                                        context,
                                        if (language.startsWith("he")) "Dictation: Hebrew" else "Dictation: English",
                                        android.widget.Toast.LENGTH_SHORT,
                                    ).show()
                                },
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Mic, contentDescription = null, tint = if (listening) Palette.OnAccent else Palette.Muted)
                    }
                },
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            val canSend = draft.isNotBlank()
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(if (canSend) Palette.Accent else Palette.Text)
                    .combinedClickable(onClick = {
                        if (canSend) {
                            app.bridge.prompt(sid, draft.trim())
                            draft = ""
                        } else if (state.running) {
                            app.bridge.cancel(sid)
                        }
                    }),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    canSend -> Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", tint = Palette.OnAccent)
                    state.running -> Icon(Icons.Filled.Stop, contentDescription = "Stop the agent", tint = Palette.Ground)
                    else -> Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", tint = Palette.Muted)
                }
            }
        }
    }

    val pending = state.pending
    if (pending != null && hiddenRequest != pending.id.toString()) {
        ApprovalSheet(
            request = pending,
            sessionTitle = info.title,
            cwd = info.cwd,
            onAnswer = { option ->
                val activity = context.findActivity()
                if (needsUserPresence(pending, option) && activity != null) {
                    requireUserPresence(
                        activity,
                        title = "Approve: ${pending.command ?: pending.title}".take(80),
                        onOk = { app.bridge.answer(sid, pending, option.optionId) },
                        onFail = { msg -> android.widget.Toast.makeText(context, msg, android.widget.Toast.LENGTH_SHORT).show() },
                    )
                } else if (!needsUserPresence(pending, option)) {
                    app.bridge.answer(sid, pending, option.optionId)
                }
            },
            onDismiss = { hiddenRequest = pending.id.toString() },
        )
    }

    askOnline?.let { lang ->
        val name = if (lang.startsWith("he")) "Hebrew" else "English"
        AlertDialog(
            onDismissRequest = { askOnline = null },
            containerColor = Palette.Surface,
            title = { Text("Use online speech recognition?") },
            text = {
                Text("$name recognition isn't available on this phone offline. To dictate in $name, your voice would be sent to the phone's speech service (usually Google). The text still only goes to your Mac.")
            },
            confirmButton = {
                TextButton(onClick = {
                    app.store.allowOnlineDictation(lang)
                    askOnline = null
                    startDictation()
                }) { Text("Allow for $name") }
            },
            dismissButton = { TextButton(onClick = { askOnline = null }) { Text("Not now") } },
        )
    }
}
