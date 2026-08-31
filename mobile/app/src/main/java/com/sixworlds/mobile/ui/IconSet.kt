package com.sixworlds.mobile.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 设计 AI 定稿图标集（SF Symbols 风格 · 24×24 网格 · 2px 圆头笔触 · 运行时着色）。
 * 逐元素转录自设计源文件 App.tsx（aGroup 25 枚），命令在缩放后的逻辑坐标系执行，
 * 线宽 2f 会随画布缩放，与设计稿视觉一致。
 */
private typealias ICmd = DrawScope.(Color) -> Unit

private fun strokeStyle() = Stroke(width = 2f, cap = StrokeCap.Round, join = StrokeJoin.Round)

private fun ln(x1: Float, y1: Float, x2: Float, y2: Float): ICmd = { c ->
    drawLine(c, Offset(x1, y1), Offset(x2, y2), 2f, StrokeCap.Round)
}

private fun poly(pts: String, closed: Boolean = false): ICmd = { c ->
    val path = Path()
    var first = true
    pts.trim().split("\\s+".toRegex()).forEach { pair ->
        val (x, y) = pair.split(",").map { it.trim().toFloat() }
        if (first) { path.moveTo(x, y); first = false } else path.lineTo(x, y)
    }
    if (closed) path.close()
    drawPath(path, c, style = strokeStyle())
}

private fun dPath(d: String): ICmd = { c ->
    drawPath(PathParser().parsePathString(d).toPath(), c, style = strokeStyle())
}

private fun dPathFilled(d: String): ICmd = { c ->
    drawPath(PathParser().parsePathString(d).toPath(), c)
}

private fun circ(cx: Float, cy: Float, r: Float, filled: Boolean = false): ICmd = { c ->
    if (filled) drawCircle(c, r, Offset(cx, cy))
    else drawCircle(c, r, Offset(cx, cy), style = strokeStyle())
}

private fun rrect(x: Float, y: Float, w: Float, h: Float, rx: Float, filled: Boolean = false): ICmd = { c ->
    if (filled) drawRoundRect(c, Offset(x, y), Size(w, h), CornerRadius(rx, rx))
    else drawRoundRect(c, Offset(x, y), Size(w, h), CornerRadius(rx, rx), style = strokeStyle())
}

