package dev.grokbuildremote.protocol

enum class DiffKind { ADD, DEL, SAME }

data class DiffLine(val kind: DiffKind, val text: String)

/** A small line diff for showing edits inside tool cards. */
object LineDiff {
    private const val MAX_CELLS = 250_000

    fun compute(oldText: String?, newText: String): List<DiffLine> {
        val b = newText.lines()
        if (oldText == null) return b.map { DiffLine(DiffKind.ADD, it) }
        val a = oldText.lines()
        if (a.size.toLong() * b.size > MAX_CELLS) {
            return a.map { DiffLine(DiffKind.DEL, it) } + b.map { DiffLine(DiffKind.ADD, it) }
        }
        // Longest common subsequence table, filled from the end.
        val lcs = Array(a.size + 1) { IntArray(b.size + 1) }
        for (i in a.indices.reversed()) {
            for (j in b.indices.reversed()) {
                lcs[i][j] = if (a[i] == b[j]) lcs[i + 1][j + 1] + 1 else maxOf(lcs[i + 1][j], lcs[i][j + 1])
            }
        }
        val out = ArrayList<DiffLine>(a.size + b.size)
        var i = 0
        var j = 0
        while (i < a.size && j < b.size) {
            when {
                a[i] == b[j] -> { out += DiffLine(DiffKind.SAME, a[i]); i++; j++ }
                lcs[i + 1][j] >= lcs[i][j + 1] -> { out += DiffLine(DiffKind.DEL, a[i]); i++ }
                else -> { out += DiffLine(DiffKind.ADD, b[j]); j++ }
            }
        }
        while (i < a.size) out += DiffLine(DiffKind.DEL, a[i++])
        while (j < b.size) out += DiffLine(DiffKind.ADD, b[j++])
        return out
    }

    /** Only changed lines plus [context] unchanged lines around them. */
    fun hunks(lines: List<DiffLine>, context: Int = 2): List<DiffLine> {
        val keep = BooleanArray(lines.size)
        lines.forEachIndexed { idx, l ->
            if (l.kind != DiffKind.SAME) {
                for (k in maxOf(0, idx - context)..minOf(lines.lastIndex, idx + context)) keep[k] = true
            }
        }
        return lines.filterIndexed { idx, _ -> keep[idx] }
    }
}
