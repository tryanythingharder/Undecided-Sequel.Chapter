package com.sixworlds.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import com.sixworlds.mobile.chat.StoryChatController
import com.sixworlds.mobile.ui.theme.LocalSwColors
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// ==================== 状态引擎 Sheet（真实引擎数据） ====================

@Composable
fun StateSheet(controller: StoryChatController, onClose: () -> Unit) {
    val c = LocalSwColors.current
    var overview by remember { mutableStateOf<JSONObject?>(null) }
    var tab by remember { mutableIntStateOf(0) }
    val tabs = listOf("概览", "人物", "事实", "承诺", "伏笔", "日志")

    LaunchedEffect(Unit) { overview = controller.engineOverview() }

    SheetHost(title = "状态引擎", onClose = onClose, heightFraction = 0.88f) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val turn = overview?.optInt("engine_turn") ?: 0
            val counts = overview?.optJSONObject("counts")
            StatTile("回合", "$turn", c.gold, Modifier.weight(1f))
            StatTile("事实", "${counts?.optInt("facts_active") ?: 0}", c.cyan, Modifier.weight(1f))
            StatTile("伏笔", "${counts?.optInt("threads_open") ?: 0}", c.purple, Modifier.weight(1f))
        }
        PanelTer {
            MonoText("当前场景", c.label3, 11)
            Text(controller.sceneText.collectAsState().value.ifEmpty { "—" }, color = c.label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Serif, modifier = Modifier.padding(top = 4.dp))
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            tabs.forEachIndexed { i, t ->
                Box(
                    Modifier.clip(RoundedCornerShape(999.dp)).background(if (tab == i) c.gold else c.fillTer).clickable { tab = i }.padding(horizontal = 12.dp, vertical = 6.dp),
                ) { Text(t, color = if (tab == i) c.onGold else c.label2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
            }
        }
        val lists = listOf("", "entities", "facts", "commitments", "threads", "logs")
        val arr = overview?.optJSONArray(lists[tab])
        if (tab == 0) {
            val player = overview?.optJSONObject("player")
            val pName = player?.optString("name")?.takeIf { it.isNotBlank() }
            val pLoc = player?.optString("location")?.takeIf { it.isNotBlank() }
            listOf(
                "· 世界集「${controller.currentWorkspace().name}」已建立",
                "· 状态引擎运行中（移动端嵌入式 V8）",
            ).plus(if (pName != null) listOf("· 主角：$pName" + (if (pLoc != null) "，位于$pLoc" else "")) else emptyList())
                .forEach { f -> SheetItem(f) }
        } else if (tab == 5) {
            val logIds = remember { mutableStateOf<List<String>>(emptyList()) }
            LaunchedEffect(Unit) {
                logIds.value = runCatching {
                    val a = controller.turnLogIds()
                    (0 until a.length()).mapNotNull { a.optString(it).ifBlank { null } }
                }.getOrDefault(emptyList())
            }
            logIds.value.forEach { SheetItem(it) }
        } else if (arr != null && arr.length() > 0) {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i)
                val text = o?.optString("statement", o.optString("description", o.optString("content", o.optString("title", o.optString("name", "—"))))) ?: "—"
                SheetItem("· $text")
            }
        } else {
            SheetItem(if (overview == null) "引擎加载中……" else "暂无数据（完成一次对话后生成）", dim = true)
        }
    }
}

@Composable
private fun StatTile(label: String, value: String, color: Color, modifier: Modifier = Modifier) {
    val c = LocalSwColors.current
    Column(
        modifier
            .clip(RoundedCornerShape(16.dp))
            .background(c.fillTer)
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, color = color, fontSize = 20.sp, fontWeight = FontWeight.Medium, fontFamily = FontFamily.Monospace)
        Text(label, color = c.label3, fontSize = 11.sp, modifier = Modifier.padding(top = 3.dp))
    }
}

@Composable
private fun PanelTer(content: @Composable () -> Unit) {
    val c = LocalSwColors.current
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(c.fillTer)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) { content() }
}

