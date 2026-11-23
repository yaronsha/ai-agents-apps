package dev.grokbuildremote

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import dev.grokbuildremote.data.BridgeClient
import dev.grokbuildremote.data.PairingClient
import dev.grokbuildremote.data.PairingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class GrokBuildRemoteApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    lateinit var store: PairingStore
        private set
    lateinit var bridge: BridgeClient
        private set
    lateinit var pairing: PairingClient
        private set

    override fun onCreate() {
        super.onCreate()
        store = PairingStore(this)
        bridge = BridgeClient(store, scope)
        pairing = PairingClient(store)
        createChannels()
    }

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Grok is waiting for you to approve something"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_TURNS, "Finished turns", NotificationManager.IMPORTANCE_DEFAULT),
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_CONNECTION, "Connection", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Shown while the app keeps the connection to your Mac open"
            },
        )
    }

    companion object {
        const val CHANNEL_APPROVALS = "approvals"
        const val CHANNEL_TURNS = "turns"
        const val CHANNEL_CONNECTION = "connection"
    }
}
