package dev.grokbuildremote.protocol

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/** One row of the session transcript. */
sealed interface Item {
    val key: String
}

data class UserText(override val key: String, val text: String) : Item
data class AgentText(override val key: String, val text: String) : Item
data class Thought(override val key: String, val text: String) : Item
data class PlanItem(override val key: String, val entries: List<PlanEntry>) : Item
data class ToolCall(
    override val key: String,
    val id: String,
    val title: String,
    val kind: String,
    val status: String,
    val diffs: List<FileDiff> = emptyList(),
    val output: String? = null,
) : Item

data class PlanEntry(val content: String, val status: String)
data class FileDiff(val path: String, val oldText: String?, val newText: String)
data class PermissionOption(val optionId: String, val name: String, val kind: String)

/** A question the agent is waiting on (tool permission, plan approval, …). */
data class PendingRequest(
    val id: JsonElement,
    val method: String,
    val toolCallId: String?,
    val title: String,
    val kind: String?,
    val command: String?,
    val options: List<PermissionOption>,
) {
    val isPermission get() = method == "session/request_permission"
}

data class SessionState(
    val sid: String,
    val items: List<Item> = emptyList(),
    val pending: PendingRequest? = null,
    /** Set while a prompt the phone sent is running. */
    val promptId: Long? = null,
    /** Text of the phone's own last prompt, to swallow the agent's echo of it. */
    val echoPending: String? = null,
    val echoSoFar: String = "",
    val nextKey: Int = 0,
) {
    val running get() = promptId != null

    fun withOwnPrompt(id: Long, text: String) = copy(
        items = items + UserText("i$nextKey", text),
        nextKey = nextKey + 1,
        promptId = id,
        echoPending = text,
        echoSoFar = "",
    )
}

object TranscriptReducer {
    private val SETTLED = setOf("in_progress", "completed", "failed")

    fun apply(state: SessionState, msg: JsonObject): SessionState {
        val method = msg.str("method")
        val id = msg["id"]
        return when {
            method == "session/update" -> onUpdate(state, msg.obj("params")?.obj("update") ?: return state)
            method != null && id != null && method in Acp.INTERACTION_METHODS ->
                state.copy(pending = parseRequest(method, id, msg.obj("params") ?: JsonObject(emptyMap())))
            method == null && id != null -> {
                val n = (id as? JsonPrimitive)?.longOrNull
                if (n != null && n == state.promptId) state.copy(promptId = null) else state
            }
            else -> state
        }
    }

    private fun onUpdate(state: SessionState, u: JsonObject): SessionState = when (u.str("sessionUpdate")) {
        "user_message_chunk" -> onUserChunk(state, contentText(u["content"]))
        "agent_message_chunk" -> appendText(state, contentText(u["content"])) { k, t -> AgentText(k, t) }
        "agent_thought_chunk" -> appendText(state, contentText(u["content"])) { k, t -> Thought(k, t) }
        "tool_call", "tool_call_update" -> onTool(state, u)
        "plan" -> onPlan(state, u)
        else -> state
    }

    private fun onUserChunk(state: SessionState, chunk: String): SessionState {
        val pending = state.echoPending
        if (pending != null) {
            val soFar = state.echoSoFar + chunk
            if (pending.startsWith(soFar)) {
                return if (soFar == pending) state.copy(echoPending = null, echoSoFar = "")
                else state.copy(echoSoFar = soFar)
            }
        }
        val cleared = state.copy(echoPending = null, echoSoFar = "")
        return appendText(cleared, chunk) { k, t -> UserText(k, t) }
    }

    private inline fun <reified T : Item> appendText(
        state: SessionState,
        chunk: String,
        make: (String, String) -> T,
    ): SessionState {
        if (chunk.isEmpty()) return state
        val last = state.items.lastOrNull()
        if (last is T) {
            val merged = when (last) {
                is AgentText -> last.copy(text = last.text + chunk)
                is UserText -> last.copy(text = last.text + chunk)
                is Thought -> last.copy(text = last.text + chunk)
                else -> null
            }
            if (merged != null) return state.copy(items = state.items.dropLast(1) + merged)
        }
        return state.copy(items = state.items + make("i${state.nextKey}", chunk), nextKey = state.nextKey + 1)
    }

