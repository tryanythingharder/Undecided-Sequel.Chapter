package com.sixworlds.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.sixworlds.mobile.chat.StoryChatController
import com.sixworlds.mobile.ui.theme.LocalSwColors
import org.json.JSONObject
import java.io.File
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip

/** iOS 分组设置（对齐新原型 SettingsScreen） */
@Composable
fun SettingsScreen(controller: StoryChatController, onBack: () -> Unit, onOpen: (String) -> Unit = { }) {
    val c = LocalSwColors.current
    val settings by controller.settingsFlow.collectAsState()
    val ctx = LocalContext.current
    var storage by remember { mutableStateOf("…") }
    var dangerStep by remember { mutableStateOf(0) }

    LaunchedEffect(Unit) {
        storage = String.format("%.0f MB", ctx.filesDir.walkTopDown().filter { it.isFile }.sumOf { it.length() } / 1048576.0)
    }

    val exportConfig = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            val json = JSONObject().put("type", "sixworlds-config").put("baseUrl", settings.baseUrl)
                .put("model", settings.model).put("models", settings.models).put("thinkLevel", settings.thinkLevel)
                .put("kernelFile", settings.kernelFile).put("ctxCount", settings.ctxCount)
            ctx.contentResolver.openOutputStream(uri)?.use { it.write(json.toString().toByteArray()) }
        }
    }
    val importConfig = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            val obj = JSONObject(ctx.contentResolver.openInputStream(uri)!!.readBytes().toString(Charsets.UTF_8))
            controller.saveSettings(
                settings.copy(
                    baseUrl = obj.optString("baseUrl", settings.baseUrl), model = obj.optString("model", settings.model),
                    thinkLevel = obj.optString("thinkLevel", settings.thinkLevel), kernelFile = obj.optString("kernelFile", settings.kernelFile),
                    ctxCount = obj.optInt("ctxCount", settings.ctxCount),
                )
            )
        }
    }
    val exportCode = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        ctx.contentResolver.openOutputStream(uri)?.use { it.write(controller.sessionSaveCode().toByteArray()) }
    }
    val importCode = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            val text = ctx.contentResolver.openInputStream(uri)!!.readBytes().toString(Charsets.UTF_8)
            controller.toastPublic(if (controller.importSaveCode(text)) "已导入" else "无效续玩码")
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.bg)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState()),
    ) {
        NavBar(title = "设置", onMenu = { onBack() })
        SpacerH(16)

        Grp("外观") {
            SRow("深色主题", right = { ToggleSwitch(settings.mode != "light") { v -> controller.saveSettings(settings.copy(mode = if (v) "dark" else "light")) } })
            SRow("字号", value = listOf("小", "标准", "大", "特大")[settings.fontSizeIdx.coerceIn(0, 3)]) { controller.saveSettings(settings.copy(fontSizeIdx = (settings.fontSizeIdx + 1) % 4)) }
            SRow("阅读宽度", value = listOf("窄", "适中", "宽")[settings.bubbleWidthIdx.coerceIn(0, 2)]) { controller.saveSettings(settings.copy(bubbleWidthIdx = (settings.bubbleWidthIdx + 1) % 3)) }
            SRow("排版密度", value = listOf("紧凑", "适中", "宽松", "超宽")[settings.densityIdx.coerceIn(0, 3)]) { controller.saveSettings(settings.copy(densityIdx = (settings.densityIdx + 1) % 4)) }
        }
        Grp("AI 引擎") {
            SRow("模型配置") { onOpen("modelConfig") }
            SRow("插图设置") { onOpen("illustrations") }
            SRow("状态引擎") { onOpen("state") }
            SRow("连接测试") { controller.testConnection { controller.toastPublic(it) } }
        }
        Grp("玩法") {
            SRow("世界内核", value = kernelDisplayName(settings.kernelFile)) { 
                val next = if (settings.kernelFile == "kernel.md") "kernel-xianxia.md" else "kernel.md"
                controller.saveSettings(settings.copy(kernelFile = next))
            }
            SRow("上下文轮数", value = "${settings.ctxCount} 轮") {
                val steps = listOf(8, 16, 24, 32, 48, 64)
                controller.saveSettings(settings.copy(ctxCount = steps[(steps.indexOf(settings.ctxCount) + 1).mod(steps.size)]))
            }
            SRow("跳过开场动画", right = { ToggleSwitch(settings.skipSplash) { v -> controller.saveSettings(settings.copy(skipSplash = v)) } })
        }
        Grp("数据") {
            SRow("配置导入 / 导出") { exportConfig.launch("sixworlds-config.json") }
            SRow("续玩码导出") { exportCode.launch("sixworlds-savecode.json") }
            SRow("续玩码导入") { importCode.launch(arrayOf("application/json")) }
            SRow("存储占用", value = storage)
            // 危险操作两段确认：第一次点击只进入待确认态，避免误触直接删除整个世界集
            SRow(if (dangerStep == 1) "再次点击确认清空" else "清空当前世界集", danger = true) {
                if (dangerStep == 1) {
                    dangerStep = 0
                    controller.deleteWorkspace(controller.currentWsId())
                    controller.toastPublic("已清空")
                } else {
                    dangerStep = 1
                    controller.toastPublic("将再次删除当前世界集全部世界线，再次点击确认")
                }
            }
        }
        Grp("关于") {
            SRow("版本", value = "v1.0.0-beta")
            SRow("六面世界 · 私语引擎")
        }
        SpacerH(32)
    }
}

