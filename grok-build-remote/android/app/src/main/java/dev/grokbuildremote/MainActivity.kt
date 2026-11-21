package dev.grokbuildremote

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.grokbuildremote.data.SessionInfo
import dev.grokbuildremote.service.BridgeService
import dev.grokbuildremote.ui.pairing.PairScreen
import dev.grokbuildremote.ui.session.SessionScreen
import dev.grokbuildremote.ui.sessions.SessionsScreen
import dev.grokbuildremote.ui.settings.SettingsScreen
import dev.grokbuildremote.ui.theme.AppTheme
import dev.grokbuildremote.ui.theme.Palette

/** FragmentActivity because BiometricPrompt needs one. */
class MainActivity : FragmentActivity() {
    private val openSession = mutableStateOf<String?>(null)
    private val app get() = application as GrokBuildRemoteApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        openSession.value = intent?.getStringExtra(EXTRA_SESSION)
        setContent {
            AppTheme { AppRoot(app, openSession) }
        }
    }

    override fun onStart() {
        super.onStart()
        app.bridge.connect()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_SESSION)?.let { openSession.value = it }
    }

    companion object {
        const val EXTRA_SESSION = "session"
    }
}

sealed interface Screen {
    data object Pair : Screen
    data object Sessions : Screen
    data class Session(val info: SessionInfo) : Screen
    data object Settings : Screen
}

@Composable
private fun AppRoot(app: GrokBuildRemoteApp, openSession: MutableState<String?>) {
    var screen by remember { mutableStateOf<Screen>(if (app.store.isPaired) Screen.Sessions else Screen.Pair) }
    val attached by app.bridge.attached.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current

    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // Open the session a notification pointed at.
    LaunchedEffect(openSession.value) {
        val sid = openSession.value ?: return@LaunchedEffect
        val info = app.bridge.sessions.value.find { it.sessionId == sid } ?: SessionInfo(sid, "", "Session", null)
        screen = Screen.Session(info)
        openSession.value = null
    }

    // A new session started from the phone: open it.
    LaunchedEffect(Unit) {
        app.bridge.opened.collect { screen = Screen.Session(it) }
    }

    // While something is attached, keep the connection in a foreground service (started while visible).
    LaunchedEffect(attached.isNotEmpty()) {
        if (attached.isNotEmpty()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            BridgeService.start(context)
        }
    }

    LaunchedEffect(Unit) {
        app.bridge.messages.collect { snackbar.showSnackbar(it) }
    }

    BackHandler(enabled = screen is Screen.Session || screen is Screen.Settings) {
        screen = Screen.Sessions
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Palette.Ground)
            .systemBarsPadding(),
    ) {
        when (val s = screen) {
            Screen.Pair -> PairScreen(app.pairing) {
                app.bridge.connect()
                screen = Screen.Sessions
            }
            Screen.Sessions -> SessionsScreen(
                app = app,
                onOpen = { screen = Screen.Session(it) },
                onSettings = { screen = Screen.Settings },
            )
            is Screen.Session -> SessionScreen(app, s.info) { screen = Screen.Sessions }
            Screen.Settings -> SettingsScreen(
                app = app,
                onBack = { screen = Screen.Sessions },
                onUnpaired = { screen = Screen.Pair },
            )
        }
        SnackbarHost(
            snackbar,
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 88.dp),
        )
    }
}
