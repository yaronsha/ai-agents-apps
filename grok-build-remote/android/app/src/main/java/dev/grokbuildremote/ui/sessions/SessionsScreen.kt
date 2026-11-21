package dev.grokbuildremote.ui.sessions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.grokbuildremote.GrokBuildRemoteApp
import dev.grokbuildremote.data.Conn
import dev.grokbuildremote.data.SessionInfo
import dev.grokbuildremote.ui.Dot
import dev.grokbuildremote.ui.card
import dev.grokbuildremote.ui.folderName
import dev.grokbuildremote.ui.relativeTime
import dev.grokbuildremote.ui.theme.Palette

@Composable
fun SessionsScreen(app: GrokBuildRemoteApp, onOpen: (SessionInfo) -> Unit, onSettings: () -> Unit) {
    val conn by app.bridge.conn.collectAsStateWithLifecycle()
    val sessions by app.bridge.sessions.collectAsStateWithLifecycle()
    val attached by app.bridge.attached.collectAsStateWithLifecycle()
    val needsYou by app.bridge.needsYou.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    var folder by remember { mutableStateOf<String?>(null) }
    var showNew by remember { mutableStateOf(false) }

    val folders = remember(sessions) { sessions.map { folderName(it.cwd) }.filter { it.isNotBlank() }.distinct().take(8) }
    val visible = sessions.filter { s ->
        (folder == null || folderName(s.cwd) == folder) &&
            (query.isBlank() || s.title.contains(query, true) || s.cwd.contains(query, true))
    }
    val waiting = visible.filter { it.sessionId in needsYou }
    val rest = visible.filter { it.sessionId !in needsYou }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 20.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Sessions", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Palette.Text)
                Spacer(Modifier.height(6.dp))
                ConnectionLine(conn, app.store.addr, onRetry = { app.bridge.connect() })
            }
            IconButton(onClick = { app.bridge.refreshSessions() }) {
                Icon(Icons.Filled.Refresh, contentDescription = "Refresh sessions", tint = Palette.Text)
            }
            IconButton(onClick = onSettings) {
                Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = Palette.Text)
            }
        }

        TextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Search sessions") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Palette.Surface,
                unfocusedContainerColor = Palette.Surface,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
        )

        if (folders.size > 1) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Chip("All", folder == null) { folder = null }
                folders.forEach { f -> Chip(f, folder == f) { folder = if (folder == f) null else f } }
            }
        } else {
            Spacer(Modifier.height(12.dp))
        }

        LazyColumn(
            Modifier.weight(1f).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (waiting.isNotEmpty()) {
                item { SectionLabel("Needs you") }
                items(waiting, key = { "w" + it.sessionId }) { s ->
                    SessionCard(s, status = Status.Waiting, onClick = { onOpen(s) })
                }
            }
            if (rest.isNotEmpty()) {
                item { SectionLabel("On this Mac") }
                items(rest, key = { it.sessionId }) { s ->
                    SessionCard(s, status = if (s.sessionId in attached) Status.Following else Status.Idle, onClick = { onOpen(s) })
                }
            }
            if (visible.isEmpty()) {
                item {
                    Text(
                        if (conn is Conn.Connected) "No sessions yet. Start one in the terminal or below." else "Connect to your Mac to see its sessions.",
                        color = Palette.Muted,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            }
        }

        Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp)) {
            Button(
                onClick = { showNew = true },
                enabled = conn is Conn.Connected,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(26.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Palette.Accent, contentColor = Palette.OnAccent),
            ) {
                Icon(Icons.Filled.Add, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("New session on your Mac", fontWeight = FontWeight.SemiBold)
            }
        }
    }

    if (showNew) {
        NewSessionDialog(
            initial = sessions.firstOrNull()?.cwd.orEmpty(),
            onDismiss = { showNew = false },
            onCreate = { cwd ->
                showNew = false
                app.bridge.newSession(cwd)
            },
        )
    }
}

private enum class Status { Waiting, Following, Idle }

@Composable
private fun ConnectionLine(conn: Conn, addr: String?, onRetry: () -> Unit) {
    val host = addr?.substringBeforeLast(':') ?: "your Mac"
    val (color, text) = when (conn) {
        is Conn.Connected -> Palette.Good to "$host · encrypted · paired"
        Conn.Connecting -> Palette.Warn to "Connecting to $host…"
        Conn.Disconnected -> Palette.Muted to "Not connected"
        Conn.Unpaired -> Palette.Muted to "Not paired"
        is Conn.Failed -> Palette.Bad to conn.message
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Dot(color)
        Spacer(Modifier.width(6.dp))
        Text(text, fontSize = 12.sp, color = Palette.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        if (conn is Conn.Failed || conn == Conn.Disconnected) {
            TextButton(onClick = onRetry) { Text("Retry", fontSize = 12.sp) }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = Palette.Muted,
        letterSpacing = 0.7.sp,
        modifier = Modifier.padding(start = 4.dp, top = 8.dp),
    )
}

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .card(radius = 16.dp, fill = if (selected) Palette.Text else Color.Transparent, stroke = if (selected) Palette.Text else Palette.Border)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp),
    ) {
        Text(label, fontSize = 13.sp, color = if (selected) Palette.Ground else Palette.Body, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
private fun SessionCard(s: SessionInfo, status: Status, onClick: () -> Unit) {
    val waiting = status == Status.Waiting
    Column(
        Modifier
            .fillMaxWidth()
            .card(fill = if (waiting) Palette.WarnSurface else Palette.Surface, stroke = if (waiting) Palette.WarnBorder else Palette.Border)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(s.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(relativeTime(s.updatedAt), fontSize = 12.sp, color = Palette.Muted)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            when (status) {
                Status.Waiting -> Row(
                    Modifier.card(radius = 12.dp, fill = Palette.WarnBg, stroke = Palette.WarnBg).padding(horizontal = 10.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.WarningAmber, contentDescription = null, tint = Palette.Warn, modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Approval waiting", fontSize = 12.sp, color = Palette.Warn, fontWeight = FontWeight.SemiBold)
                }
                Status.Following -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Check, contentDescription = null, tint = Palette.Accent, modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Following", fontSize = 12.sp, color = Palette.Accent, fontWeight = FontWeight.SemiBold)
                }
                Status.Idle -> {}
            }
            if (status != Status.Idle) Spacer(Modifier.width(8.dp))
            Text(folderName(s.cwd), fontSize = 12.sp, color = Palette.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun NewSessionDialog(initial: String, onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var cwd by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.Surface,
        title = { Text("New session") },
        text = {
            Column {
                Text("Project folder on your Mac", color = Palette.Muted, fontSize = 13.sp)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = cwd, onValueChange = { cwd = it }, singleLine = true, placeholder = { Text("/Users/you/code/project") })
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(cwd.trim()) }, enabled = cwd.trim().startsWith("/")) { Text("Start") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
