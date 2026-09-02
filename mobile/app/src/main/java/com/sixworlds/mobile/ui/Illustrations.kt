package com.sixworlds.mobile.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.unit.dp
import com.sixworlds.mobile.R

private const val GOLD = 0xFFC8952A

private fun star8(): Path = Path().apply {
    moveTo(158f, 34f); lineTo(160.5f, 46f); lineTo(173f, 46f); lineTo(163f, 55f); lineTo(166.5f, 67f)
    lineTo(158f, 59f); lineTo(149.5f, 67f); lineTo(153f, 55f); lineTo(143f, 46f); lineTo(155.5f, 46f)
    close()
}

private fun starSmall(): Path = Path().apply {
    moveTo(37f, 60f); lineTo(38.5f, 66f); lineTo(45f, 66f); lineTo(39.5f, 70f); lineTo(41.5f, 76f)
    lineTo(37f, 72.5f); lineTo(32.5f, 76f); lineTo(34.5f, 70f); lineTo(29f, 66f); lineTo(35.5f, 66f)
    close()
}

/** 开始你的故事 —— 黑猫圆形照片 + 金环 + 星辰（设计 B 组 IllStoryBegin） */
@Composable
fun IllStoryBegin(modifier: Modifier = Modifier) {
    val cat = ImageBitmap.imageResource(R.drawable.ic_cat)
    Canvas(modifier) {
        val k = size.minDimension / 200f
        withTransform({ scale(k, k, pivot = Offset.Zero) }) {
            // 猫照片圆形裁切
            val circle = Path().apply { addOval(androidx.compose.ui.geometry.Rect(38f, 60f, 162f, 184f)) }
            clipPath(circle) {
                drawImage(cat, dstOffset = androidx.compose.ui.unit.IntOffset(38, 60), dstSize = androidx.compose.ui.unit.IntSize(124, 124))
            }
            // 金环
            drawCircle(Color(GOLD).copy(alpha = 0.4f), radius = 63f, center = Offset(100f, 122f), style = Stroke(1f))
            // 主星 + 次星
            drawPath(star8(), Color(GOLD))
            drawPath(starSmall(), Color(GOLD).copy(alpha = 0.55f))
            // 环境光点
            listOf(
                Offset(63f, 34f) to 2f, Offset(167f, 82f) to 1.5f,
                Offset(152f, 24f) to 1.2f, Offset(28f, 110f) to 1f,
            ).forEach { (o, r) -> drawCircle(Color(GOLD).copy(alpha = 0.28f), r, o) }
        }
    }
}

/** 画廊空态 —— 画框 + 挂线 + 星辰（设计 B 组 IllGalleryEmpty） */
@Composable
fun IllGalleryEmpty(modifier: Modifier = Modifier, lineColor: Color = Color(0xFF1A1A1A)) {
    Canvas(modifier) {
        val k = size.minDimension / 200f
        withTransform({ scale(k, k, pivot = Offset.Zero) }) {
            // 画框
            drawRoundRect(
                lineColor,
                topLeft = Offset(38f, 52f), size = Size(124f, 98f),
                cornerRadius = CornerRadius(5f, 5f),
                style = Stroke(2.5f, cap = StrokeCap.Round),
            )
            // 内衬（虚线）
            drawRoundRect(
                lineColor.copy(alpha = 0.3f),
                topLeft = Offset(50f, 64f), size = Size(100f, 74f),
                cornerRadius = CornerRadius(3f, 3f),
                style = Stroke(1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 3f))),
            )
            // 挂线 + 挂点
            drawPath(Path().apply { moveTo(72f, 52f); quadraticTo(100f, 38f, 128f, 52f) }, lineColor, style = Stroke(2f, cap = StrokeCap.Round))
            drawCircle(lineColor, 3.5f, Offset(100f, 37f))
            // 星辰
            drawPath(star8(), Color(GOLD).copy(alpha = 0.85f))
            drawPath(starSmall(), Color(GOLD).copy(alpha = 0.45f))
            // 尘点
            listOf(
                Offset(148f, 46f) to 2f, Offset(38f, 138f) to 1.5f,
                Offset(172f, 145f) to 1.2f, Offset(57f, 42f) to 1f,
            ).forEach { (o, r) -> drawCircle(Color(GOLD).copy(alpha = 0.3f), r, o) }
            // 说明占位线
            drawLine(lineColor.copy(alpha = 0.12f), Offset(68f, 168f), Offset(132f, 168f), 1.5f, StrokeCap.Round)
            drawLine(lineColor.copy(alpha = 0.07f), Offset(82f, 178f), Offset(118f, 178f), 1.5f, StrokeCap.Round)
        }
    }
}

/** 补录队列空态 —— 涟漪圆环 + 金色大对勾（设计 B 组 IllQueueEmpty） */
@Composable
fun IllQueueEmpty(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val k = size.minDimension / 200f
        withTransform({ scale(k, k, pivot = Offset.Zero) }) {
            listOf(Triple(82f, 1f, 0.07f), Triple(62f, 1.2f, 0.12f), Triple(44f, 1.5f, 0.18f)).forEach { (r, w, a) ->
                drawCircle(Color(GOLD).copy(alpha = a), r, Offset(100f, 106f), style = Stroke(w))
            }
            drawPath(
                Path().apply { moveTo(55f, 109f); lineTo(80f, 134f); lineTo(145f, 70f) },
                Color(GOLD), style = Stroke(9f, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
    }
}
