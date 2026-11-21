package dev.grokbuildremote.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.grokbuildremote.GrokBuildRemoteApp
import dev.grokbuildremote.data.Conn
import dev.grokbuildremote.security.ClientKey
import dev.grokbuildremote.security.PairingCode
import dev.grokbuildremote.ui.card
import dev.grokbuildremote.ui.theme.Mono
import dev.grokbuildremote.ui.theme.Palette

@Composable
fun SettingsScreen(app: GrokBuildRemoteApp, onBack: () -> Unit, onUnpaired: () -> Unit) {
    val conn by app.bridge.conn.collectAsStateWithLifecycle()
    var language by remember { mutableStateOf(app.store.dictationLanguage) }
    var confirmUnpair by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(Modifier.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Palette.Text)
            }
            Text("Settings", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Palette.Text)
        }
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Section("Paired Mac") {
                Field("Address", app.store.addr ?: "—")
                Field("Fingerprint", app.store.fingerprint?.let { PairingCode.display(it).take(39) + "…" } ?: "—", mono = true)
                Field("This phone", app.store.deviceName ?: "—")
                Field(
                    "Status",
                    when (val c = conn) {
                        is Conn.Connected -> "Connected · Grok Build ${c.grokVersion}"
                        Conn.Connecting -> "Connecting…"
                        Conn.Disconnected -> "Not connected"
                        Conn.Unpaired -> "Not paired"
                        is Conn.Failed -> c.message
                    },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { app.bridge.disconnect(); app.bridge.connect() }) { Text("Reconnect") }
                    OutlinedButton(onClick = { app.bridge.disconnect() }) { Text("Disconnect") }
                }
            }

            Section("Dictation") {
                Text("Tap the mic in a session to dictate. Long-press it to switch language.", color = Palette.Muted, fontSize = 13.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    listOf("en-US" to "English", "he-IL" to "Hebrew").forEach { (code, name) ->
                        val selected = language == code
                        OutlinedButton(
                            onClick = { language = code; app.store.dictationLanguage = code },
                            colors = if (selected) ButtonDefaults.outlinedButtonColors(containerColor = Palette.Surface2) else ButtonDefaults.outlinedButtonColors(),
                        ) { Text(if (selected) "✓ $name" else name) }
                    }
                }
            }

            Section("Security") {
                Text(
                    "Approving commands or file changes asks for your fingerprint. The phone can never turn on auto-approve. " +
                        "Every connection and approval is logged on the Mac.",
                    color = Palette.Muted,
                    fontSize = 13.sp,
                )
                TextButton(onClick = { confirmUnpair = true }) { Text("Unpair this phone", color = Palette.Bad) }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            containerColor = Palette.Surface,
            title = { Text("Unpair this phone?") },
            text = { Text("This deletes the phone's key. Also run gbr devices revoke on the Mac to remove it there.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmUnpair = false
                    app.bridge.reset()
                    runCatching { ClientKey.delete() }
                    app.store.clear()
                    onUnpaired()
                }) { Text("Unpair", color = Palette.Bad) }
            },
            dismissButton = { TextButton(onClick = { confirmUnpair = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().card().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted, letterSpacing = 0.7.sp)
        content()
    }
}

@Composable
private fun Field(label: String, value: String, mono: Boolean = false) {
    Column {
        Text(label, fontSize = 12.sp, color = Palette.Muted)
        Text(value, fontSize = 14.sp, color = Palette.Text, fontFamily = if (mono) Mono else null)
    }
}
