package com.sixworlds.mobile.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 图标包装层 —— 全部委托给设计定稿图标集（IconSet.kt，SF Symbols 风格 25 枚）。
 * 保留旧签名以兼容既有调用点；stroke 参数仅为兼容保留（定稿笔触统一 2px）。
 */

@Composable
fun IconClock(size: Dp = 18.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_snapshot", size, color)

@Composable
fun IconGrid(size: Dp = 18.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_state", size, color)

@Composable
fun IconDotsV(size: Dp = 16.dp, color: Color) = DiIcon("icon_more", size, color)

@Composable
fun IconClose(size: Dp = 14.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_close", size, color)

@Composable
fun IconChevron(size: Dp = 14.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_next", size, color)

@Composable
fun IconChevronLeft(size: Dp = 14.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_back", size, color)

@Composable
fun IconPlus(size: Dp = 16.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_plus", size, color)

@Composable
fun IconCheck(size: Dp = 12.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_check", size, color)

@Composable
fun IconArrow(size: Dp = 18.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_send", size, color)

@Composable
fun IconSearch(size: Dp = 20.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_search", size, color)

@Composable
fun IconWarn(size: Dp = 16.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_warn", size, color)

@Composable
fun IconMenu(size: Dp = 18.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_menu", size, color)

@Composable
fun IconImage(size: Dp = 24.dp, color: Color, stroke: Float = 2f) = DiIcon("icon_image", size, color)

/** 插图卡装饰四角星（矢量，仅此一处手绘保留） */
@Composable
fun IconSparkle(size: Dp = 22.dp, color: Color) {
    Canvas(Modifier.size(size)) {
        val k = this.size.minDimension / 24f
        withTransform({ scale(k, k, pivot = Offset.Zero) }) {
            val path = Path().apply {
                moveTo(12f, 2f)
                quadraticBezierTo(13.5f, 10.5f, 22f, 12f)
                quadraticBezierTo(10.5f, 13.5f, 12f, 22f)
                quadraticBezierTo(10.5f, 10.5f, 2f, 12f)
                close()
            }
            drawPath(path, color)
        }
    }
}
