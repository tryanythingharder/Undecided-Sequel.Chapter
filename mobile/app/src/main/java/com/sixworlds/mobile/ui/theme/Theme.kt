package com.sixworlds.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 底色与桌面端一致（#161618），琥珀色点缀呼应黑猫图标
private val DarkScheme = darkColorScheme(
    primary = Color(0xFFF0B350),
    onPrimary = Color(0xFF221500),
    primaryContainer = Color(0xFF3D3220),
    onPrimaryContainer = Color(0xFFFFDDB0),
    background = Color(0xFF161618),
    onBackground = Color(0xFFE5E1D8),
    surface = Color(0xFF1B1B1E),
    onSurface = Color(0xFFE5E1D8),
    surfaceVariant = Color(0xFF26262A),
    onSurfaceVariant = Color(0xFFC9C5BC),
    outline = Color(0xFF6B6960),
    error = Color(0xFFFFB4AB)
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFF8A5A00),
    background = Color(0xFFFCF8F2),
    surface = Color(0xFFFFFBF5)
)

@Composable
fun SixWorldsTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, content = content)
}