@Composable
private fun SheetItem(text: String, dim: Boolean = false) {
    val c = LocalSwColors.current
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(c.fillTer)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(text, color = if (dim) c.label3 else c.label, fontSize = 13.sp, lineHeight = 19.sp)
    }
}

// ==================== 快照 Sheet ====================

@Composable
fun SnapshotsSheet(controller: StoryChatController, onClose: () -> Unit) {
    val c = LocalSwColors.current
    var snaps by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var confirm by remember { mutableStateOf<JSONObject?>(null) }
    var reloadTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(reloadTick) { snaps = controller.listSnapshots() }

    SheetHost(title = "快照记录", onClose = onClose, heightFraction = 0.72f) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(c.goldFillSub)
                    .border(1.dp, c.goldBorder, RoundedCornerShape(16.dp))
                    .clickable { controller.takeSnapshot { reloadTick++ } }
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    IconPlus(16.dp, c.gold)
                    Text("创建当前快照", color = c.gold, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        if (snaps.isEmpty()) {
            MonoText("还没有快照", c.label3, 12, Modifier.fillMaxWidth().padding(16.dp))
        }
        snaps.forEach { snap ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .border(0.5.dp, c.sep, RoundedCornerShape(16.dp)),
            ) {
                Row(Modifier.fillMaxWidth().background(c.bgSecondary).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.size(6.dp).background(c.cyan, CircleShape))
                            Text(snap.optString("label").ifEmpty { snap.optString("snapshot_id") }, color = c.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        }
                        MonoText("R${snap.optInt("turn")} · ${fmtTime(snap.optLong("created_at"))}", c.label3, 11)
                    }
                    Text(
                        "还原",
                        Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(c.cyanFill)
                            .clickable { confirm = snap }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        color = c.cyan, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    )
                }
                if (confirm?.optString("snapshot_id") == snap.optString("snapshot_id")) {
                    Column(Modifier.background(c.coral.copy(alpha = 0.06f)).padding(16.dp)) {
                        Text(
                            "确认还原至 R${snap.optInt("turn")}？之后的记录将移入弃置叙事档案。",
                            color = c.label, fontSize = 13.sp, lineHeight = 20.sp,
                        )
                        SpacerH(10)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(c.fillTer).clickable { confirm = null }.padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                                Text("取消", color = c.label2, fontSize = 14.sp)
                            }
                            Box(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(c.coral).clickable {
                                controller.restoreSnapshot(snap.optString("snapshot_id"))
                                confirm = null
                            }.padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                                Text("确认还原", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ==================== 待补录 Sheet ====================

@Composable
fun RerecordSheet(controller: StoryChatController, onClose: () -> Unit) {
    val c = LocalSwColors.current
    var items by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var batchRunning by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { items = controller.pendingsSnapshot() }

    SheetHost(title = "待补录队列", onClose = onClose, heightFraction = 0.6f) {
        if (items.isEmpty()) {
            Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                IllQueueEmpty(Modifier.size(110.dp))
                SpacerH(4)
                Text("补录队列为空", color = c.label2, fontSize = 15.sp)
            }
            return@SheetHost
        }
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(c.goldFillSub)
                .border(1.dp, c.goldBorder, RoundedCornerShape(16.dp))
                .clickable(enabled = !batchRunning) {
                    batchRunning = true
                    // 完成后再按引擎实况刷新列表；被忙碌拒绝或中途失败都不会留下假空队列
                    controller.resolveAllPendings { _, _ ->
                        scope.launch {
                            batchRunning = false
                            items = controller.pendingsSnapshot()
                        }
                    }
                }
                .padding(vertical = 10.dp),
            contentAlignment = Alignment.Center,
        ) { Text(if (batchRunning) "补录中……" else "批量补录所有（${items.size}条）", color = c.goldText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
        items.forEach { pc ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(c.fillTer)
                    .padding(16.dp),
            ) {
                Text("\"${pc.optString("player_input").take(60)}\"", color = c.label, fontSize = 13.sp, lineHeight = 19.sp)
                SpacerH(6)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        pc.optString("patch_error").ifEmpty { "状态块提交失败" }.take(24),
                        Modifier.clip(RoundedCornerShape(999.dp)).background(c.coralFill).padding(horizontal = 8.dp, vertical = 2.dp),
                        color = c.coral, fontSize = 11.sp,
                    )
                    MonoText("重试 ${pc.optInt("retry_count")}×", c.label3, 10)
                }
                SpacerH(12)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(c.goldFillSub).border(1.dp, c.goldBorder, RoundedCornerShape(12.dp)).clickable {
                            controller.resolveSingle(pc) { ok -> if (ok) items = items.filter { it != pc } }
                        }.padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("重新补录", color = c.gold, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
                    Box(
                        Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(c.coralFill).clickable {
                            controller.discardPending(pc.optString("pending_id")) { items = items.filter { it != pc } }
                        }.padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("丢弃", color = c.coral, fontSize = 12.sp, fontWeight = FontWeight.Medium) }
                }
            }
        }
    }
}

// ==================== 插图设置 Sheet ====================

@Composable
fun IllustrationsSheet(controller: StoryChatController, onClose: () -> Unit) {
    val c = LocalSwColors.current
    val settings by controller.settingsFlow.collectAsState()
    val ill = settings.illust
    fun upd(transform: (com.sixworlds.mobile.data.IllustSettings) -> com.sixworlds.mobile.data.IllustSettings) =
        controller.saveSettings(settings.copy(illust = transform(ill)))

    SheetHost(title = "插图设置", onClose = onClose, heightFraction = 0.68f) {
        PanelTer {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("自动生成插图", color = c.label, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    MonoText("每轮叙事结束后自动触发", c.label2, 12)
                }
                ToggleSwitch(ill.auto) { v -> upd { it.copy(auto = v, enabled = v) } }
            }
        }
        SectionLabel("插图风格")
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("油画风格", "水彩插画", "黑白素描").forEach { s ->
                Box(Modifier.weight(1f)) { GoldPillChip(s, ill.style == s) { upd { it.copy(style = s) } } }
            }
        }
        SpacerH(8)
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("动漫风格", "概念艺术", "自定义").forEach { s ->
                Box(Modifier.weight(1f)) { GoldPillChip(s, ill.style == s) { upd { it.copy(style = s) } } }
            }
        }
        if (ill.style == "自定义") {
            Column(Modifier.padding(horizontal = 16.dp)) {
                MonoText("自定义提示词", c.label3, 12)
                SpacerH(6)
                IosField(ill.custom, { v -> upd { it.copy(custom = v) } }, "dark fantasy, dramatic lighting...")
            }
        }
        SectionLabel("高级参数")
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(RoundedCornerShape(16.dp))
                .border(0.5.dp, c.sep, RoundedCornerShape(16.dp)),
        ) {
            listOf("尺寸" to ill.size, "清晰度" to "标准", "生成张数" to "${ill.n}", "种子锁定" to if (ill.seedLock) "开启" else "关闭").forEachIndexed { i, (l, v) ->
                Row(Modifier.fillMaxWidth().background(c.bgSecondary).padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(l, color = c.label, fontSize = 14.sp)
                    Text(v, color = c.label2, fontSize = 14.sp)
                }
                if (i < 3) Separator()
            }
        }
        SpacerH(12)
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(c.gold)
                    .clickable { onClose() }
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) { Text("完成", color = c.onGold, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
        }
    }
}

