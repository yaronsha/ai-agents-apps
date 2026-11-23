package dev.grokbuildremote.protocol

import kotlinx.serialization.Serializable

/** What the `gbr pair` QR code holds. */
@Serializable
data class QrPayload(val gbr: Int, val addr: String, val fp: String, val token: String) {
    companion object {
        private val FP = Regex("^[0-9a-f]{64}$")
        private val ADDR = Regex("^[A-Za-z0-9.:\\[\\]-]+:[0-9]{1,5}$")

        /** Parse and validate; null if this isn't a Grok Build Remote pairing code. */
        fun parse(text: String): QrPayload? {
            val p = runCatching { Wire.json.decodeFromString(serializer(), text.trim()) }.getOrNull()
                ?: return null
            if (p.gbr != 1 || !FP.matches(p.fp) || !ADDR.matches(p.addr) || p.token.length < 16) return null
            return p
        }
    }
}
