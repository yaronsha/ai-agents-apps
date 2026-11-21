package dev.grokbuildremote.data

import android.os.Build
import dev.grokbuildremote.protocol.Acp
import dev.grokbuildremote.protocol.Envelope
import dev.grokbuildremote.protocol.PendingRequest
import dev.grokbuildremote.protocol.SessionState
import dev.grokbuildremote.protocol.TranscriptReducer
import dev.grokbuildremote.protocol.Types
import dev.grokbuildremote.protocol.Wire
import dev.grokbuildremote.protocol.parseAcp
import dev.grokbuildremote.security.PinnedTls
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

data class SessionInfo(val sessionId: String, val cwd: String, val title: String, val updatedAt: String?)

sealed interface Conn {
    data object Unpaired : Conn
    data object Disconnected : Conn
    data object Connecting : Conn
    data class Connected(val device: String, val grokVersion: String) : Conn
    data class Failed(val message: String) : Conn
}

/**
 * The one connection to the paired Mac. Keeps per-session transcript state, re-attaches after a
 * dropped connection and asks only for what it missed (by sequence number).
 */
class BridgeClient(private val store: PairingStore, private val scope: CoroutineScope) {
    private val _conn = MutableStateFlow<Conn>(if (store.isPaired) Conn.Disconnected else Conn.Unpaired)
    val conn: StateFlow<Conn> = _conn.asStateFlow()

    private val _sessions = MutableStateFlow<List<SessionInfo>>(emptyList())
    val sessions: StateFlow<List<SessionInfo>> = _sessions.asStateFlow()

    private val _attached = MutableStateFlow<Set<String>>(emptySet())
    val attached: StateFlow<Set<String>> = _attached.asStateFlow()

    private val _needsYou = MutableStateFlow<Set<String>>(emptySet())
    /** Sessions with an approval or question waiting. */
    val needsYou: StateFlow<Set<String>> = _needsYou.asStateFlow()

    private val _opened = MutableSharedFlow<SessionInfo>(extraBufferCapacity = 4)
    /** Sessions created from the phone, to open once the bridge has attached them. */
    val opened: SharedFlow<SessionInfo> = _opened