// ==================== 切换世界集 Sheet ====================

@Composable
fun WorldSwitchSheet(controller: StoryChatController, onClose: () -> Unit) {
    val c = LocalSwColors.current
    val wsVersion by controller.wsVersion.collectAsState()
    var newName by remember { mutableStateOf("") }
    var showCreate by remember { mutableStateOf(false) }

    SheetHost(title = "切换世界集", onClose = onClose, heightFraction = 0.72f) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(c.goldFillSub)
                    .border(1.dp, c.goldBorder, RoundedCornerShape(16.dp))
                    .clickable { showCreate = !showCreate }
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) { Text("+ 新建世界集", color = c.gold, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
        }
        if (showCreate) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                IosField(newName, { newName = it }, "世界集名称")
                SpacerH(8)
                Box(Modifier.fillMaxWidth()) {
                    Box(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.gold).clickable {
                            controller.newWorkspace(newName, null)
                            newName = ""
                            showCreate = false
                            onClose()
                        }.padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("创建", color = c.onGold, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
                }
            }
        }
        controller.workspacesSnapshot().forEach { w ->
            val active = w.id == controller.currentWsId()
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(if (active) c.goldFillSub else c.fillTer)
                    .border(0.5.dp, if (active) c.goldBorder else Color.Transparent, RoundedCornerShape(16.dp))
                    .clickable { controller.switchWorkspace(w.id); onClose() }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                WorldAvatar(w.name, c.gold, 44)
                Column(Modifier.weight(1f)) {
                    Text(w.name, color = if (active) c.goldBright else c.label, fontSize = 15.sp, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal)
                    MonoText("${kernelDisplayName(w.kernelFile ?: "kernel.md")} · ${controller.sessionsOf(w.id).size} 线", c.label3, 12)
                }
                if (active) Box(Modifier.size(8.dp).background(c.gold, CircleShape))
            }
        }
    }
}

