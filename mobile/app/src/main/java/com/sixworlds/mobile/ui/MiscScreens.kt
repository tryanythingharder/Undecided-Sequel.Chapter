package com.sixworlds.mobile.ui

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sixworlds.mobile.chat.SearchHit
import com.sixworlds.mobile.chat.StoryChatController
import com.sixworlds.mobile.ui.theme.LocalSwColors

@Composable
private fun IosSearchField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    val c = LocalSwColors.current
    TextField(
        value = value, onValueChange = onValueChange, singleLine = true,
        placeholder = { Text(placeholder, color = c.label3, fontSize = 14.sp) },
        textStyle = androidx.compose.ui.text.TextStyle(color = c.label, fontSize = 14.sp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = c.fillSec, unfocusedContainerColor = c.fillSec,
            focusedTextColor = c.label, unfocusedTextColor = c.label,
            cursorColor = c.gold, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
        ),
        shape = RoundedCornerShape(16.dp), modifier = modifier,
    )
}

/** 会话内搜索（iOS 风格） */
@Composable
fun SearchScreen(controller: StoryChatController, onBack: () -> Unit) {
    val c = LocalSwColors.current
    var query by remember { mutableStateOf("") }
    var current by remember { mutableIntStateOf(0) }
    val hits = remember(query) { controller.search(query) }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.bg)
            .statusBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            IosSearchField(query, { query = it; current = 0 }, "在此会话内搜索…", Modifier.weight(1f))
            Text("取消", color = c.gold, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onBack))
        }
        if (hits.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MonoText("共 ${hits.size} 处匹配，当前第 ${current + 1} 处", c.muted, 10)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    IconBtn(onClick = { if (current > 0) current-- }) { IconChevronLeft(14.dp, c.label) }
                    IconBtn(onClick = { if (current < hits.size - 1) current++ }) { IconChevron(14.dp, c.label) }
                }
            }
        }
        LazyColumn(Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                query.isBlank() -> item {
                    Column(Modifier.fillMaxWidth().padding(top = 120.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        IconSearch(40.dp, c.border, 1.4f)
                        SpacerH(8)
                        Text("在当前会话内搜索消息", color = c.muted, fontSize = 14.sp)
                    }
                }
                hits.isEmpty() -> item {
                    Text("没有找到「$query」", color = c.muted, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(top = 40.dp))
                }
                else -> itemsIndexed(hits) { i, hit ->
                    val sel = i == current
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (sel) c.goldFillSub else c.bgSecondary)
                            .border(0.5.dp, if (sel) c.goldBorder else c.sep, RoundedCornerShape(14.dp))
                            .clickable {
                                current = i
                                controller.jumpTarget.value = hit.index
                                onBack()
                            }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        val isP = hit.role == "user"
                        Box(
                            Modifier.size(24.dp).clip(CircleShape).background(if (isP) c.goldFill else c.bgTertiary),
                            contentAlignment = Alignment.Center,
                        ) { Text(if (isP) "我" else "界", color = if (isP) c.gold else c.label3, fontSize = 9.sp) }
                        Column(Modifier.weight(1f)) {
                            // 预览窗口对齐命中位置，而不是永远显示消息开头
                            val from = (hit.matchStart - 24).coerceAtLeast(0)
                            val to = (hit.matchEnd + 40).coerceAtMost(hit.text.length)
                            val preview = (if (from > 0) "…" else "") + hit.text.substring(from, to) + (if (to < hit.text.length) "…" else "")
                            Text(
                                preview, color = c.label, fontSize = 14.sp,
                                fontFamily = FontFamily.Serif, maxLines = 2, overflow = TextOverflow.Ellipsis,
                            )
                            MonoText("${fmtTime(hit.at)} · 第 ${hit.index + 1} 条", c.label3, 9)
                        }
                        Text("›", color = c.label3, fontSize = 13.sp)
                    }
                }
            }
        }
        HomeIndicator()
    }
}

