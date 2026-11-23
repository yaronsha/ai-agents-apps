package dev.grokbuildremote.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.grokbuildremote.protocol.SessionContext
import dev.grokbuildremote.protocol.SessionContext.Companion.tokens
import dev.grokbuildremote.ui.theme.Palette

/** Grok's `/context` on the phone: how full the context window is, and what fills it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContextSheet(context: SessionContext?, onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Palette.Surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Context", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Palette.Text)
            if (context == null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Palette.Accent, strokeWidth = 2.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("Asking your Mac…", color = Palette.Muted, fontSize = 14.sp)
                }
                return@Column
            }
            val c = context
            Text(
                "${tokens(c.used)} of ${tokens(c.total)} tokens · ${c.usagePct}%",
                fontSize = 15.sp,
                color = Palette.Text,
            )
            val fill = (c.usagePct / 100f).coerceIn(0f, 1f)
            val warn = c.autoCompactPct?.let { c.usagePct >= it - 10 } ?: (c.usagePct >= 70)
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(10.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .background(Palette.Surface2),
            ) {
                if (fill > 0f) {
                    Box(
                        Modifier
                            .fillMaxWidth(fill)
                            .fillMaxHeight()
                            .background(if (warn) Palette.Warn else Palette.Accent),
                    )
                }
            }
            val notes = listOfNotNull(
                c.free?.let { "${tokens(it)} free" },
                c.autoCompactPct?.let { "compacts at $it%" },
                c.compactions?.takeIf { it > 0 }?.let { "compacted $it×" },
            )
            if (notes.isNotEmpty()) Text(notes.joinToString(" · "), fontSize = 13.sp, color = Palette.Muted)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                c.parts.forEach { p ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(p.label, fontSize = 14.sp, color = Palette.Body, modifier = Modifier.weight(1f))
                        p.detail?.let { Text("$it  ", fontSize = 12.sp, color = Palette.Muted) }
                        Text(tokens(p.tokens), fontSize = 14.sp, color = Palette.Text)
                    }
                }
            }
            val footer = listOfNotNull(c.model, c.turns?.let { "$it turns" })
            if (footer.isNotEmpty()) Text(footer.joinToString(" · "), fontSize = 12.sp, color = Palette.Muted)
        }
    }
}