// ==================== 模型配置 Sheet ====================

@Composable
fun ModelConfigSheet(controller: StoryChatController, onClose: () -> Unit) {
    val c = LocalSwColors.current
    val settings by controller.settingsFlow.collectAsState()
    var baseUrl by remember(settings.baseUrl) { mutableStateOf(settings.baseUrl) }
    var apiKey by remember(settings.apiKey) { mutableStateOf(settings.apiKey) }
    var provider by remember(settings.provider) { mutableStateOf(settings.provider) }
    var fetched by remember { mutableStateOf<List<String>?>(null) }
    var testMsg by remember { mutableStateOf("") }
    var testing by remember { mutableStateOf(false) }

    fun commit(transform: (ChatSettingsX) -> ChatSettingsX = { it }) {
        controller.saveSettings(transform(settings).copy(baseUrl = baseUrl, apiKey = apiKey, provider = provider))
    }

    SheetHost(title = "模型配置", onClose = onClose, heightFraction = 0.85f) {
        SectionLabel("提供商")
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf("Anthropic", "OpenAI", "Gemini", "本地（Ollama）", "自定义").forEach { p ->
                GoldPillChip(p, provider == p) {
                    provider = p
                    val preset = when (p) {
                        "Anthropic" -> "https://api.anthropic.com"
                        "OpenAI" -> "https://api.openai.com/v1"
                        "Gemini" -> "https://generativelanguage.googleapis.com"
                        "本地（Ollama）" -> "http://127.0.0.1:11434/v1"
                        else -> null
                    }
                    if (preset != null && baseUrl.isBlank()) baseUrl = preset
                    // 选择即持久化（与模型勾选/思考程度一致），避免只改提供商被静默丢弃
                    controller.saveSettings(settings.copy(provider = p, baseUrl = baseUrl, apiKey = apiKey))
                }
            }
        }
        SectionLabel("API 配置")
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            IosField(baseUrl, { baseUrl = it }, "https://api.anthropic.com")
            IosField(apiKey, { apiKey = it }, "sk-ant-...", mask = true)
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            MonoText("可用模型", c.label3, 12)
            Text(
                "拉取模型列表", color = c.gold, fontSize = 13.sp,
                modifier = Modifier.clickable {
                    testing = true
                    controller.fetchModels { list, err ->
                        testing = false
                        fetched = list
                        testMsg = err ?: "获取到 ${list?.size ?: 0} 个模型"
                    }
                },
            )
        }
        val shown = fetched ?: settings.models.ifEmpty { listOf(settings.model).filter { it.isNotBlank() } }
        if (shown.isNotEmpty()) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .border(0.5.dp, c.sep, RoundedCornerShape(16.dp)),
            ) {
                shown.forEachIndexed { i, m ->
                    val checked = m in settings.models || m == settings.model
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(c.bgSecondary)
                            .clickable {
                                val newModels = if (checked) settings.models - m else settings.models + m
                                controller.saveSettings(settings.copy(models = newModels, model = if (!checked && settings.model.isBlank()) m else settings.model, baseUrl = baseUrl, apiKey = apiKey, provider = provider))
                            }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(
                            Modifier.size(20.dp).clip(CircleShape)
                                .border(1.dp, if (checked) c.gold else c.label3, CircleShape)
                                .background(if (checked) c.gold else Color.Transparent),
                            contentAlignment = Alignment.Center,
                        ) { if (checked) IconCheck(10.dp, c.onGold, 1.6f) }
                        Text(m, Modifier.weight(1f), color = c.label, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
                        if (settings.model == m) {
                            Text("主力", Modifier.clip(RoundedCornerShape(999.dp)).background(c.goldFillSub).padding(horizontal = 8.dp, vertical = 2.dp), color = c.gold, fontSize = 11.sp)
                        }
                    }
                    if (i < shown.size - 1) Separator()
                }
            }
        }
        SectionLabel("思考程度")
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("快速" to "low", "标准" to "default", "扩展" to "medium", "最强" to "high").forEach { (label, lv) ->
                Box(Modifier.weight(1f)) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (settings.thinkLevel == lv) c.gold else c.fillTer)
                            .clickable { controller.saveSettings(settings.copy(thinkLevel = lv, baseUrl = baseUrl, apiKey = apiKey, provider = provider)) }
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(label, color = if (settings.thinkLevel == lv) c.onGold else c.label2, fontSize = 14.sp, fontWeight = FontWeight.Medium) }
                }
            }
        }
        SpacerH(8)
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(c.fillTer)
                    .border(1.dp, c.goldBorder, RoundedCornerShape(16.dp))
                    .clickable {
                        testing = true
                        controller.saveSettings(settings.copy(baseUrl = baseUrl, apiKey = apiKey, provider = provider))
                        controller.testConnection { testMsg = it; testing = false }
                    }
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) { Text(if (testing) "测试中……" else "测试连接", color = c.gold, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
        }
        if (testMsg.isNotEmpty()) {
            MonoText(testMsg, c.label2, 11, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp))
        }
        SpacerH(16)
    }
}

