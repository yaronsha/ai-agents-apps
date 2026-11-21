package dev.grokbuildremote.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import javax.security.auth.x500.X500Principal

/**
 * This phone's identity: a P-256 key generated inside the Android Keystore (StrongBox when the
 * phone has it). The private key can't be exported. The Keystore also makes a self-signed
 * certificate for it, which is what the bridge pins.
 */
object ClientKey {
    const val ALIAS = "gbr-client"
    private const val PROVIDER = "AndroidKeyStore"

    private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

    fun exists(): Boolean = keyStore().containsAlias(ALIAS)

    /** Throw away any old key and make a new one (used when pairing). */
    fun regenerate() {
        delete()
        try {
            generate(strongBox = true)
        } catch (e: StrongBoxUnavailableException) {
            generate(strongBox = false)
        }
    }

    fun delete() {
        val ks = keyStore()
        if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
    }

    private fun generate(strongBox: Boolean) {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_NONE)
            .setCertificateSubject(X500Principal("CN=Grok Build Remote phone"))
            .setIsStrongBoxBacked(strongBox)
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER).apply {
            initialize(spec)
            generateKeyPair()
        }
    }

    fun certificate(): X509Certificate =
        keyStore().getCertificate(ALIAS) as? X509Certificate ?: error("no client key; pair again")

    fun privateKey(): PrivateKey =
        keyStore().getKey(ALIAS, null) as? PrivateKey ?: error("no client key; pair again")

    fun fingerprint(): String = PairingCode.fingerprint(certificate().encoded)
}
