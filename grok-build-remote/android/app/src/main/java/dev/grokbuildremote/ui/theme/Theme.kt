package dev.grokbuildremote.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily

/** Colors from the mockup. Dark only. */
object Palette {
    val Ground = Color(0xFF0F1115)
    val Surface = Color(0xFF171A21)
    val Surface2 = Color(0xFF1F232C)
    val Bubble = Color(0xFF232833)
    val Border = Color(0xFF2A2F3A)
    val Text = Color(0xFFE8EAED)
    val Body = Color(0xFFD5D8DD)
    val Muted = Color(0xFF9AA0AA)
    val Accent = Color(0xFF7DD3FC)
    val OnAccent = Color(0xFF0B1620)
    val Warn = Color(0xFFF5C46B)
    val WarnBg = Color(0xFF3A2C0E)
    val WarnSurface = Color(0xFF1E1A12)
    val WarnBorder = Color(0xFF5C4618)
    val Good = Color(0xFF4ADE80)
    val Bad = Color(0xFFFCA5A5)
    val BadBorder = Color(0xFF5B2A2A)
    val AddBg = Color(0xFF12261A)
    val AddText = Color(0xFFA7F3C0)
    val DelBg = Color(0xFF2A1416)
    val DelText = Color(0xFFFECACA)
    val Code = Color(0xFF0C0E12)
}

val Mono = FontFamily.Monospace

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.Accent,
            onPrimary = Palette.OnAccent,
            background = Palette.Ground,
            onBackground = Palette.Text,
            surface = Palette.Surface,
            onSurface = Palette.Text,
            surfaceVariant = Palette.Surface2,
            onSurfaceVariant = Palette.Muted,
            outline = Palette.Border,
            error = Palette.Bad,
        ),
        content = content,
    )
}
