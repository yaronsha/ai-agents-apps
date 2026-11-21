package dev.grokbuildremote.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * The phone ⇄ bridge envelope, protocol v1 (see grok-build-remote/docs/protocol.md).
 * For type "acp" the payload is a raw ACP JSON-RPC message as a string.
 */
@Serializable
data class Envelope(
    val v: Int = PROTOCOL_VERSION,
    val type: String,
    val sid: String? = null,
    val seq: Long? = null,
    val payload: JsonElement? = null,
) {
    fun payloadString(key: String): String? =
        (payload as? JsonObject)?.get(key)?.jsonPrimitive?.contentOrNull

    companion object {
        const val PROTOCOL_VERSION = 1

        fun acp(sid: String, raw: String) = Envelope(type = Types.ACP, sid = sid, payload = JsonPrimitive(raw))
    }
}

object Types {
    // phone → bridge
    const val HELLO = "hello"
    const val PAIR = "pair"
    const val SESSIONS_LIST = "sessions.list"
    const val SESSION_NEW = "session.new"
    const val ATTACH = "attach"
    const val DETACH = "detach"
    const val ACP = "acp"
    const val PING = "ping"

    // bridge → phone
    const val WELCOME = "welcome"
    const val PAIRING = "pairing"
    const val PAIRED = "paired"
    const val SESSIONS = "sessions"
    const val ATTACHED = "attached"
    const val STATUS = "bridge.status"
    const val ERROR = "error"
    const val PONG = "pong"
}

object Wire {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    fun encode(e: Envelope): String = json.encodeToString(Envelope.serializer(), e)

    /** Null for anything that isn't a v1 envelope. */
    fun decode(text: String): Envelope? =
        runCatching { json.decodeFromString(Envelope.serializer(), text) }
            .getOrNull()
            ?.takeIf { it.v == Envelope.PROTOCOL_VERSION }
}
