package dev.grokbuildremote.security

import java.security.MessageDigest
import java.util.Locale

/** Pure helpers shared with the bridge (keep in sync with bridge/src/pairing.rs and tls.rs). */
object PairingCode {
    /** The 6-digit code both screens show while pairing. */
    fun compute(serverFp: String, clientFp: String): String {
        val d = MessageDigest.getInstance("SHA-256").digest("gbr-pair-v1:$serverFp:$clientFp".toByteArray())
        val n = ((d[0].toLong() and 0xff) shl 24) or
            ((d[1].toLong() and 0xff) shl 16) or
            ((d[2].toLong() and 0xff) shl 8) or
            (d[3].toLong() and 0xff)
        return String.format(Locale.ROOT, "%06d", n % 1_000_000)
    }

    /** Lowercase hex SHA-256, the fingerprint format the bridge uses. */
    fun fingerprint(der: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { String.format(Locale.ROOT, "%02x", it) }

    fun display(fp: String): String = fp.chunked(4).joinToString(" ") { it.uppercase(Locale.ROOT) }
}