    @Volatile private var pendingNewCwd: String? = null

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 16)
    /** Short messages for a snackbar: errors and bridge notices. */
    val messages: SharedFlow<String> = _messages

    private val states = ConcurrentHashMap<String, MutableStateFlow<SessionState>>()
    private val lastSeq = ConcurrentHashMap<String, Long>()
    private val wanted = ConcurrentHashMap<String, String>() // sid → cwd, re-attached on reconnect
    private val nextId = AtomicLong(1)

    @Volatile private var ws: WebSocket? = null
    @Volatile private var wantConnection = false
    private var reconnectJob: Job? = null
    private var backoffMs = 1_000L

    fun session(sid: String): StateFlow<SessionState> =
        states.getOrPut(sid) { MutableStateFlow(SessionState(sid)) }.asStateFlow()

    fun connect() {
        if (!store.isPaired) {
            _conn.value = Conn.Unpaired
            return
        }
        wantConnection = true
        if (ws == null) open()
    }

    fun disconnect() {
        wantConnection = false
        reconnectJob?.cancel()
        ws?.close(1000, "bye")
        ws = null
        _conn.value = if (store.isPaired) Conn.Disconnected else Conn.Unpaired
    }

    /** Forget everything after unpairing. */
    fun reset() {
        disconnect()
        states.clear()
        lastSeq.clear()
        wanted.clear()
        _attached.value = emptySet()
        _needsYou.value = emptySet()
        _sessions.value = emptyList()
        _conn.value = Conn.Unpaired
    }

    private fun open() {
        val addr = store.addr ?: return
        val fp = store.fingerprint ?: return
        _conn.value = Conn.Connecting
        val request = Request.Builder().url("wss://$addr/v1").build()
        ws = PinnedTls.client(fp).newWebSocket(request, Listener())
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            backoffMs = 1_000L
            val hello = buildJsonObject {
                put("device", Build.MODEL)
                put("appVersion", "0.1.0")
                putJsonObject("lastSeq") { lastSeq.forEach { (sid, n) -> put(sid, n) } }
            }
            webSocket.send(Wire.encode(Envelope(type = Types.HELLO, payload = hello)))
            webSocket.send(Wire.encode(Envelope(type = Types.SESSIONS_LIST)))
            wanted.forEach { (sid, cwd) -> sendAttach(webSocket, sid, cwd) }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val env = Wire.decode(text) ?: return
            handle(env)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(webSocket, null)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
            dropped(webSocket, t.message ?: t.javaClass.simpleName)
    }

    private fun dropped(socket: WebSocket, error: String?) {
        if (ws !== socket) return
        ws = null
        _attached.value = emptySet()
        if (!wantConnection) return
        _conn.value = if (error != null) Conn.Failed(error) else Conn.Disconnected
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
            if (wantConnection && ws == null) open()
        }
    }

    private fun handle(env: Envelope) {
        when (env.type) {
            Types.WELCOME -> _conn.value = Conn.Connected(
                device = env.payloadString("device") ?: "",
                grokVersion = env.payloadString("grokVersion") ?: "?",
            )
            Types.SESSIONS -> _sessions.value = parseSessions(env.payload as? JsonObject)
            Types.ATTACHED -> env.sid?.let { sid ->
                _attached.update { it + sid }
                val newCwd = pendingNewCwd
                if (!wanted.containsKey(sid) && newCwd != null) {
                    pendingNewCwd = null
                    wanted[sid] = newCwd
                    _opened.tryEmit(SessionInfo(sid, newCwd, "New session", null))
                    refreshSessions()
                }
            }
            Types.ACP -> {
                val sid = env.sid ?: return
                env.seq?.let { lastSeq[sid] = it }
                val raw = (env.payload as? JsonPrimitive)?.contentOrNull ?: return
                val msg = parseAcp(raw) ?: return
                val flow = states.getOrPut(sid) { MutableStateFlow(SessionState(sid)) }
                flow.update { TranscriptReducer.apply(it, msg) }
                updateNeedsYou(sid, flow.value)
            }
            Types.STATUS -> {
                val code = env.payloadString("code")
                env.payloadString("message")?.let { _messages.tryEmit(it) }
                if (code == "agent_exited") env.sid?.let { sid -> _attached.update { it - sid } }
            }
            Types.ERROR -> {
                val code = env.payloadString("code")
                _messages.tryEmit(env.payloadString("message") ?: code ?: "Error")
                if (code == "not_paired" || code == "revoked") {
                    wantConnection = false
                    _conn.value = Conn.Failed("This phone is no longer paired with the Mac.")
                }
            }
        }
    }

    private fun updateNeedsYou(sid: String, state: SessionState) {
        _needsYou.update { if (state.pending != null) it + sid else it - sid }
    }

    private fun parseSessions(payload: JsonObject?): List<SessionInfo> {
        val list = payload?.get("sessions") as? JsonArray ?: return emptyList()
        return list.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            fun s(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull
            val sid = s("sessionId") ?: return@mapNotNull null
            SessionInfo(sid, s("cwd") ?: "", s("title") ?: "Untitled session", s("updatedAt"))
        }
    }

    fun refreshSessions() = send(Envelope(type = Types.SESSIONS_LIST))

    /** Follow a session. If offline, it's attached as soon as the connection is back. */
    fun attach(sid: String, cwd: String) {
        wanted[sid] = cwd
        ws?.let { sendAttach(it, sid, cwd) }
    }

    private fun sendAttach(socket: WebSocket, sid: String, cwd: String) {
        val payload = buildJsonObject { put("cwd", cwd) }
        socket.send(Wire.encode(Envelope(type = Types.ATTACH, sid = sid, payload = payload)))
    }

    fun detach(sid: String) {
        wanted.remove(sid)
        send(Envelope(type = Types.DETACH, sid = sid))
        _attached.update { it - sid }
    }

    fun newSession(cwd: String) {
        pendingNewCwd = cwd
        send(Envelope(type = Types.SESSION_NEW, payload = buildJsonObject { put("cwd", cwd) }))
    }

    fun prompt(sid: String, text: String) {
        val id = nextId.getAndIncrement()
        if (send(Envelope.acp(sid, Acp.prompt(id, sid, text)))) {
            states.getOrPut(sid) { MutableStateFlow(SessionState(sid)) }.update { it.withOwnPrompt(id, text) }
        }
    }

    fun cancel(sid: String) {
        send(Envelope.acp(sid, Acp.cancel(sid)))
    }

    fun answer(sid: String, request: PendingRequest, optionId: String) {
        if (send(Envelope.acp(sid, Acp.permissionAnswer(request.id, optionId)))) {
            states[sid]?.let { flow ->
                flow.update { if (it.pending == request) it.copy(pending = null) else it }
                updateNeedsYou(sid, flow.value)
            }
        }
    }

    private fun send(env: Envelope): Boolean {
        val ok = ws?.send(Wire.encode(env)) ?: false
        if (!ok) _messages.tryEmit("Not connected to the Mac")
        return ok
    }
}
