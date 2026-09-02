package com.sixworlds.mobile.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sixworlds.mobile.chat.Choice
import com.sixworlds.mobile.chat.StoryChatController
import com.sixworlds.mobile.ui.components.BreathingDots
import com.sixworlds.mobile.ui.components.DynamicIsland
import com.sixworlds.mobile.ui.components.IslandPhase
import com.sixworlds.mobile.data.ChatMessage
import com.sixworlds.mobile.ui.theme.AppearanceScale
import com.sixworlds.mobile.ui.theme.LocalSwColors
import kotlinx.coroutines.delay
import org.json.JSONObject

@Composable
fun ChatScreen(controller: StoryChatController, onOpen: (String) -> Unit) {
    val c = LocalSwColors.current
    val messages by controller.messages.collectAsState()
    val busy by controller.busy.collectAsState()
    val streaming by controller.streaming.collectAsState()
    val engineBusy by controller.engineBusy.collectAsState()
    val toast by controller.toast.collectAsState()
    val choices by controller.choices.collectAsState()
    val sceneText by controller.sceneText.collectAsState()
    val settings by controller.settingsFlow.collectAsState()
    val wsVersion by controller.wsVersion.collectAsState()

    @Suppress("DEPRECATION")
    val clipboard = LocalClipboardManager.current
    var input by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("") }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var showError by remember { mutableStateOf(true) }
    var pendings by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var menuForMsg by remember { mutableStateOf<Int?>(null) }
    var diExpanded by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    // 仅当用户停留在底部附近时跟随滚动；流式刷新用瞬时滚动，避免动画被每 50ms 的更新反复重启
    LaunchedEffect(messages.size, streaming, busy) {
        val n = messages.size + if (busy) 1 else 0
        if (n == 0) return@LaunchedEffect
        val info = listState.layoutInfo
        val nearBottom = info.totalItemsCount == 0 ||
            listState.firstVisibleItemIndex + info.visibleItemsInfo.size >= info.totalItemsCount - 2
        if (nearBottom) listState.scrollToItem(n - 1)
    }
    // 选项刷新（重生成/删除/回溯）后清理已失效的多选
    LaunchedEffect(choices) {
        if (selected.isNotEmpty()) selected = selected.filter { s -> choices.any { it.label == s } }.toSet()
    }
    LaunchedEffect(messages.size, wsVersion, busy, engineBusy) {
        if (!busy && !engineBusy) pendings = controller.pendingsSnapshot()
    }
    LaunchedEffect(toast) { if (toast != null) { delay(3600); controller.clearToast() } }
    // 搜索跳转：消费一次性目标下标，滚动到位后清空
    val jumpTarget by controller.jumpTarget.collectAsState()
    LaunchedEffect(jumpTarget) {
        val t = jumpTarget ?: return@LaunchedEffect
        if (t in messages.indices) listState.animateScrollToItem(t)
        controller.jumpTarget.value = null
    }
    // 生成中返回：不直接退出，先停止生成（保留已生成内容），与桌面关闭确认行为对齐
    androidx.activity.compose.BackHandler(enabled = busy || engineBusy) {
        controller.stop()
        controller.toastPublic("已停止生成，保留已生成内容")
    }

    val canSend = input.isNotBlank() || selected.isNotEmpty()

    fun doSend() {
        val joined = selected.joinToString("；")
        val text = input.trim().ifEmpty { joined }
        if (text.isEmpty()) return
        input = ""
        selected = emptySet()
        controller.send(text)
    }

    Box(Modifier.fillMaxSize().background(c.bg).imePadding()) {
        Column(Modifier.fillMaxSize()) {
            NavBar(
                title = controller.sessionTitle(),
                sub = "R${messages.count { it.role == "assistant" }} · ${controller.currentWorkspace().name}",
                onMenu = { onOpen("drawer") },
                right = {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        IconBtn(onClick = { onOpen("search") }) { IconSearch(17.dp, c.label2) }
                        IconBtn(onClick = { onOpen("snapshots") }) { IconClock(18.dp, c.label2) }
                        IconBtn(onClick = { onOpen("state") }) { IconGrid(18.dp, c.label2) }
                    }
                },
            )

            if (busy || engineBusy) {
                Spacer(Modifier.fillMaxWidth().height(if (diExpanded) 178.dp else 54.dp))
            }

            if (messages.isEmpty() && !busy) {
                Column(
                    Modifier.weight(1f).fillMaxWidth().padding(horizontal = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box(Modifier.size(120.dp)) {
                        IllStoryBegin(Modifier.fillMaxSize())
                        Box(
                            Modifier.align(Alignment.BottomEnd).size(32.dp).clip(RoundedCornerShape(12.dp)).background(c.gold),
                            contentAlignment = Alignment.Center,
                        ) { IconPlus(15.dp, c.onGold, 2f) }
                    }
                    SpacerH(16)
                    Text("开始你的故事", color = c.label, fontSize = 21.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Serif)
                    SpacerH(6)
                    Text(
                        "从左上角菜单选择一条世界线\n或直接输入你的第一个行动",
                        color = c.label2, fontSize = 14.sp, lineHeight = 23.sp, modifier = Modifier.padding(top = 4.dp),
                    )
                    SpacerH(20)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ChipButton("观察四周的环境", false) { controller.send("观察四周的环境") }
                        ChipButton("检查随身的物品", false) { controller.send("检查随身的物品") }
                    }
                    SpacerH(12)
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(c.gold)
                            .clickable { controller.fillDemo() }
                            .padding(horizontal = 28.dp, vertical = 14.dp),
                    ) { Text("载入效果演示", color = c.onGold, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = PaddingValues(top = 12.dp),
                ) {
                    itemsIndexed(messages) { index, m ->
                        MessageRow(
                            m = m,
                            index = index,
                            round = roundAt(messages, index),
                            isLast = index == messages.lastIndex,
                            sceneHeader = if (index == messages.lastIndex && m.role == "assistant") sceneText else "",
                            fontScale = AppearanceScale.fontSizes[settings.fontSizeIdx.coerceIn(0, 3)],
                            widthFactor = AppearanceScale.bubbleWidths[settings.bubbleWidthIdx.coerceIn(0, 2)],
                            density = AppearanceScale.densities[settings.densityIdx.coerceIn(0, 3)],
                            serif = settings.serifFont,
                            hideOptions = index == messages.lastIndex && choices.isNotEmpty(),
                            menuOpen = menuForMsg == index,
                            onLongPress = { menuForMsg = index },
                            onMenuDismiss = { if (menuForMsg == index) menuForMsg = null },
                            onCopy = {
                                clipboard.setText(AnnotatedString(m.content))
                                menuForMsg = null
                            },
                            onFork = { menuForMsg = null; onOpen("fork:$index") },
                            onRegen = { if (index == messages.lastIndex) controller.regen(); menuForMsg = null },
                            onDelete = { controller.deleteMessageAt(index); menuForMsg = null },
                        )
                    }
                    if (busy) {
                        item { GeneratingCard(streaming, streaming.length, settings.serifFont) }
                    }
                    if (!busy && showError && pendings.isNotEmpty()) {
                        item {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 6.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(c.orange.copy(alpha = 0.08f))
                                    .border(0.5.dp, c.orange.copy(alpha = 0.22f), RoundedCornerShape(12.dp))
                                    .padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                IconWarn(15.dp, c.orange)
                                Text("状态提取失败 —", Modifier.weight(1f), color = c.orange, fontSize = 12.sp)
                                Text(
                                    "查看补录队列", Modifier.clickable { onOpen("pending") },
                                    color = c.orange, fontSize = 12.sp,
                                    textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                                )
                                Box(Modifier.clickable { showError = false }) { IconClose(13.dp, c.label3) }
                            }
                        }
                    }
                    if (!busy && choices.isNotEmpty()) {
                        item {
                            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                                Row(
                                    Modifier.fillMaxWidth().padding(bottom = 12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Box(Modifier.weight(1f).height(0.5.dp).background(c.sep))
                                    MonoText("选择行动", c.label3, 11)
                                    Box(Modifier.weight(1f).height(0.5.dp).background(c.sep))
                                }
                                choices.forEach { choice ->
                                    val on = choice.label in selected
                                    Row(
                                        Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(16.dp))
                                            .background(if (on) c.goldFill else c.fillTer)
                                            .border(0.5.dp, if (on) c.goldBorder else Color.Transparent, RoundedCornerShape(16.dp))
                                            .clickable {
                                                selected = if (on) selected - choice.label else selected + choice.label
                                            }
                                            .padding(horizontal = 16.dp, vertical = 12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    ) {
                                        Box(
                                            Modifier
                                                .size(18.dp)
                                                .clip(CircleShape)
                                                .background(if (on) c.gold else c.fill)
                                                .border(1.dp, if (on) Color.Transparent else c.sep, CircleShape),
                                            contentAlignment = Alignment.Center,
                                        ) { if (on) IconCheck(11.dp, c.onGold) }
                                        Text(
                                            choice.label, color = if (on) c.goldBright else c.label,
                                            fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.weight(1f),
                                        )
                                    }
                                    SpacerH(8)
                                }
                            }
                        }
                    }
                    item { SpacerH(8) }
                }
            }

            // 输入栏始终显示（空会话时用户也需要能输入第一条行动）；顶部仅一条分隔发线
            Separator()
            Column(
                Modifier
                    .fillMaxWidth()
                        .background(c.navbarBlur)
                        .navigationBarsPadding()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    if (selected.isNotEmpty()) {
                        Row(
                            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            selected.forEach { opt ->
                                Row(
                                    Modifier
                                        .clip(RoundedCornerShape(999.dp))
                                        .background(c.goldFillSub)
                                        .border(1.dp, c.goldBorder, RoundedCornerShape(999.dp))
                                        .padding(horizontal = 12.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text(opt, color = c.goldBright, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp))
                                    Box(Modifier.clickable { selected = selected - opt }) { IconClose(12.dp, c.gold) }
                                }
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                        ToolBtn("插图") { onOpen("illustrations") }
                        ToolBtn("补录队列", badge = pendings.size) { onOpen("pending") }
                        ToolBtn("快照") { onOpen("snapshots") }
                    }
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(
                            Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(16.dp))
                                .background(c.fillSec)
                                .border(0.5.dp, if (canSend) c.goldBorder else c.sep, RoundedCornerShape(16.dp))
                                .padding(horizontal = 14.dp, vertical = 4.dp),
                        ) {
                            TextField(
                                value = input,
                                onValueChange = { input = it },
                                placeholder = {
                                    Text(
                                        if (selected.isNotEmpty()) "可继续补充细节，或直接发送…" else "输入你的行动…",
                                        color = c.label3, fontSize = 14.sp,
                                    )
                                },
                                textStyle = androidx.compose.ui.text.TextStyle(color = c.label, fontSize = 14.sp, lineHeight = 20.sp),
                                colors = TextFieldDefaults.colors(
                                    focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                                    focusedTextColor = c.label, unfocusedTextColor = c.label,
                                    cursorColor = c.gold, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                                ),
                                minLines = 1, maxLines = 5,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp, max = 120.dp),
                            )
                        }
                        val gen = busy || engineBusy
                        Box(
                            Modifier
                                .size(44.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(
                                    when {
                                        gen -> c.error.copy(alpha = 0.85f)
                                        canSend -> c.gold
                                        else -> c.fillTer
                                    }
                                )
                                .clickable { if (gen) controller.stop() else doSend() },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (gen) {
                                Box(Modifier.size(11.dp).clip(RoundedCornerShape(2.dp)).background(Color.White))
                            } else {
                                IconArrow(18.dp, if (canSend) c.onGold else c.label3)
                            }
                        }
                    }
                }
            }


        DynamicIsland(
            visible = busy || engineBusy,
            phase = if (engineBusy) IslandPhase.UNLOG else IslandPhase.TEXT,
            modelName = settings.model,
            streamText = streaming.substringBefore("<<<STATE_PATCH>>>").substringBefore("<<<NO_STATE_CHANGE>>>"),
            charCount = streaming.length,
            onStop = { controller.stop() },
            expanded = diExpanded,
            onToggle = { diExpanded = !diExpanded },
            modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 10.dp),
        )

    }
}

