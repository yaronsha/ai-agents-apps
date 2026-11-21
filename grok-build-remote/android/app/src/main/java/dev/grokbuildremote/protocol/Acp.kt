package dev.grokbuildremote.protocol

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/** Builders for the few ACP messages the phone sends. */
object Acp {
    val INTERACTION_METHODS = setOf(
        "session/request_permission",
        "x.ai/ask_user_question",
        "x.ai/exit_plan_mode",
        "x.ai/mcp/elicit",
    )

    fun prompt(id: Long, sessionId: String, text: String): String = buildJsonObject {
        put("jsonrpc", "2.0")
        put("id", id)
        put("method", "session/prompt")
        putJsonObject("params") {
            put("sessionId", sessionId)
            putJsonArray("prompt") {
                addJsonObject {
                    put("type", "text")
                    put("text", text)
                }
            }
        }
    }.toString()

    fun cancel(sessionId: String): String = buildJsonObject {
        put("jsonrpc", "2.0")
        put("method", "session/cancel")
        putJsonObject("params") { put("sessionId", sessionId) }
    }.toString()

    /** Answer a permission request with one of its options. */
    fun permissionAnswer(requestId: JsonElement, optionId: String): String = buildJsonObject {
        put("jsonrpc", "2.0")
        put("id", requestId)
        putJsonObject("result") {
            putJsonObject("outcome") {
                put("outcome", "selected")
                put("optionId", optionId)
            }
        }
    }.toString()
}
