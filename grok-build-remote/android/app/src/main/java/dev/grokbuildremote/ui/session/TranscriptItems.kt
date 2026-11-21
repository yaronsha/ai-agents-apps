package dev.grokbuildremote.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.grokbuildremote.protocol.AgentText
import dev.grokbuildremote.protocol.DiffKind
import dev.grokbuildremote.protocol.DiffLine
import dev.grokbuildremote.protocol.Item
import dev.grokbuildremote.protocol.LineDiff
import dev.grokbuildremote.protocol.PlanItem
import dev.grokbuildremote.protocol.Thought
import dev.grokbuildremote.protocol.ToolCall
import dev.grokbuildremote.protocol.UserText
import dev.grokbuildremote.ui.card
import dev.grokbuildremote.ui.theme.Mono
import dev.grokbuildremote.ui.theme.Palette

@Composable
fun TranscriptItem(item: Item) {
    when (item) {
        is UserText -> UserBubble(item.text)
        is AgentText -> AgentProse(item.text)
        is Thought -> ThoughtRow(item.text)
        is ToolCall -> ToolCard(item)
        is PlanItem -> PlanCard(item)
    }
}

@Composable
private fun UserBubble(text: String) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            text,
            fontSize = 14.sp,
            lineHeight = 20.sp,
            color = Palette.Text,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp))
                .background(Palette.Bubble)
                .padding(horizontal = 14.dp, vertical = 12.dp),
        )
    }
}

/** Agent text: plain paragraphs, with ``` fenced blocks shown as code. */
@Composable
private fun AgentProse(text: String) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        splitFences(text).forEach { (isCode, part) ->
            if (isCode) CodeBlock(part) else if (part.isNotBlank()) {
                Text(part.trim(), fontSize = 14.sp, lineHeight = 21.sp, color = Palette.Body)
            }
        }
    }
}

internal fun splitFences(text: String): List<Pair<Boolean, String>> {
    val parts = text.split("```")
    return parts.mapIndexed { i, p ->
        if (i % 2 == 1) true to p.substringAfter('\n', p) else false to p
    }
}

@Composable
private fun CodeBlock(code: String) {
    Text(
        code.trimEnd(),
        fontFamily = Mono,
        fontSize = 12.sp,
        lineHeight = 18.sp,
        color = Palette.Text,
        modifier = Modifier
            .fillMaxWidth()
            .card(radius = 10.dp, fill = Palette.Code)
            .horizontalScroll(rememberScrollState())
            .padding(12.dp),
    )
}