private val ICONS: Map<String, List<ICmd>> = mapOf(
    "icon_menu" to listOf(ln(4f, 7f, 20f, 7f), ln(5f, 12f, 19f, 12f), ln(4f, 17f, 20f, 17f)),
    "icon_snapshot" to listOf(
        circ(12f, 12f, 8.5f), ln(12f, 12f, 12f, 5.5f), ln(12f, 12f, 16f, 14.5f),
        { c -> drawCircle(c, 1f, Offset(12f, 12f)) },
    ),
    "icon_state" to listOf(
        rrect(3f, 3f, 8f, 8f, 1.5f), rrect(13f, 3f, 8f, 8f, 1.5f),
        rrect(3f, 13f, 8f, 8f, 1.5f), rrect(13f, 13f, 8f, 8f, 1.5f),
    ),
    "icon_send" to listOf(ln(4f, 12f, 20f, 12f), poly("15,7.5 20,12 15,16.5")),
    "icon_stop" to listOf(rrect(7f, 7f, 10f, 10f, 2f, filled = true)),
    "icon_back" to listOf(poly("15,5 9,12 15,19")),
    "icon_next" to listOf(poly("9,5 15,12 9,19")),
    "icon_chevron" to listOf(poly("10,7 15,12 10,17")),
    "icon_plus" to listOf(ln(12f, 4f, 12f, 20f), ln(4f, 12f, 20f, 12f)),
    "icon_check" to listOf(poly("4,13 9,18 20,7")),
    "icon_close" to listOf(ln(6f, 6f, 18f, 18f), ln(18f, 6f, 6f, 18f)),
    "icon_more" to listOf(
        { c -> drawCircle(c, 1.5f, Offset(12f, 5.5f)) },
        { c -> drawCircle(c, 1.5f, Offset(12f, 12f)) },
        { c -> drawCircle(c, 1.5f, Offset(12f, 18.5f)) },
    ),
    "icon_search" to listOf(circ(10f, 10f, 5.5f), ln(14.5f, 14.5f, 19.5f, 19.5f)),
    "icon_warn" to listOf(
        poly("12,3.5 21.5,19.5 2.5,19.5", closed = true),
        ln(12f, 9f, 12f, 14.5f),
        { c -> drawCircle(c, 0.9f, Offset(12f, 17f)) },
    ),
    "icon_copy" to listOf(
        dPath("M9,8 L9,4.5 Q9,3 10.5,3 H18.5 Q20,3 20,4.5 V14.5 Q20,16 18.5,16 H16.5"),
        rrect(4f, 8f, 12f, 13f, 1.5f),
    ),
    "icon_edit" to listOf(
        dPath("M4,20.5 L5,16 L17.5,3.5 Q19,2 20.5,3.5 Q22,5 20.5,6.5 L8,19 Z"),
        ln(15.5f, 5f, 19f, 8.5f),
    ),
    "icon_refresh" to listOf(dPath("M20,12 A8,8 0 1,1 12,4"), poly("8,4 12,4 12,8")),
    "icon_history" to listOf(
        circ(12f, 12f, 7.5f),
        poly("12,7.5 12,12 9,14.5"),
        dPath("M8.5,3.5 A10,10 0 0,0 3,9"),
        poly("3,5 3,9 7,9"),
    ),
    "icon_trash" to listOf(
        dPath("M9,8 V5 Q9,4 10,4 H14 Q15,4 15,5 V8"),
        ln(3f, 8f, 21f, 8f),
        dPath("M5,8 L5.8,20 Q5.8,21 7,21 H17 Q18.2,21 18.2,20 L19,8"),
        ln(9f, 11f, 9f, 18f), ln(12f, 11f, 12f, 18f), ln(15f, 11f, 15f, 18f),
    ),
    "icon_image" to listOf(
        rrect(3f, 4f, 18f, 16f, 2f),
        circ(8.5f, 8.5f, 1.5f),
        poly("3.5,17.5 8.5,12 12,15 15.5,11.5 20.5,17.5"),
    ),
    "icon_world" to listOf(circ(12f, 12f, 7f), { c ->
        drawOval(c, topLeft = Offset(1f, 8f), size = Size(22f, 8f), style = strokeStyle())
    }),
    "icon_book" to listOf(
        dPath("M2,5 Q2,3 4,3 H10 Q12,3 12,5 V21 L3.5,20 Q2,19.5 2,18 V5 Z"),
        dPath("M22,5 Q22,3 20,3 H14 Q12,3 12,5 V21 L20.5,20 Q22,19.5 22,18 V5 Z"),
    ),
    "icon_sliders" to listOf(
        ln(3f, 6f, 5f, 6f), circ(7f, 6f, 2f), ln(9f, 6f, 21f, 6f),
        ln(3f, 12f, 13f, 12f), circ(15f, 12f, 2f), ln(17f, 12f, 21f, 12f),
        ln(3f, 18f, 8f, 18f), circ(10f, 18f, 2f), ln(12f, 18f, 21f, 18f),
    ),
    "icon_palette" to listOf(
        dPath("M12,3 C7,3 3,7.5 3,12.5 C3,16.5 5.5,19 9,20.5 C10,21 11,20.5 11.5,19.5 C12,18.5 11.5,17 9.5,16.5 C8,16 7.5,13.5 9.5,12.5 C11,12 12.5,13 14,14.5 C15.5,16 17,15 17.5,13.5 C18.5,11 18,8 16.5,5.5 C15,4 13.5,3 12,3"),
        circ(7.5f, 9f, 1.5f),
    ),
    "icon_queue" to listOf(
        poly("3,6.5 5.5,9 8.5,5"), ln(11f, 7f, 21f, 7f),
        circ(5f, 12.5f, 1.5f), ln(9f, 12.5f, 21f, 12.5f),
        circ(5f, 18f, 1.5f), ln(9f, 18f, 21f, 18f),
    ),
)

/** 设计图标入口：按定稿 ID 渲染，颜色运行时传入 */
@Composable
fun DiIcon(name: String, size: Dp = 20.dp, color: Color, modifier: Modifier = Modifier) {
    val cmds = ICONS[name] ?: return
    Canvas(modifier.size(size)) {
        val k = this.size.minDimension / 24f
        withTransform({ scale(k, k, pivot = Offset.Zero) }) {
            cmds.forEach { it(color) }
        }
    }
}
