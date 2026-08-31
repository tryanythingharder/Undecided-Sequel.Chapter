package com.sixworlds.mobile.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.android.awaitFrame
import kotlinx.coroutines.launch
import kotlin.math.min
import kotlin.random.Random

/**
 * 启动页 —— 桌面端 R76 入场动画（Mineradio 式启动页）的移动端移植：
 * 暗场舞台（#010304 + 暗角 + 网格线 + 呼吸环境光）、70 颗尘埃粒子（72% 琥珀 / 青 / 珊瑚，缓慢上浮）、
 * 双字标序列（「六面世界」斜切揭示 + 「自己的故事」宽度展开 + 流光扫字、「故事」金字）、
 * 信号线（scaleX 关键帧 + 中心 blip）、副标、2.6s 后点击进入 + 跳过按钮 + 12s 兜底。
 */
@Composable
fun SplashScreen(onDone: () -> Unit) {
    var exiting by remember { mutableStateOf(false) }
    val exitAlpha = remember { Animatable(1f) }
    val ready = remember { mutableStateOf(false) }

    fun finish() {
        if (!exiting) {
            exiting = true
        }
    }
    LaunchedEffect(exiting) {
        if (exiting) {
            exitAlpha.animateTo(0f, tween(620, easing = androidx.compose.animation.core.CubicBezierEasing(0.16f, 1f, 0.3f, 1f)))
            onDone()
        }
    }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(2600)
        ready.value = true
        kotlinx.coroutines.delay(9400) // 12s 兜底
        finish()
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF010304))
            .graphicsLayer { alpha = exitAlpha.value; scaleX = 1f + (1f - exitAlpha.value) * 0.01f }
            .clickable(enabled = ready.value && !exiting) { finish() },
    ) {
        // 呼吸环境光 + 暗角 + 网格线
        SplashStage()

        // 尘埃粒子
        SplashDust(alpha = if (exiting) 0.22f else 1f)

        // 中央内容
        Column(
            Modifier.align(Alignment.Center).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            SplashLockup()
            SignalLine()
            Text(
                "SIX WORLDS · PRIVATE STORY ENGINE",
                color = Color.White.copy(alpha = 0.34f),
                fontSize = 9.sp,
                letterSpacing = 2.4.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }

        // 点击进入（ready 后脉冲）
        if (ready.value && !exiting) {
            val pulse by rememberInfiniteTransition(label = "enter").animateFloat(
                initialValue = 0.46f, targetValue = 0.85f,
                animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing), androidx.compose.animation.core.RepeatMode.Reverse),
                label = "enterPulse",
            )
            Text(
                "点 击 进 入",
                Modifier.align(Alignment.BottomCenter).padding(bottom = 64.dp).alpha(pulse),
                color = Color.White.copy(alpha = 0.62f),
                fontSize = 11.sp,
                letterSpacing = 3.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        // 跳过（始终可用，对齐原型 S1）
        Text(
            "跳过",
            Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 24.dp, bottom = 40.dp)
                .clip(RoundedCornerShape(999.dp))
                .border(1.dp, Color(0xFF6B6860).copy(alpha = 0.3f), RoundedCornerShape(999.dp))
                .clickable { finish() }
                .padding(horizontal = 12.dp, vertical = 6.dp),
            color = Color(0xFF6B6860),
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
        )

        Text(
            "v1.0.0 · 六面世界",
            Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp),
            color = Color(0xFF6B6860).copy(alpha = 0.5f),
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace,
        )
    }
}

/** 舞台：呼吸环境光（琥珀/青斜向光斑）+ 网格线 + 四边暗角 */
@Composable
private fun SplashStage() {
    val breathe = rememberInfiniteTransition(label = "stage").animateFloat(
        initialValue = 0.72f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(3500), androidx.compose.animation.core.RepeatMode.Reverse),
        label = "stageBreathe",
    )
    Canvas(Modifier.fillMaxSize()) {
        // 底色渐变
        drawRect(Brush.verticalGradient(listOf(Color(0xFF020606), Color(0xFF050607), Color.Black)))
        // 斜向光斑（低透明度）
        drawRect(
            Brush.linearGradient(
                listOf(Color.Transparent, Color(0x0D535367), Color.Transparent, Color(0x0FD99A52), Color.Transparent),
                start = Offset(0f, size.height * 0.2f),
                end = Offset(size.width, size.height * 0.8f),
            ),
            alpha = breathe.value * 0.9f,
        )
        // 网格线（纵向 54dp / 横向 46dp 近似）
        val stepX = 54.dp.toPx()
        var x = 0f
        while (x < size.width) {
            drawLine(Color.White.copy(alpha = 0.03f), Offset(x, 0f), Offset(x, size.height), 1f)
            x += stepX
        }
        val stepY = 46.dp.toPx()
        var y = 0f
        while (y < size.height) {
            drawLine(Color.White.copy(alpha = 0.02f), Offset(0f, y), Offset(size.width, y), 1f)
            y += stepY
        }
        // 四边暗角（inset 0）：上下左右渐变遮罩
        drawRect(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.68f), Color.Transparent, Color.Transparent, Color.Black.copy(alpha = 0.74f))))
        drawRect(Brush.horizontalGradient(listOf(Color.Black.copy(alpha = 0.82f), Color.Transparent, Color.Transparent, Color.Black.copy(alpha = 0.82f))))
    }
}

