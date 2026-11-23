package dev.grokbuildremote.protocol

/** A row of the session screen: one transcript item, or a run of look-around tool calls shown as one line. */
sealed interface ScreenRow {
    val key: String
}

data class Single(val item: Item) : ScreenRow {
    override val key get() = item.key
}

/**
 * Reads, searches, listings and fetches in a row, shown as one "Explored" line like the terminal
 * does. Thinking between the calls is folded into the line too, as the terminal hides it.
 */
data class ExploreGroup(override val key: String, val calls: List<ToolCall>) : ScreenRow {
    val running get() = calls.any { it.status == "in_progress" || it.status == "pending" }
    val failed get() = calls.count { it.status == "failed" }

    /** "3 reads, 2 searches". */
    val summary: String
        get() = calls.groupBy { exploreNoun(it.kind) }.entries
            .joinToString(", ") { (noun, list) -> "${list.size} ${if (list.size == 1) noun else plural(noun)}" }
}

private val EXPLORE_KINDS = setOf(
    "read", "search", "search_tool", "list_dir", "list", "fetch", "web_fetch", "web_search", "think",
)

fun isExplore(item: Item) = item is ToolCall && item.kind in EXPLORE_KINDS && item.diffs.isEmpty()

private fun plural(noun: String) = if (noun.endsWith("h")) noun + "es" else noun + "s"

private fun exploreNoun(kind: String) = when (kind) {
    "read" -> "read"
    "search", "search_tool", "web_search" -> "search"
    "list_dir", "list" -> "listing"
    "fetch", "web_fetch" -> "fetch"
    else -> "step"
}

/** Groups each run of look-around tool calls (with any thinking between them) into one row. */
fun compactRows(items: List<Item>): List<ScreenRow> {
    val rows = mutableListOf<ScreenRow>()
    var i = 0
    while (i < items.size) {
        if (!isExplore(items[i])) {
            rows += Single(items[i])
            i++
            continue
        }
        val calls = mutableListOf<ToolCall>()
        var end = i
        var j = i
        while (j < items.size && (isExplore(items[j]) || items[j] is Thought)) {
            if (isExplore(items[j])) {
                calls += items[j] as ToolCall
                end = j
            }
            j++
        }
        rows += ExploreGroup("g${calls.first().key}", calls)
        // Thinking after the last call stays visible on its own.
        for (k in end + 1 until j) rows += Single(items[k])
        i = j
    }
    return rows
}
