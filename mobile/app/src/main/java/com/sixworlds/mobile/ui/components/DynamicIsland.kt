package com.sixworlds.mobile.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.core.tween
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class IslandPhase(val label: String) {
    TEXT("叙事生成中"), IMAGE("插图生成中"), UNLOG("补录处理中")
}

/** 灵动岛 —— 新版：纯黑胶囊 182×33（收起）/ 312 卡片（展开），三段阶段条 */
@Composable
fun DynamicIsland(
    visible: Boolean,
    phase: IslandPhase,
    modelName: String,
    streamText: String,
    charCount: Int,
    onStop: () -> Unit,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val width by animateDpAsState(
        targetValue = if (expanded) 312.dp else 182.dp,
        animationSpec = spring(dampingRatio = 0.68f, stiffness = 380f),
        label = "diWidth",
    )
    AnimatedVisibility(
        visible = visible,
        enter = scaleIn(spring(dampingRatio = 0.6f, stiffness = 400f), 0.85f) + fadeIn(tween(160)),
        exit = scaleOut(tween(180), 0.9f) + fadeOut(tween(180)),
        modifier = modifier,
    ) {
        val phaseColor = when (phase) {
            IslandPhase.IMAGE -> Color(0xFF32ADE6)
            IslandPhase.UNLOG -> Color(0xFFFF453A)
            else -> Color(0xFFC8952A)
        }
        Column(
            Modifier
                .width(width)
                .clip(RoundedCornerShape(if (expanded) 22.dp else 100.dp))
                .background(Color.Black)
                .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(if (expanded) 22.dp else 100.dp))
                .clickable { onToggle() }
                .padding(if (expanded) 16.dp else 0.dp)
                .animateContentSize(spring(dampingRatio = 0.72f, stiffness = 380f)),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (!expanded) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(33.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        modelName.substringAfterLast('/').take(16).ifEmpty { "模型" },
                        color = Color(0xFFC8952A), fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace, letterSpacing = 0.5.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    BreathingDots(3, Color(0xFFC8952A), 5.dp)
                }
            } else {
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.size(7.dp).background(phaseColor, CircleShape))
                        Text(phase.label, color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    }
                    Text("$charCount 字", color = Color(0xFFC8952A), fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                }
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                        .background(Color.White.copy(alpha = 0.05f))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                ) {
                    Text(
                        (streamText.ifEmpty { "正在构思叙事……" }) + " ▌",
                        color = Color.White.copy(alpha = 0.82f),
                        fontSize = 13.sp, lineHeight = 23.sp,
                        fontFamily = FontFamily.Serif, fontStyle = FontStyle.Italic,
                        maxLines = 3, overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    IslandPhase.entries.forEach { s ->
                        val on = s == phase
                        Box(
                            Modifier
                                .weight(1f)
                                .height(4.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(
                                    when {
                                        on && s == IslandPhase.TEXT -> Color(0xFFC8952A)
                                        on && s == IslandPhase.IMAGE -> Color(0xFF32ADE6)
                                        on && s == IslandPhase.UNLOG -> Color(0xFFFF453A)
                                        else -> Color.White.copy(alpha = 0.1f)
                                    }
                                ),
                        )
                    }
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0x1FFF453A))
                        .border(1.dp, Color(0x40FF453A), RoundedCornerShape(12.dp))
                        .clickable { onStop(); onToggle() }
                        .padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("停止生成", color = Color(0xFFFF453A), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
fun BreathingDots(count: Int, color: Color, dotSize: androidx.compose.ui.unit.Dp, periodMs: Int = 1600) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(count) { i ->
            val transition = rememberInfiniteTransition(label = "dot$i")
            val alpha by transition.animateFloat(
                initialValue = 0.3f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = keyframes {
                        durationMillis = periodMs
                        0.3f at 0
                        1f at periodMs / 2
                        0.3f at periodMs
                    },
                    repeatMode = RepeatMode.Restart,
                    initialStartOffset = StartOffset(i * 220),
                ),
                label = "dotAlpha$i",
            )
            Box(Modifier.size(dotSize).alpha(alpha).background(color, CircleShape))
        }
    }
}
