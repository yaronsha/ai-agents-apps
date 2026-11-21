package dev.grokbuildremote.ui

import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dev.grokbuildremote.ui.theme.Palette
import java.time.Duration
import java.time.Instant

fun Modifier.card(
    radius: Dp = 16.dp,
    fill: Color = Palette.Surface,
    stroke: Color = Palette.Border,
): Modifier = this
    .clip(RoundedCornerShape(radius))
    .background(fill)
    .border(1.dp, stroke, RoundedCornerShape(radius))

@Composable
fun Dot(color: Color, size: Dp = 8.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(color))
}

/** "now", "5m", "3h", "Yesterday", "4d" from an ISO-8601 timestamp. */
fun relativeTime(iso: String?, now: Instant = Instant.now()): String {
    val t = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return ""
    val d = Duration.between(t, now)
    return when {
        d.toMinutes() < 1 -> "now"
        d.toMinutes() < 60 -> "${d.toMinutes()}m"
        d.toHours() < 24 -> "${d.toHours()}h"
        d.toDays() < 2 -> "Yesterday"
        else -> "${d.toDays()}d"
    }
}

fun folderName(cwd: String): String = cwd.trimEnd('/').substringAfterLast('/').ifEmpty { cwd }

tailrec fun Context.findActivity(): FragmentActivity? = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** Fingerprint (or screen lock on Android 11+) before a risky approval goes out. */
fun requireUserPresence(
    activity: FragmentActivity,
    title: String,
    onOk: () -> Unit,
    onFail: (String) -> Unit,
) {
    val authenticators = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        BIOMETRIC_STRONG or DEVICE_CREDENTIAL
    } else {
        BIOMETRIC_STRONG
    }
    if (BiometricManager.from(activity).canAuthenticate(authenticators) != BiometricManager.BIOMETRIC_SUCCESS) {
        onFail("Set up a fingerprint or screen lock on this phone to approve from it.")
        return
    }
    val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setSubtitle("Grok Build Remote")
        .setAllowedAuthenticators(authenticators)
        .apply { if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) setNegativeButtonText("Cancel") }
        .build()
    BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(activity),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onOk()
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) =
                onFail(errString.toString())
        },
    ).authenticate(info)
}
