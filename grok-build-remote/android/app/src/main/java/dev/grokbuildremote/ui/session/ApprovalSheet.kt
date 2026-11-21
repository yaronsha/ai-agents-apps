package dev.grokbuildremote.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.grokbuildremote.protocol.PendingRequest
import dev.grokbuildremote.protocol.PermissionOption
import dev.grokbuildremote.ui.card
import dev.grokbuildremote.ui.folderName
import dev.grokbuildremote.ui.theme.Mono
import dev.grokbuildremote.ui.theme.Palette

/** Tool kinds that only read; approving these doesn't need a fingerprint. */
private val READ_ONLY_KINDS = setOf("read", "search", "search_tool", "list_dir", "list", "think", "fetch", "web_search", "web_fetch")

fun needsUserPresence(request: PendingRequest, option: PermissionOption): Boolean =
    option.kind.startsWith("allow") && request.kind !in READ_ONLY_KINDS

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalSheet(
    request: PendingRequest,
    sessionTitle: String,
    cwd: String,
    onAnswer: (PermissionOption) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Palette.Surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            val (icon, heading) = when {
                !request.isPermission -> Icons.Filled.HelpOutline to "Grok has a question"
                request.kind == "execute" -> Icons.Filled.Terminal to "Grok wants to run a command"
                request.kind in setOf("edit", "write", "delete", "move") -> Icons.Filled.Edit to "Grok wants to change files"
                else -> Icons.Filled.HelpOutline to "Grok is asking for permission"
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Palette.WarnBg),
                    contentAlignment = Alignment.Center,
                ) { Icon(icon, contentDescription = null, tint = Palette.Warn, modifier = Modifier.size(20.dp)) }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(heading, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Palette.Text)
                    Text("$sessionTitle · ${folderName(cwd)}", fontSize = 13.sp, color = Palette.Muted)
                }
            }

            Text(
                request.command ?: request.title,
                fontFamily = Mono,
                fontSize = 13.sp,
                lineHeight = 19.sp,
                color = Palette.Text,
                modifier = Modifier.fillMaxWidth().card(radius = 12.dp, fill = Palette.Code).padding(14.dp),
            )

            if (cwd.isNotBlank()) {
                Row {
                    Text("Folder", fontSize = 13.sp, color = Palette.Muted, modifier = Modifier.weight(1f))
                    Text(cwd, fontFamily = Mono, fontSize = 12.sp, color = Palette.Text)
                }
            }

            if (request.options.isEmpty()) {
                Text(
                    "This kind of question can't be answered from the phone yet. Answer it in the terminal.",
                    fontSize = 14.sp,
                    color = Palette.Body,
                )
                OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("OK") }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    request.options.forEach { option -> OptionButton(request, option) { onAnswer(option) } }
                }
            }

            Text(
                "Also shown in the terminal on your Mac · first answer wins",
                fontSize = 12.sp,
                color = Palette.Muted,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }
    }
}

@Composable
private fun OptionButton(request: PendingRequest, option: PermissionOption, onClick: () -> Unit) {
    val modifier = Modifier.fillMaxWidth().height(50.dp)
    when {
        option.kind == "allow_once" || (option.kind.startsWith("allow") && option.kind != "allow_always") -> Button(
            onClick = onClick,
            modifier = modifier,
            shape = RoundedCornerShape(25.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Palette.Accent, contentColor = Palette.OnAccent),
        ) {
            if (needsUserPresence(request, option)) {
                Icon(Icons.Filled.Fingerprint, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(option.name, fontWeight = FontWeight.SemiBold)
        }
        option.kind.startsWith("reject") -> OutlinedButton(
            onClick = onClick,
            modifier = modifier,
            shape = RoundedCornerShape(25.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Palette.BadBorder),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.Bad),
        ) { Text(option.name) }
        else -> OutlinedButton(
            onClick = onClick,
            modifier = modifier,
            shape = RoundedCornerShape(25.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF3A404C)),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.Text),
        ) {
            if (needsUserPresence(request, option)) {
                Icon(Icons.Filled.Fingerprint, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(option.name)
        }
    }
}