/** 编辑行动 · 回溯分叉（iOS 风格） */
@Composable
fun ForkScreen(controller: StoryChatController, msgIndex: Int, onBack: () -> Unit, onForked: () -> Unit) {
    val c = LocalSwColors.current
    val messages by controller.messages.collectAsState()
    // 若传入的是叙事消息，回溯目标为其前面的玩家行动
    val baseIndex = if (msgIndex > 0 && messages.getOrNull(msgIndex)?.role == "assistant") msgIndex - 1 else msgIndex
    val original = messages.getOrNull(baseIndex)
    var step by remember { mutableStateOf(0) }
    var text by remember(original?.content) { mutableStateOf(original?.content ?: "") }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.bg)
            .statusBarsPadding(),
    ) {
        NavBar(
            title = when (step) { 0 -> "编辑行动"; 1 -> "确认回溯"; else -> "分叉完成" },
            sub = "将从此处创建新的叙事分支",
            onMenu = { if (step == 0) onBack() else step = 0 },
        )
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (step == 2) {
                Column(Modifier.fillMaxWidth().padding(top = 100.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(64.dp).clip(CircleShape).background(c.success.copy(alpha = 0.12f)).border(2.dp, c.success.copy(alpha = 0.4f), CircleShape), contentAlignment = Alignment.Center) {
                        IconCheck(26.dp, c.success, 2.4f)
                    }
                    SpacerH(12)
                    Text("分叉已创建", color = c.label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    MonoText("正在重新生成叙事……", c.label3, 10)
                    SpacerH(16)
                    Box(Modifier.width(220.dp)) { GoldPillChip("返回阅读", true) { onForked() } }
                }
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(c.bgSecondary)
                        .border(0.5.dp, c.sep, RoundedCornerShape(16.dp))
                        .padding(14.dp),
                ) {
                    Column {
                        MonoText("原始行动 · 第 ${msgIndex + 1} 条", c.label3, 9)
                        SpacerH(4)
                        Text(original?.content ?: "", color = c.muted, fontSize = 13.sp, fontFamily = FontFamily.Serif)
                    }
                }
                Column {
                    SectionLabel("修改为")
                    // 行动可能很长，必须多行编辑（单行框会把长行动压成一截不可读）
                    IosField(text, { text = it }, "输入修改后的行动…", singleLine = false, minLines = 3)
                    MonoText("${text.length} 字", c.label3, 10, Modifier.fillMaxWidth().padding(top = 6.dp))
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(c.coral.copy(alpha = 0.06f))
                        .border(0.5.dp, c.coral.copy(alpha = 0.2f), RoundedCornerShape(16.dp))
                        .padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    IconWarn(14.dp, c.coral)
                    Column {
                        Text("将丢弃后续 ${messages.size - baseIndex - 1} 条消息", color = c.coral, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        MonoText("确认后，该行动之后的叙事将被替换。被抛弃的叙事已留痕，永不静默覆盖。", c.coral.copy(alpha = 0.7f), 9)
                    }
                }
                if (step == 0) {
                    Box(Modifier.fillMaxWidth()) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .background(c.gold)
                                .clickable(enabled = text.isNotBlank()) { step = 1 }
                                .padding(vertical = 14.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text("继续 → 确认回溯", color = Color(0xFF0A0600), fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
                    }
                } else {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(c.bgSecondary)
                            .border(0.5.dp, c.sep, RoundedCornerShape(16.dp))
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text("回溯确认", color = c.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        ConfirmRow("将丢弃", "后续 ${messages.size - baseIndex - 1} 条消息", c.coral)
                        ConfirmRow("新行动", text.take(24), c.label)
                    }
                    Box(Modifier.fillMaxWidth()) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(c.coral)
                                .clickable { controller.forkFrom(baseIndex, text); step = 2 }
                                .padding(vertical = 14.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text("确认丢弃并重新生成", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
                    }
                    GhostBtnSimple("返回修改") { step = 0 }
                }
            }
        }
        HomeIndicator()
    }
}

@Composable
private fun ConfirmRow(label: String, value: String, valueColor: Color) {
    val c = LocalSwColors.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        MonoText(label, c.label3, 10)
        Text(value, color = valueColor, fontSize = 10.sp, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun GhostBtnSimple(text: String, onClick: () -> Unit) {
    val c = LocalSwColors.current
    Box(Modifier.fillMaxWidth()) {
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(c.fillTer)
                .clickable(onClick = onClick)
                .padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) { Text(text, color = c.label2, fontSize = 14.sp, fontWeight = FontWeight.Medium) }
    }
}