    private fun onTool(state: SessionState, u: JsonObject): SessionState {
        val toolId = u.str("toolCallId") ?: return state
        val idx = state.items.indexOfFirst { it is ToolCall && it.id == toolId }
        val old = state.items.getOrNull(idx) as? ToolCall
        val (diffs, output) = parseToolContent(u["content"])
        val updated = ToolCall(
            key = old?.key ?: "t$toolId",
            id = toolId,
            title = u.str("title") ?: old?.title ?: "Tool",
            kind = u.str("kind") ?: old?.kind ?: "other",
            status = u.str("status") ?: old?.status ?: "pending",
            diffs = if (u.containsKey("content")) diffs else old?.diffs.orEmpty(),
            output = if (u.containsKey("content")) output else old?.output,
        )
        val items = if (idx >= 0) state.items.toMutableList().also { it[idx] = updated } else state.items + updated
        // Answered elsewhere (e.g. in the terminal): the tool moved on, so close our sheet.
        val pending = state.pending?.takeUnless { it.toolCallId == toolId && updated.status in SETTLED }
        return state.copy(items = items, pending = pending)
    }

    private fun onPlan(state: SessionState, u: JsonObject): SessionState {
        val entries = (u["entries"] as? JsonArray).orEmpty().mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            PlanEntry(o.str("content") ?: return@mapNotNull null, o.str("status") ?: "pending")
        }
        val idx = state.items.indexOfFirst { it is PlanItem }
        return if (idx >= 0) {
            state.copy(items = state.items.toMutableList().also { it[idx] = PlanItem("plan", entries) })
        } else {
            state.copy(items = state.items + PlanItem("plan", entries))
        }
    }

    private fun parseToolContent(content: JsonElement?): Pair<List<FileDiff>, String?> {
        val list = content as? JsonArray ?: return emptyList<FileDiff>() to null
        val diffs = mutableListOf<FileDiff>()
        val text = StringBuilder()
        for (c in list) {
            val o = c as? JsonObject ?: continue
            when (o.str("type")) {
                "diff" -> diffs += FileDiff(o.str("path") ?: "file", o.str("oldText"), o.str("newText") ?: "")
                "content" -> contentText(o["content"]).takeIf { it.isNotEmpty() }?.let {
                    if (text.isNotEmpty()) text.append('\n')
                    text.append(it)
                }
            }
        }
        return diffs to text.toString().ifEmpty { null }
    }

    private fun parseRequest(method: String, id: JsonElement, p: JsonObject): PendingRequest {
        val tool = p.obj("toolCall")
        val raw = tool?.obj("rawInput")
        val command = raw?.get("command")?.let { c ->
            when (c) {
                is JsonPrimitive -> c.contentOrNull
                is JsonArray -> c.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(" ")
                else -> null
            }
        }
        val options = (p["options"] as? JsonArray).orEmpty().mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            PermissionOption(
                optionId = o.str("optionId") ?: return@mapNotNull null,
                name = o.str("name") ?: o.str("optionId")!!,
                kind = o.str("kind") ?: "",
            )
        }
        return PendingRequest(
            id = id,
            method = method,
            toolCallId = tool?.str("toolCallId"),
            title = tool?.str("title") ?: p.str("question") ?: p.str("title") ?: method,
            kind = tool?.str("kind"),
            command = command,
            options = options,
        )
    }

    /** Text of an ACP content block (or a list of them). */
    fun contentText(c: JsonElement?): String = when (c) {
        is JsonObject -> if (c.str("type") == "text" || c.containsKey("text")) c.str("text").orEmpty() else ""
        is JsonArray -> c.joinToString("") { contentText(it) }
        else -> ""
    }
}

internal fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
internal fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

/** Parse a raw ACP message; null if it isn't a JSON object. */
fun parseAcp(raw: String): JsonObject? =
    runCatching { Wire.json.parseToJsonElement(raw).jsonObject }.getOrNull()