// ==================== 外观个性化 Sheet ====================

@Composable
fun AppearanceSheet(controller: StoryChatController, onClose: () -> Unit) {
    val c = LocalSwColors.current
    val settings by controller.settingsFlow.collectAsState()

    SheetHost(title = "外观个性化", onClose = onClose, heightFraction = 0.6f) {
        PanelTer {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("深色主题", color = c.label, fontSize = 15.sp)
                ToggleSwitch(settings.mode != "light") { v -> controller.saveSettings(settings.copy(mode = if (v) "dark" else "light")) }
            }
        }
        PanelTer {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("衬线叙事字体", color = c.label, fontSize = 15.sp)
                ToggleSwitch(settings.serifFont) { v -> controller.saveSettings(settings.copy(serifFont = v)) }
            }
        }
        SectionLabel("字号")
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("小", "标准", "大", "特大").forEachIndexed { i, s ->
                Box(Modifier.weight(1f)) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (settings.fontSizeIdx == i) c.gold else c.fillTer)
                            .clickable { controller.saveSettings(settings.copy(fontSizeIdx = i)) }
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(s, color = if (settings.fontSizeIdx == i) c.onGold else c.label2, fontSize = 14.sp) }
                }
            }
        }
    }
}

// 占位类型（模型配置 commit 辅助）
private typealias ChatSettingsX = com.sixworlds.mobile.data.ChatSettings
