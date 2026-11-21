package dev.grokbuildremote.service

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import dev.grokbuildremote.GrokBuildRemoteApp
import dev.grokbuildremote.MainActivity
import dev.grokbuildremote.R
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Keeps the connection to the Mac open while you follow a session, so approval requests and
 * finished turns reach you as notifications when the app is in the background. No Firebase:
 * everything comes over the same encrypted connection. Stops itself when no session is attached.
 */
class BridgeService : LifecycleService() {
    private val app get() = application as GrokBuildRemoteApp
    private val watchers = mutableMapOf<String, Job>()
    private val notified = mutableSetOf<String>()

    override fun onCreate() {
        super.onCreate()
        startInForeground(0)
        lifecycleScope.launch {
            app.bridge.attached.collectLatest { sids ->
                if (sids.isEmpty()) {
                    stopSelf()
                    return@collectLatest
                }
                startInForeground(sids.size)
                (watchers.keys - sids).forEach { watchers.remove(it)?.cancel() }
                (sids - watchers.keys).forEach { sid -> watchers[sid] = watch(sid) }
            }
        }
    }

    private fun watch(sid: String) = lifecycleScope.launch {
        var wasRunning = false
        app.bridge.session(sid).collect { state ->
            val pending = state.pending
            if (pending != null) {
                val key = "$sid/${pending.id}"
                if (notified.add(key) && inBackground()) {
                    notify(
                        sid.hashCode(),
                        GrokBuildRemoteApp.CHANNEL_APPROVALS,
                        "Grok needs your approval",
                        pending.command ?: pending.title,
                        sid,
                    )
                }
            }
            if (wasRunning && !state.running && inBackground()) {
                notify(sid.hashCode() + 1, GrokBuildRemoteApp.CHANNEL_TURNS, "Grok finished", "Tap to see the result", sid)
            }
            wasRunning = state.running
        }
    }

    private fun inBackground() =
        !ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    private fun openIntent(sid: String?): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (sid != null) intent.putExtra(MainActivity.EXTRA_SESSION, sid)
        return PendingIntent.getActivity(
            this,
            sid?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun notify(id: Int, channel: String, title: String, text: String, sid: String) {
        val n = NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openIntent(sid))
            .build()
        try {
            NotificationManagerCompat.from(this).notify(id, n)
        } catch (e: SecurityException) {
            // Notifications not allowed; the app still works.
        }
    }

    private fun startInForeground(count: Int) {
        val text = if (count == 1) "Following 1 session on your Mac" else "Following $count sessions on your Mac"
        val n: Notification = NotificationCompat.Builder(this, GrokBuildRemoteApp.CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Grok Build Remote")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(openIntent(null))
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    companion object {
        private const val NOTIFICATION_ID = 1

        /** Call while the app is visible (Android forbids starting it from the background). */
        fun start(context: Context) {
            context.startForegroundService(Intent(context, BridgeService::class.java))
        }
    }
}
