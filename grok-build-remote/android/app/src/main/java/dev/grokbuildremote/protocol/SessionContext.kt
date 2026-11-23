package dev.grokbuildremote.protocol

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/** What Grok's `/context` shows for a session, from the bridge's `session.info` answer. */
data class SessionContext(
    val model: String?,
    val turns: Long?,
    val used: Long,
    val total: Long,
    val free: Long?,
    val usagePct: Int,
    val autoCompactPct: Long?,
    val compactions: Long?,
    val parts: List<Part>,
) {
    data class Part(val label: String, val tokens: Long, val detail: String? = null)

    companion object {
        fun parse(payload: JsonElement?): SessionContext? {
            val info = payload as? JsonObject ?: return null
            val ctx = info["context"] as? JsonObject ?: return null
            fun JsonObject.long(k: String) = (this[k] as? JsonPrimitive)?.longOrNull
            fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
            val used = ctx.long("used") ?: return null
            val total = ctx.long("total") ?: return null
            val parts = buildList {
                ctx.long("systemPromptTokens")?.let { add(Part("System prompt", it)) }
                ctx.long("toolDefinitionsTokens")?.let {
                    add(Part("Tools", it, ctx.long("toolDefinitionsCount")?.let { n -> "$n tools" }))
                }
                ctx.long("messageTokens")?.let {
                    add(Part("Messages", it, ctx.long("messageCount")?.let { n -> "$n messages" }))
                }
                (ctx["usageCategories"] as? JsonArray).orEmpty().forEach { c ->
                    val o = c as? JsonObject ?: return@forEach
                    val label = o.str("label") ?: return@forEach
                    add(Part(label, o.long("tokens") ?: 0, o.str("detail")))
                }
            }
            return SessionContext(
                model = info.str("modelDisplayName") ?: info.str("model"),
                turns = info.long("turns"),
                used = used,
                total = total,
                free = ctx.long("freeTokens"),
                usagePct = ctx.long("usagePct")?.toInt() ?: if (total > 0) (used * 100 / total).toInt() else 0,
                autoCompactPct = ctx.long("autoCompactThresholdPercent"),
                compactions = ctx.long("compactionCount"),
                parts = parts,
            )
        }

        /** 161439 → "161k", 1200 → "1.2k", 900 → "900". */
        fun tokens(n: Long): String = when {
            n >= 10_000 -> "${n / 1000}k"
            n >= 1000 -> String.format(java.util.Locale.ROOT, "%.1fk", n / 1000.0)
            else -> n.toString()
        }
    }
}
