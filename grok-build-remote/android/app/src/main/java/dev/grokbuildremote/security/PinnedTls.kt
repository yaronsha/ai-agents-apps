package dev.grokbuildremote.security

import java.net.Socket
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.X509TrustManager
import okhttp3.ConnectionSpec
import okhttp3.OkHttpClient
import okhttp3.TlsVersion

/**
 * TLS to the bridge: TLS 1.3 only, the bridge certificate pinned by fingerprint (no certificate
 * authority, no hostname check: the fingerprint came from the QR code), and this phone's
 * Keystore key as the client certificate.
 */
object PinnedTls {
    fun client(bridgeFingerprint: String): OkHttpClient {
        val trust = PinnedTrustManager(bridgeFingerprint)
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(arrayOf(KeystoreKeyManager), arrayOf(trust), null)
        val spec = ConnectionSpec.Builder(ConnectionSpec.RESTRICTED_TLS)
            .tlsVersions(TlsVersion.TLS_1_3)
            .build()
        return OkHttpClient.Builder()
            .sslSocketFactory(ctx.socketFactory, trust)
            // Identity is the pinned fingerprint, not a hostname (we connect to a VPN IP).
            .hostnameVerifier { _, _ -> true }
            .connectionSpecs(listOf(spec))
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()
    }
}

class PinnedTrustManager(private val expected: String) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String?) {
        val leaf = chain.firstOrNull() ?: throw CertificateException("no bridge certificate")
        if (PairingCode.fingerprint(leaf.encoded) != expected) {
            throw CertificateException("This isn't the Mac you paired with (certificate fingerprint changed).")
        }
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String?) {
        throw CertificateException("not a server")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/** Always presents the Keystore key and its certificate. */
object KeystoreKeyManager : X509ExtendedKeyManager() {
    override fun chooseClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?) =
        ClientKey.ALIAS

    override fun chooseEngineClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, engine: SSLEngine?) =
        ClientKey.ALIAS

    override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf(ClientKey.ALIAS)

    override fun getCertificateChain(alias: String?): Array<X509Certificate> = arrayOf(ClientKey.certificate())

    override fun getPrivateKey(alias: String?): PrivateKey = ClientKey.privateKey()

    override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?): Array<String>? = null

    override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?): String? = null
}