/** 生成中内联卡片 */
@Composable
private fun GeneratingCard(streaming: String, wordCount: Int, serif: Boolean) {
    val c = LocalSwColors.current
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(c.goldFillSub)
            .border(0.5.dp, c.goldBorder, RoundedCornerShape(24.dp))
            .padding(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BreathingDots(3, c.gold, 5.dp)
            Spacer(Modifier.width(8.dp))
            Text("叙事生成中", color = c.gold, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp)
            Spacer(Modifier.weight(1f))
            MonoText("$wordCount 字", c.label3, 11)
        }
        SpacerH(12)
        val shown = streaming
            .substringBefore("<<<STATE_PATCH>>>")
            .substringBefore("<<<NO_STATE_CHANGE>>>")
            .ifEmpty { "正在构思这一幕的展开……" }
        Text(
            shown + " ▌",
            color = c.label2, fontSize = 14.sp, lineHeight = 24.sp,
            fontFamily = if (serif) FontFamily.Serif else FontFamily.Default, fontStyle = FontStyle.Italic,
            maxLines = 8, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 消息行 —— 对齐新原型 MessageRow（动作金泡 / 叙事卡 + 金色左侧线） */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageRow(
    m: ChatMessage,
    index: Int,
    round: Int,
    isLast: Boolean,
    sceneHeader: String,
    fontScale: Float,
    widthFactor: Float,
    density: Float,
    serif: Boolean,
    hideOptions: Boolean,
    menuOpen: Boolean,
    onLongPress: () -> Unit,
    onMenuDismiss: () -> Unit,
    onCopy: () -> Unit,
    onFork: () -> Unit,
    onRegen: () -> Unit,
    onDelete: () -> Unit,
) {
    val c = LocalSwColors.current
    val isUser = m.role == "user"

    if (isUser) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Box(
                    Modifier
                        .widthIn(max = (330 * widthFactor).dp)
                        .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 8.dp, bottomStart = 24.dp, bottomEnd = 24.dp))
                        .background(c.goldFill)
                        .border(1.dp, c.goldBorder, RoundedCornerShape(topStart = 24.dp, topEnd = 8.dp, bottomStart = 24.dp, bottomEnd = 24.dp))
                        .combinedClickable(onClick = {}, onLongClick = onLongPress)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Text(m.content, color = c.label, fontSize = (15f * fontScale).sp, lineHeight = (15f * fontScale * density).sp)
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp, end = 4.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MonoText("R$round · ${fmtTime(m.at)}", c.label3, 10)
                Spacer(Modifier.width(8.dp))
                Text(
                    "⋯", color = c.label3, fontSize = 13.sp,
                    modifier = Modifier.clickable { onLongPress() }.padding(horizontal = 4.dp),
                )
            }
            if (menuOpen) {
                Column(
                    Modifier
                        .align(Alignment.End)
                        .clip(RoundedCornerShape(16.dp))
                        .background(c.bgTertiary)
                        .border(0.5.dp, c.sep, RoundedCornerShape(16.dp)),
                ) {
                    // 「重新生成」仅对最后一条有意义（引擎只支持重生末条），其余位置不显示，避免假按钮
                    val items = buildList<Pair<String, () -> Unit>> {
                        add("复制文本" to onCopy)
                        add("编辑并回溯" to onFork)
                        if (isLast) add("重新生成" to { onRegen() })
                    }
                    items.forEach { (label, act) ->
                        Text(label, Modifier.fillMaxWidth().clickable { act() }.padding(horizontal = 16.dp, vertical = 12.dp), color = c.label, fontSize = 14.sp)
                    }
                    Text("删除", Modifier.fillMaxWidth().clickable { onDelete() }.padding(horizontal = 16.dp, vertical = 12.dp), color = c.coral, fontSize = 14.sp)
                }
            }
        }
        return
    }

    // ── 叙事 ──
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        if (sceneHeader.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.Center) {
                Row(
                    Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(c.goldFillSub)
                        .border(0.5.dp, c.goldBorder, RoundedCornerShape(999.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(4.dp).background(c.gold, CircleShape))
                    MonoText("$sceneHeader · R$round", c.goldText, 10)
                }
            }
        }
        if (m.illustLabel.isNotEmpty()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9.4f)
                    .clip(RoundedCornerShape(16.dp))
                    .background(
                        // 浅色主题用暖灰渐变，避免浅底上出现突兀的深色块
                        Brush.linearGradient(
                            if (c.isDark) listOf(Color(0xFF141A24), Color(0xFF1E2430), Color(0xFF10141C))
                            else listOf(Color(0xFFE9E4D8), Color(0xFFF2EDE3), Color(0xFFE4DED2)),
                        ),
                    )
                    .border(0.5.dp, c.sep, RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center,
            ) {
                IconSparkle(22.dp, c.gold.copy(alpha = 0.5f))
                Text(
                    m.illustLabel,
                    Modifier.align(Alignment.BottomStart).padding(8.dp),
                    color = if (c.isDark) Color.White.copy(alpha = 0.55f) else c.label3, fontSize = 9.sp, fontFamily = FontFamily.Monospace,
                )
            }
            SpacerH(8)
        }
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(c.label.copy(alpha = if (c.isDark) 0.06f else 0.045f))
                .border(0.5.dp, c.sep, RoundedCornerShape(16.dp)),
        ) {
            Box(
                Modifier
                    .width(2.5.dp)
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(listOf(c.gold.copy(alpha = 0.5f), c.gold.copy(alpha = 0.1f))),
                    ),
            )
            Column(Modifier.weight(1f).padding(horizontal = 16.dp, vertical = 16.dp)) {
                // 结构化叙事渲染：【你需要决定】/【简要状态】/选项行各自成块；选项行由下方芯片承担交互，末条正文中隐藏
                NarrativeText(
                    m.content,
                    hideOptionLines = hideOptions,
                    fontSizeScale = fontScale,
                    baseFontSize = 16f,
                    lineHeightScale = density,
                    serif = serif,
                )
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 8.dp, start = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("复制", fontSize = 12.sp, color = c.label3, modifier = Modifier.clickable { onCopy() })
            // 仅末条可重生成；回溯入口只对用户行动开放（引擎不支持从叙事消息分叉）
            if (isLast) Text("重新生成", fontSize = 12.sp, color = c.label3, modifier = Modifier.clickable { onRegen() })
        }
        if (m.pending) {
            Row(Modifier.padding(top = 6.dp, start = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconWarn(11.dp, c.orange)
                    MonoText("状态待补录", c.orange, 10)
                }
        }
    }
}

/** 消息所属回合号：用户行动 = 之前已完成回合数 + 1；叙事 = 截至本条已完成的回合数。 */
private fun roundAt(messages: List<ChatMessage>, index: Int): Int {
    var n = 0
    val end = index.coerceAtMost(messages.lastIndex)
    for (i in 0..end) if (messages[i].role == "assistant") n++
    return if (messages.getOrNull(index)?.role == "assistant") n else n + 1
}