@Composable
private fun ThoughtRow(text: String) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.clickable { open = !open }) {
        Text(if (open) "Thinking ▾" else "Thinking ▸", fontSize = 12.sp, color = Palette.Muted, fontWeight = FontWeight.Medium)
        if (open) Text(text, fontSize = 13.sp, lineHeight = 19.sp, color = Palette.Muted, modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
private fun StatusIcon(status: String) {
    val (icon, tint) = when (status) {
        "completed" -> Icons.Filled.Check to Palette.Good
        "failed" -> Icons.Filled.Close to Palette.Bad
        "in_progress" -> Icons.Filled.Sync to Palette.Accent
        else -> Icons.Filled.Schedule to Palette.Warn
    }
    Icon(icon, contentDescription = status, tint = tint, modifier = Modifier.size(14.dp))
}

private fun kindLabel(kind: String) = when (kind) {
    "read" -> "Read"
    "edit" -> "Edit"
    "write" -> "Write"
    "delete" -> "Delete"
    "move" -> "Move"
    "search", "search_tool" -> "Search"
    "execute" -> "Shell"
    "web_search" -> "Web search"
    "web_fetch", "fetch" -> "Fetch"
    "list_dir", "list" -> "List"
    "think" -> "Think"
    "plan", "enter_plan", "exit_plan" -> "Plan"
    "task" -> "Subagent"
    else -> "Tool"
}

private const val COLLAPSED_LINES = 8

@Composable
private fun ToolCard(t: ToolCall) {
    val running = t.status == "in_progress"
    val hasBody = t.diffs.isNotEmpty() || !t.output.isNullOrBlank()
    val computed = remember(t.diffs) { t.diffs.map { it to LineDiff.compute(it.oldText, it.newText) } }
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 12.dp, stroke = if (running) Color(0xFF1E4A63) else Palette.Border),
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusIcon(t.status)
            Spacer(Modifier.width(10.dp))
            Text(kindLabel(t.kind), fontSize = 13.sp, color = Palette.Muted)
            Spacer(Modifier.width(8.dp))
            Text(
                t.title,
                fontFamily = Mono,
                fontSize = 12.sp,
                color = Palette.Text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            val added = computed.sumOf { (_, lines) -> lines.count { it.kind == DiffKind.ADD } }
            val removed = computed.sumOf { (_, lines) -> lines.count { it.kind == DiffKind.DEL } }
            if (added > 0) Text(" +$added", fontFamily = Mono, fontSize = 12.sp, color = Palette.Good)
            if (removed > 0) Text(" −$removed", fontFamily = Mono, fontSize = 12.sp, color = Palette.Bad)
        }
        if (hasBody) {
            var expanded by remember(t.key) { mutableStateOf(false) }
            val lines: List<DiffLine> = computed.flatMap { (d, all) ->
                (if (computed.size > 1) listOf(DiffLine(DiffKind.SAME, "── ${d.path}")) else emptyList()) + LineDiff.hunks(all)
            }
            val output = t.output?.lines().orEmpty().filter { it.isNotBlank() }
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(Palette.Code)
                    .padding(vertical = 6.dp),
            ) {
                val shownDiff = if (expanded) lines else lines.take(COLLAPSED_LINES)
                shownDiff.forEach { DiffRow(it) }
                val shownOut = if (expanded) output else output.takeLast(4)
                shownOut.forEach {
                    Text(it, fontFamily = Mono, fontSize = 11.5.sp, color = Palette.Muted, maxLines = if (expanded) Int.MAX_VALUE else 1,
                        overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 12.dp))
                }
            }
            val total = lines.size + output.size
            val collapsed = minOf(lines.size, COLLAPSED_LINES) + minOf(output.size, 4)
            if (total > collapsed || expanded) {
                Text(
                    if (expanded) "Show less" else "Show all $total lines",
                    color = Palette.Accent,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { expanded = !expanded }
                        .padding(vertical = 10.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun DiffRow(l: DiffLine) {
    val (bg, fg, sign) = when (l.kind) {
        DiffKind.ADD -> Triple(Palette.AddBg, Palette.AddText, "+ ")
        DiffKind.DEL -> Triple(Palette.DelBg, Palette.DelText, "- ")
        DiffKind.SAME -> Triple(Color.Transparent, Palette.Muted, "  ")
    }
    Text(
        sign + l.text,
        fontFamily = Mono,
        fontSize = 11.5.sp,
        lineHeight = 18.sp,
        color = fg,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .fillMaxWidth()
            .background(bg)
            .padding(horizontal = 12.dp),
    )
}

@Composable
private fun PlanCard(p: PlanItem) {
    val done = p.entries.count { it.status == "completed" }
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 12.dp)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("PLAN · $done OF ${p.entries.size}", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted)
        p.entries.forEach { e ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                when (e.status) {
                    "completed" -> Icon(Icons.Filled.Check, null, tint = Palette.Good, modifier = Modifier.size(16.dp))
                    "in_progress" -> Icon(Icons.Filled.Sync, null, tint = Palette.Accent, modifier = Modifier.size(16.dp))
                    else -> Icon(Icons.Filled.RadioButtonUnchecked, null, tint = Palette.Muted, modifier = Modifier.size(16.dp))
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    e.content,
                    fontSize = 13.sp,
                    color = if (e.status == "in_progress") Palette.Text else Palette.Muted,
                    textDecoration = if (e.status == "completed") TextDecoration.LineThrough else null,
                )
            }
        }
    }
}
