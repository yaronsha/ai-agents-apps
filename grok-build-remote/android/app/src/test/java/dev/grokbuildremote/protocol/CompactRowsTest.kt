package dev.grokbuildremote.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CompactRowsTest {
    private fun tool(id: String, kind: String, status: String = "completed", diffs: List<FileDiff> = emptyList()) =
        ToolCall("t$id", id, "title $id", kind, status, diffs, output = "lots of file text")

    @Test
    fun readsAndSearchesBecomeOneLineAcrossThinking() {
        val rows = compactRows(
            listOf(
                UserText("i0", "Write the handoff"),
                tool("1", "read"),
                Thought("i1", "next look for usages"),
                tool("2", "search"),
                tool("3", "read"),
                tool("4", "search", status = "failed"),
                Thought("i2", "now write it"),
                tool("5", "edit", diffs = listOf(FileDiff("a.md", null, "x"))),
                tool("6", "execute"),
                AgentText("i3", "Done"),
            ),
        )
        assertEquals(listOf("i0", "gt1", "i2", "t5", "t6", "i3"), rows.map { it.key })
        val group = rows[1] as ExploreGroup
        assertEquals(listOf("1", "2", "3", "4"), group.calls.map { it.id })
        assertEquals("2 reads, 2 searches", group.summary)
        assertEquals(1, group.failed)
    }

    @Test
    fun aSingleReadIsStillOneQuietLine() {
        val rows = compactRows(listOf(tool("1", "read", status = "in_progress")))
        val group = rows.single() as ExploreGroup
        assertEquals("1 read", group.summary)
        assertTrue(group.running)
    }

    @Test
    fun thinkingBeforeAnyCallStaysVisible() {
        val rows = compactRows(listOf(Thought("i0", "hmm"), tool("1", "list_dir"), tool("2", "fetch")))
        assertEquals(listOf("i0", "gt1"), rows.map { it.key })
        assertEquals("1 listing, 1 fetch", (rows[1] as ExploreGroup).summary)
    }

    @Test
    fun toolTitlesAreShortened() {
        assertEquals("App.css", shortToolTitle("Edit `/Users/me/codex/frontend/src/App.css`", "Edit"))
        assertEquals("npm test", shortToolTitle("npm test", "Shell"))
        assertEquals("ls -la /tmp", shortToolTitle("ls -la /tmp", "Shell"))
    }
}