/** 尘埃粒子：70 颗缓慢上浮，72% 琥珀 / 青 / 珊瑚 */
@Composable
private fun SplashDust(alpha: Float) {
    val seeds = remember {
        List(70) {
            object {
                val x = Random.nextFloat()
                val y = Random.nextFloat()
                val r = 0.6f + Random.nextFloat() * 1.6f
                val vx = (Random.nextFloat() - 0.5f) * 0.00016f
                val vy = -0.00006f - Random.nextFloat() * 0.00022f
                val a = 0.08f + Random.nextFloat() * 0.3f
                val tint = if (Random.nextFloat() < 0.72f) floatArrayOf(217f, 154f, 82f)
                else if (Random.nextFloat() < 0.5f) floatArrayOf(122f, 215f, 194f)
                else floatArrayOf(255f, 83f, 103f)
            }
        }
    }
    val frame = remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        while (true) {
            awaitFrame()
            frame.longValue++
        }
    }
    Canvas(Modifier.fillMaxSize().alpha(alpha)) {
        val t = frame.longValue
        seeds.forEach { d ->
            val px = ((d.x + d.vx * t) % 1.04f + 1.04f) % 1.04f
            val py = ((d.y + d.vy * t) % 1.04f + 1.04f) % 1.04f
            drawCircle(
                Color(d.tint[0] / 255f, d.tint[1] / 255f, d.tint[2] / 255f, d.a),
                radius = d.r * min(size.width, size.height) / 390f,
                center = Offset(px * size.width, py * size.height),
            )
        }
    }
}

/** 双字标序列：六面世界（斜切揭示）+ 自己的故事（宽度展开 + 流光扫字，「故事」金字） */
@Composable
private fun SplashLockup() {
    val zh = remember { Animatable(0f) }
    val expand = remember { Animatable(0f) }
    val sweep = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        // 对齐桌面时序：主标 0-26% 揭示；次标 32% 起展开；1.66s 起流光扫字
        launch {
            kotlinx.coroutines.delay(150)
            zh.animateTo(1f, tween(1400, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
        }
        launch {
            kotlinx.coroutines.delay(620)
            expand.animateTo(1f, tween(1500, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
        }
        launch {
            kotlinx.coroutines.delay(1660)
            sweep.animateTo(1f, tween(2400, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
        }
    }

    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // 主标：六面世界（白色 + 双侧色散描影）
        Box {
            Text(
                "六面世界",
                Modifier.graphicsLayer { alpha = 0.24f; translationX = -2f },
                color = Color(0xFFFF5367), fontSize = 46.sp, fontWeight = FontWeight.ExtraBold,
            )
            Text(
                "六面世界",
                Modifier.graphicsLayer {
                    alpha = 0.18f; translationX = 2f
                    val f = zh.value
                    scaleX = 1f + (1f - f) * 0.08f
                },
                color = Color(0xFF7AD7C2), fontSize = 46.sp, fontWeight = FontWeight.ExtraBold,
            )
            Text(
                "六面世界",
                Modifier.graphicsLayer {
                    alpha = zh.value
                    scaleX = 1f + (1f - zh.value) * 0.08f
                },
                color = Color(0xFFF8F8F2), fontSize = 46.sp, fontWeight = FontWeight.ExtraBold,
            )
        }
        // 次标：自己的故事（宽度展开 + 流光扫字；「故事」实色金字）
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("自己的", Modifier.alpha(expand.value), color = Color.White.copy(alpha = 0.9f), fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text(
                "故事",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                style = TextStyle(
                    brush = Brush.linearGradient(
                        listOf(
                            Color.White.copy(alpha = 0.06f), Color.White,
                            Color(0xFFD99A52), Color(0xFF7AD7C2), Color.White.copy(alpha = 0.82f),
                        ),
                        start = Offset(sweep.value * 600f - 200f, 0f),
                        end = Offset(sweep.value * 600f + 60f, 0f),
                    ),
                ),
            )
        }
    }
}

/** 信号线：scaleX 关键帧（0.10→1.05→0.82→1.14→0.64）+ 中心 blip 左右扫过 */
@Composable
private fun SignalLine() {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(400)
        t.animateTo(1f, tween(4200, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
    }
    val p = t.value
    val lineScale = androidx.compose.ui.util.lerp(
        androidx.compose.ui.util.lerp(0.10f, 1.05f, keyframeAt(p, 0.28f, 0.44f)),
        androidx.compose.ui.util.lerp(0.82f, 0.64f, keyframeAt(p, 0.76f, 1f)),
        keyframeAt(p, 0.44f, 0.76f),
    )
    val lineAlpha = 0.3f + 0.7f * (1f - kotlin.math.abs(p - 0.6f) * 1.6f).coerceIn(0f, 1f)
    val blipX = androidx.compose.ui.util.lerp(0.18f, 0.82f, p)
    val blipAlpha = (1f - kotlin.math.abs(p - 0.62f) * 3f).coerceIn(0f, 0.94f)
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .width(300.dp)
                .height(2.dp)
                .graphicsLayer { scaleX = lineScale }
                .alpha(lineAlpha)
                .background(
                    Brush.horizontalGradient(
                        listOf(
                            Color.Transparent, Color(0x387AD7C2), Color(0xC7FFFFFF),
                            Color(0xA8D99A52), Color(0x38FF5367), Color.Transparent,
                        ),
                    ),
                ),
        )
        Spacer(Modifier.height(0.dp))
        Box(
            Modifier
                .offsetXFraction(blipX)
                .size(8.dp)
                .alpha(blipAlpha)
                .background(Color.White.copy(alpha = 0.82f), CircleShape),
        )
    }
}

private fun keyframeAt(p: Float, from: Float, to: Float): Float =
    ((p - from) / (to - from)).coerceIn(0f, 1f)

private fun Modifier.offsetXFraction(f: Float): Modifier = this.then(
    Modifier.graphicsLayer { translationX = f * 300.dp.toPx() - 150.dp.toPx() - 4.dp.toPx() },
)
