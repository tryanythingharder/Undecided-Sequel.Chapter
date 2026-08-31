package com.sixworlds.mobile.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sixworlds.mobile.ui.theme.LocalSwColors
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState

@Composable
fun MonoText(text: String, color: Color, size: Int = 9, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier, color = color, fontSize = size.sp, fontFamily = FontFamily.Monospace)
}

@Composable
fun SpacerH(dp: Int) { Spacer(Modifier.height(dp.dp)) }

@Composable
fun Separator() {
    val c = LocalSwColors.current
    Box(Modifier.fillMaxWidth().height(0.5.dp).background(c.sep))
}

/** iOS 毛玻璃导航栏：菜单钮 + 标题/副标 + 右槽 */
@Composable
fun NavBar(title: String, sub: String? = null, onMenu: () -> Unit, right: (@Composable () -> Unit)? = null) {
    val c = LocalSwColors.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.navbarBlur)
            .statusBarsPadding()
            .padding(horizontal = 16.dp)
            .padding(top = 8.dp, bottom = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(c.fillTer)
                    .clickable(onClick = onMenu),
                contentAlignment = Alignment.Center,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Box(Modifier.width(17.dp).height(1.6.dp).clip(RoundedCornerShape(2.dp)).background(c.label2))
                    Box(Modifier.width(11.dp).height(1.6.dp).clip(RoundedCornerShape(2.dp)).background(c.label2))
                    Box(Modifier.width(17.dp).height(1.6.dp).clip(RoundedCornerShape(2.dp)).background(c.label2))
                }
            }
            Column(Modifier.weight(1f)) {
                Text(title, color = c.label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (sub != null) MonoText(sub, c.label3, 11)
            }
            right?.invoke()
        }
    }
    Separator()
}

@Composable
fun IconBtn(onClick: () -> Unit, content: @Composable () -> Unit) {
    val c = LocalSwColors.current
    Box(
        Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(c.fillTer)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
fun ToolBtn(label: String, badge: Int = 0, onClick: () -> Unit) {
    val c = LocalSwColors.current
    Box(
        Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(c.fillTer)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(label, color = c.label2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        if (badge > 0) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .size(16.dp)
                    .background(c.coral, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text("$badge", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
fun ToggleSwitch(checked: Boolean, onChange: (Boolean) -> Unit) {
    val c = LocalSwColors.current
    // Compose 无内建 animateAlignmentAsState：用 bias 动画驱动拇指位置
    val thumbBias by animateFloatAsState(if (checked) 1f else -1f, label = "toggleThumb")
    val track by animateColorAsState(if (checked) c.gold else c.fill, label = "toggleTrack")
    Box(
        Modifier
            .width(51.dp)
            .height(31.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(track)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .padding(2.dp),
        contentAlignment = BiasAlignment(thumbBias, 0f),
    ) {
        Box(Modifier.size(27.dp).background(Color.White, CircleShape))
    }
}

/** 底部 Sheet 宿主：把手 + Lora 标题 + 关闭钮 + 可滚动内容 */
@Composable
fun SheetHost(
    title: String,
    onClose: () -> Unit,
    heightFraction: Float = 0.78f,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = LocalSwColors.current
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f)).clickable(onClick = onClose))
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxSize(heightFraction)
                // 消费落在 Sheet 上的点击，避免穿透到遮罩误关（点内容区空白不应关闭）
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {}
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                .background(c.sheetBg)
                .border(0.5.dp, c.sep, RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)),
        ) {
            Box(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.width(36.dp).height(4.dp).clip(RoundedCornerShape(999.dp)).background(c.label4))
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, color = c.label, fontSize = 18.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Serif)
                Box(
                    Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(c.fillTer)
                        .clickable(onClick = onClose),
                    contentAlignment = Alignment.Center,
                ) { IconClose(11.dp, c.label2) }
            }
            Separator()
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .imePadding()
                    .navigationBarsPadding()
                    .verticalScroll(rememberScrollState()),
            ) { content() }
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    val c = LocalSwColors.current
    Text(
        text, modifier = modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
        color = c.label3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp,
    )
}

@Composable
fun IosField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    mask: Boolean = false,
    singleLine: Boolean = true,
    minLines: Int = 1,
) {
    val c = LocalSwColors.current
    TextField(
        value = value, onValueChange = onValueChange,
        placeholder = { Text(placeholder, color = c.label3, fontSize = 14.sp) },
        textStyle = androidx.compose.ui.text.TextStyle(color = c.label, fontSize = 14.sp, lineHeight = 21.sp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = c.fillTer, unfocusedContainerColor = c.fillTer,
            focusedTextColor = c.label, unfocusedTextColor = c.label,
            cursorColor = c.gold, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
        ),
        singleLine = singleLine,
        minLines = minLines,
        visualTransformation = if (mask) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        shape = RoundedCornerShape(16.dp),
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
fun GoldPillChip(text: String, selected: Boolean, onClick: () -> Unit) {
    val c = LocalSwColors.current
    Box(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (selected) c.gold else c.fillTer)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(text, color = if (selected) Color(0xFF0A0600) else c.label2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun ChipButton(text: String, selected: Boolean, onClick: () -> Unit) = GoldPillChip(text, selected, onClick)

@Composable
fun HomeIndicator() {
    val c = LocalSwColors.current
    Box(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 10.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .width(112.dp)
                .height(4.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(c.label.copy(alpha = 0.2f)),
        )
    }
}

/** 世界集头像占位（accent 渐变 + 首字） */
@Composable
fun WorldAvatar(name: String, accent: Color, sizeDp: Int = 40) {
    Box(
        Modifier
            .size(sizeDp.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Brush.linearGradient(listOf(accent.copy(alpha = 0.8f), accent.copy(alpha = 0.4f)))),
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.foundation.Image(
            painter = androidx.compose.ui.res.painterResource(com.sixworlds.mobile.R.drawable.ic_cat),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

// 组合期高频调用（列表行），缓存 DateFormat 避免每次新建
private val FMT_HM = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
private val FMT_MD = java.text.SimpleDateFormat("M月d日", java.util.Locale.getDefault())

internal fun fmtTime(at: Long): String {
    if (at <= 0) return ""
    val cal = java.util.Calendar.getInstance().apply { timeInMillis = at }
    val now = java.util.Calendar.getInstance()
    val dayOf = { cc: java.util.Calendar -> cc.get(java.util.Calendar.DAY_OF_YEAR) + cc.get(java.util.Calendar.YEAR) * 1000 }
    val hm = FMT_HM.format(java.util.Date(at))
    return when {
        dayOf(cal) == dayOf(now) -> "今天 $hm"
        dayOf(cal) == dayOf(now) - 1 -> "昨天 $hm"
        else -> FMT_MD.format(java.util.Date(at))
    }
}



internal fun kernelDisplayName(file: String): String = when (file) {
    "kernel.md" -> "默认内核"
    "kernel-xianxia.md" -> "修仙内核"
    else -> file.removeSuffix(".md").take(8)
}
