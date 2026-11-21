package dev.grokbuildremote.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class LineDiffTest {
    @Test
    fun newFileIsAllAdds() {
        val d = LineDiff.compute(null, "a\nb")
        assertEquals(listOf(DiffKind.ADD, DiffKind.ADD), d.map { it.kind })
    }

    @Test
    fun findsChangedLines() {
        val d = LineDiff.compute("a\nb\nc", "a\nB\nc")
        assertEquals(
            listOf(DiffKind.SAME, DiffKind.DEL, DiffKind.ADD, DiffKind.SAME),
            d.map { it.kind },
        )
        assertEquals("B", d[2].text)
    }

    @Test
    fun hunksKeepContextOnly() {
        val old = (1..20).joinToString("\n") { "l$it" }
        val new = old.replace("l10", "X")
        val h = LineDiff.hunks(LineDiff.compute(old, new), context = 1)
        assertEquals(listOf("l9", "l10", "X", "l11"), h.map { it.text })
    }
}