@Composable
private fun Grp(title: String, content: @Composable () -> Unit) {
    val c = LocalSwColors.current
    Column(Modifier.padding(bottom = 24.dp)) {
        Text(
            title,
            Modifier.fillMaxWidth().padding(start = 20.dp, bottom = 6.dp),
            color = c.label3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp,
        )
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(c.bgSecondary)
                .border(0.5.dp, c.sep, RoundedCornerShape(12.dp)),
        ) { content() }
    }
}

@Composable
private fun SRow(label: String, value: String? = null, danger: Boolean = false, right: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null) {
    val c = LocalSwColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = onClick != null, onClick = { onClick?.invoke() })
            .padding(horizontal = 20.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = if (danger) c.coral else c.label, fontSize = 16.sp, modifier = Modifier.weight(1f))
        if (right != null) right() else {
            // 循环切换档位的行：值用金色暗示可点；纯展示行（无 onClick）不画箭头，避免假入口
            val cycles = onClick != null && value != null
            Text(value ?: "", color = if (cycles) c.gold else c.label2, fontSize = 14.sp)
            if (onClick != null && value == null) Box(Modifier.padding(start = 8.dp)) { IconChevron(13.dp, c.label3) }
        }
    }
}

/** 画廊（结构就绪；插图生成后端未接） */
@Composable
fun GalleryScreen(controller: StoryChatController, onBack: () -> Unit) {
    val c = LocalSwColors.current
    Column(
        Modifier
            .fillMaxSize()
            .background(c.bg)
            .statusBarsPadding(),
    ) {
        NavBar(title = "插图画廊", sub = "AI生成插图存档", onMenu = { onBack() })
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GoldPillChip("全部", true) {}
        }
        Column(Modifier.fillMaxWidth().padding(top = 120.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(
                Modifier
                    .size(72.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(c.goldFillSub)
                    .border(1.dp, c.goldBorder, RoundedCornerShape(20.dp)),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                IconImage(30.dp, c.gold)
            }
            SpacerH(10)
            Text("还没有插图", color = c.label2, fontSize = 15.sp)
            MonoText("开启自动生成后，每轮叙事都会配图", c.label3, 10)
        }
        HomeIndicator()
    }
}

/** 帮助（对齐新原型 HelpScreen） */
@Composable
fun HelpScreen(onBack: () -> Unit) {
    val c = LocalSwColors.current
    val items = listOf(
        listOf("如何开始一条新故事？", "从左上角菜单 → 世界线 → + 新建，或直接输入你的第一个行动。"),
        listOf("如何切换世界集？", "打开左侧菜单，点击当前世界集右侧的「切换」按钮。"),
        listOf("什么是快照？", "快照是任意回合的存档。恢复后，之后的剧情将移入弃置叙事档案，永久留痕。"),
        listOf("补录队列是什么？", "当状态提取失败时，该回合进入补录队列，可单条重试或批量处理。"),
        listOf("如何返回上级？", "Android 系统返回手势，或点击导航栏左侧菜单按钮。"),
        listOf("长按消息有什么操作？", "长按任意消息可呼出：复制 / 编辑回溯 / 重新生成 / 删除。"),
    )
    Column(
        Modifier
            .fillMaxSize()
            .background(c.bg)
            .statusBarsPadding(),
    ) {
        NavBar(title = "帮助与手势", onMenu = { onBack() })
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
            listOf("基础操作" to items.take(2), "游戏玩法" to items.drop(2).take(2), "手势" to items.drop(4)).forEach { (g, list) ->
                Text(g, color = c.label3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 8.dp))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(0.5.dp, c.sep, RoundedCornerShape(16.dp)),
                ) {
                    list.forEachIndexed { idx, (q, a) ->
                        Column(Modifier.fillMaxWidth().background(c.bgSecondary).padding(16.dp)) {
                            Text(q, color = c.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            SpacerH(5)
                            Text(a, color = c.label2, fontSize = 13.sp, lineHeight = 20.sp)
                        }
                        if (idx < list.size - 1) Separator()
                    }
                }
                SpacerH(16)
            }
        }
    }
}
