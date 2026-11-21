package dev.grokbuildremote.data

import android.os.Build
import dev.grokbuildremote.protocol.Envelope
import dev.grokbuildremote.protocol.QrPayload
import dev.grokbuildremote.protocol.Types
import dev.grokbuildremote.protocol.Wire
import dev.grokbuildremote.security.ClientKey
import dev.grokbuildremote.security.PairingCode
import dev.grokbuildremote.security.PinnedTls
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

sealed interface PairState {
    data object Idle : PairState
    data object Connecting : PairState
    /** Both sides computed the same code; waiting for "y" on the Mac. */
    data class ConfirmOnMac(val code: String) : PairState
    data object Paired : PairState
    data class Failed(val message: String) : PairState
}

/**
 * One-time pairing: new Keystore key, connect with the pinned bridge fingerprint from the QR code,
 * present the token, check that the code the Mac shows matches ours, wait for confirmation.
 */
class PairingClient(private val store: PairingStore) {
    private val _state = MutableStateFlow<PairState>(PairState.Idle)
    val state: StateFlow<PairState> = _state.asStateFlow()
    private var ws: WebSocket? = null

    fun start(qr: QrPayload) {
        cancel()
        _state.value = PairState.Connecting
        val name = Build.MODEL ?: "Android phone"
        try {
            ClientKey.regenerate()
        } catch (e: Exception) {
            _state.value = PairState.Failed("Couldn't create a key on this phone: ${e.message}")
            return
        }
        val expectedCode = PairingCode.compute(qr.fp, ClientKey.fingerprint())
        val request = Request.Builder().url("wss://${qr.addr}/v1").build()
        ws = PinnedTls.client(qr.fp).newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val payload = buildJsonObject {
                    put("token", qr.token)
                    put("name", name)
                }
                webSocket.send(Wire.encode(Envelope(type = Types.PAIR, payload = payload)))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val env = Wire.decode(text) ?: return
                when (env.type) {
                    Types.PAIRING -> {
                        val code = env.payloadString("code")
                        if (code != expectedCode) {
                            _state.value = PairState.Failed(
                                "The Mac's code doesn't match this phone. Don't confirm on the Mac; something is in between.",
                            )
                            webSocket.close(1000, "code mismatch")
                        } else {
                            _state.value = PairState.ConfirmOnMac(code)
                        }
                    }
                    Types.PAIRED -> {
                        store.save(qr.addr, qr.fp, env.payloadString("name") ?: name)
                        _state.value = PairState.Paired
                        webSocket.close(1000, "paired")
                    }
                    Types.ERROR -> {
                        _state.value = PairState.Failed(env.payloadString("message") ?: "Pairing failed")
                        webSocket.close(1000, null)
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (_state.value !is PairState.Paired) {
                    _state.value = PairState.Failed(
                        "Couldn't reach the Mac at ${qr.addr}. Is Tailscale on and `gbr serve` running? (${t.message})",
                    )
                }
            }
        })
    }

    fun cancel() {
        ws?.close(1000, "cancel")
        ws = null
        _state.value = PairState.Idle
    }
}
