package dev.grokbuildremote.data

import android.content.Context

/** The paired Mac (address + pinned fingerprint) and small settings. No secrets live here. */
class PairingStore(context: Context) {
    private val prefs = context.getSharedPreferences("pairing", Context.MODE_PRIVATE)

    val isPaired get() = addr != null && fingerprint != null
    val addr: String? get() = prefs.getString("addr", null)
    val fingerprint: String? get() = prefs.getString("fp", null)
    val deviceName: String? get() = prefs.getString("device", null)

    fun save(addr: String, fingerprint: String, deviceName: String) {
        prefs.edit().putString("addr", addr).putString("fp", fingerprint).putString("device", deviceName).apply()
    }

    fun clear() {
        prefs.edit().remove("addr").remove("fp").remove("device").apply()
    }

    /** "en-US" (default) or "he-IL". */
    var dictationLanguage: String
        get() = prefs.getString("dictation_lang", "en-US") ?: "en-US"
        set(v) = prefs.edit().putString("dictation_lang", v).apply()

    /** Languages the user agreed to send to the online recognizer. */
    fun onlineDictationAllowed(lang: String) = prefs.getBoolean("online_dictation_$lang", false)
    fun allowOnlineDictation(lang: String) = prefs.edit().putBoolean("online_dictation_$lang", true).apply()
}
