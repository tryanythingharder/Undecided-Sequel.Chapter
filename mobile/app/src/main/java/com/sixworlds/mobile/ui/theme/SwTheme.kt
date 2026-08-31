package com.sixworlds.mobile.ui.theme

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * 设计令牌 —— 对齐新原型 App.tsx 的 iOS 系统色板（暗/亮双套）。
 * 旧字段名（primary/bubble/border…）作为别名保留，兼容次级页面。
 */
data class SwColors(
    val isDark: Boolean,
    val bg: Color,
    val bgSecondary: Color,
    val bgTertiary: Color,
    val fill: Color,
    val fillSec: Color,
    val fillTer: Color,
    val sep: Color,
    val sepOpaque: Color,
    val label: Color,
    val label2: Color,
    val label3: Color,
    val label4: Color,
    val gold: Color,
    val goldBright: Color,
    val goldFill: Color,
    val goldFillSub: Color,
    val goldBorder: Color,
    /** 金底上的文字色（近黑） */
    val onGold: Color,
    /** 金色作文字色时使用（浅色主题下加深以保证对比度） */
    val goldText: Color,
    val cyan: Color,
    val cyanFill: Color,
    val coral: Color,
    val coralFill: Color,
    val green: Color,
    val orange: Color,
    val purple: Color,
    val navbarBlur: Color,
    val drawerBg: Color,
    val sheetBg: Color,
    // ---- 旧字段别名（次级页面兼容） ----
    val primary: Color, val border: Color, val text: Color, val textDim: Color,
    val muted: Color, val bubble: Color, val container: Color,
    val error: Color, val success: Color, val info: Color,
    val glassPanel: Color, val glassIsland: Color,
)

data class SwPalette(val id: String, val name: String)

val SW_PALETTES = listOf(SwPalette("amber", "琥珀暗夜"))

fun swColors(dark: Boolean): SwColors {
    return if (dark) SwColors(
        isDark = true,
        bg = Color(0xFF000000),
        bgSecondary = Color(0xFF1C1C1E),
        bgTertiary = Color(0xFF2C2C2E),
        fill = Color(0x5E787880),
        fillSec = Color(0x33787880),
        fillTer = Color(0x1F767680),
        sep = Color(0x5C3C3C43),
        sepOpaque = Color(0xFF38383A),
        label = Color.White,
        label2 = Color(0x99EBEBF5),
        label3 = Color(0x4DEBEBF5),
        label4 = Color(0x2EEBEBF5),
        gold = Color(0xFFC8952A),
        goldBright = Color(0xFFE8AE3A),
        goldFill = Color(0x2EC8952A),
        goldFillSub = Color(0x1AC8952A),
        goldBorder = Color(0x47C8952A),
        onGold = Color(0xFF0A0600),
        goldText = Color(0xFFC8952A),
        cyan = Color(0xFF32ADE6),
        cyanFill = Color(0x2432ADE6),
        coral = Color(0xFFFF453A),
        coralFill = Color(0x1FFF453A),
        green = Color(0xFF30D158),
        orange = Color(0xFFFF9F0A),
        purple = Color(0xFFBF5AF2),
        navbarBlur = Color(0xB8000000),
        drawerBg = Color(0xFF111113),
        sheetBg = Color(0xFF1C1C1E),
        primary = Color(0xFFC8952A), border = Color(0x5C3C3C43),
        text = Color.White, textDim = Color(0x99EBEBF5), muted = Color(0x99EBEBF5),
        bubble = Color(0xFF1C1C1E), container = Color(0x2EC8952A),
        error = Color(0xFFFF453A), success = Color(0xFF30D158), info = Color(0xFF32ADE6),
        glassPanel = Color(0xB8000000), glassIsland = Color(0xFF000000),
    ) else SwColors(
        isDark = false,
        bg = Color(0xFFF2F2F7),
        bgSecondary = Color.White,
        bgTertiary = Color(0xFFF2F2F7),
        fill = Color(0x33787880),
        fillSec = Color(0x1F787880),
        fillTer = Color(0x14767680),
        sep = Color(0x2E3C3C43),
        sepOpaque = Color(0xFFC6C6C8),
        label = Color.Black,
        label2 = Color(0x993C3C43),
        label3 = Color(0x4D3C3C43),
        label4 = Color(0x2E3C3C43),
        gold = Color(0xFFC8952A),
        goldBright = Color(0xFFE8AE3A),
        goldFill = Color(0x1FC8952A),
        goldFillSub = Color(0x12C8952A),
        goldBorder = Color(0x47C8952A),
        onGold = Color(0xFF0A0600),
        goldText = Color(0xFF8A5A00),
        cyan = Color(0xFF32ADE6),
        cyanFill = Color(0x2432ADE6),
        coral = Color(0xFFFF453A),
        coralFill = Color(0x1FFF453A),
        green = Color(0xFF30D158),
        orange = Color(0xFFFF9F0A),
        purple = Color(0xFF9E4ACC),
        navbarBlur = Color(0xD1F2F2F7),
        drawerBg = Color(0xFFF2F2F7),
        sheetBg = Color.White,
        primary = Color(0xFFC8952A), border = Color(0x2E3C3C43),
        text = Color.Black, textDim = Color(0x993C3C43), muted = Color(0x993C3C43),
        bubble = Color.White, container = Color(0x1FC8952A),
        error = Color(0xFFFF453A), success = Color(0xFF30D158), info = Color(0xFF32ADE6),
        glassPanel = Color(0xD1F2F2F7), glassIsland = Color(0xFF000000),
    )
}

val LocalSwColors = staticCompositionLocalOf { swColors(dark = true) }

/** 外观档位（沿用） */
object AppearanceScale {
    val fontSizes = listOf(0.9f, 1.0f, 1.12f, 1.24f)
    val radii = listOf(6f, 10f, 14f, 18f)
    val densities = listOf(1f, 1.85f, 2.6f, 3.4f)
    val bubbleWidths = listOf(0.78f, 0.9f, 1.0f)
}
