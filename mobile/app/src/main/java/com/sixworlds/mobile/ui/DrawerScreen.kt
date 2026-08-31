package com.sixworlds.mobile.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.sixworlds.mobile.chat.StoryChatController
import com.sixworlds.mobile.data.StorySession
import com.sixworlds.mobile.ui.theme.LocalSwColors

/** 左侧抽屉 —— 世界集切换卡 + 世界线（长按：重命名/删除）+ 工具/系统导航 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DrawerScreen(
    controller: StoryChatController,
    onClose: () -> Unit,
    onOpen: (String) -> Unit,
) {
    val c = LocalSwColors.current
    val wsVersion by controller.wsVersion.collectAsState()
    var rerecordCount by remember { mutableIntStateOf(0) }
    var menuSession by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    var renameSession by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(wsVersion) {
        runCatching { rerecordCount = controller.pendingsSnapshot().size }
    }

    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).clickable(onClick = onClose))
        Column(
            Modifier
                .fillMaxHeight()
                .width(300.dp)
                .background(c.drawerBg)
                // 消费抽屉内点击：避免穿透到遮罩误关；点空白处顺带收起长按小菜单
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { menuSession = null }
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 20.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column {
                    MonoText("SIX WORLDS", c.gold, 10)
                    Text("六面世界", color = c.label, fontSize = 22.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Serif, letterSpacing = (-0.2).sp)
                }
                Box(
                    Modifier.size(32.dp).clip(CircleShape).background(c.fillTer).clickable(onClick = onClose),
                    contentAlignment = Alignment.Center,
                ) { IconClose(13.dp, c.label2) }
            }

            Row(
                Modifier
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(c.fillTer)
                    .clickable { onOpen("worldSwitch") }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                WorldAvatar(controller.currentWorkspace().name, c.gold, 40)
                Column(Modifier.weight(1f)) {
                    Text(controller.currentWorkspace().name, color = c.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    MonoText(kernelDisplayName(controller.currentWorkspace().kernelFile ?: "kernel.md") + " · " + controller.sessionsOfCurrent().size + " 条世界线", c.label3, 11)
                }
                Text("切换", color = c.gold, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }

            LazyColumn(Modifier.weight(1f)) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("世界线", color = c.label3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            "+ 新建", color = c.gold, fontSize = 13.sp,
                            modifier = Modifier.clickable { controller.newSession(); onClose() },
                        )
                    }
                }
                items(controller.sessionsOfCurrent(), key = { it.id }) { s ->
                    val active = s.id == controller.currentSessionId()
                    Box {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .background(if (active) c.goldFillSub else Color.Transparent)
                                .combinedClickable(
                                    onClick = { controller.switchSession(s.id); onClose() },
                                    onLongClick = { menuSession = s.id; confirmDelete = null },
                                )
                                .padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier.width(4.dp).height(24.dp).clip(RoundedCornerShape(2.dp))
                                    .background(if (active) c.gold else Color.Transparent),
                            )
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    s.title, color = if (active) c.gold else c.label,
                                    fontSize = 14.sp, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                                )
                                MonoText(s.messages.count { it.role == "assistant" }.toString() + " 回合 · " + fmtTime(s.updatedAt), c.label3, 11)
                            }
                        }
                        if (menuSession == s.id) {
                            Row(
                                Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(top = 8.dp, end = 8.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(c.bgTertiary)
                                    .border(0.5.dp, c.sep, RoundedCornerShape(12.dp)),
                            ) {
                                Text("重命名", Modifier.clickable { menuSession = null; renameSession = s.id }.padding(horizontal = 12.dp, vertical = 8.dp), color = c.label, fontSize = 12.sp)
                                if (confirmDelete == s.id) {
                                    Text(
                                        "确认删除？",
                                        Modifier.clickable { confirmDelete = null; menuSession = null; controller.deleteSession(s.id) }.padding(horizontal = 12.dp, vertical = 8.dp),
                                        color = c.coral, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                                    )
                                } else {
                                    Text("删除", Modifier.clickable { confirmDelete = s.id }.padding(horizontal = 12.dp, vertical = 8.dp), color = c.coral, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }

                item {
                    Column {
                        SectionLabel("工具")
                        NavLink("状态引擎", "事实·关系·承诺·伏笔台账") { onOpen("state") }
                        NavLink("快照记录", "存档与回滚") { onOpen("snapshots") }
                        NavLink("待补录队列", if (rerecordCount > 0) rerecordCount.toString() + " 条待处理" else "队列为空", badge = rerecordCount) { onOpen("pending") }
                        NavLink("插图画廊", "AI生成插图集") { onOpen("gallery") }
                        SectionLabel("系统")
                        NavLink("模型配置") { onOpen("modelConfig") }
                        NavLink("外观个性化") { onOpen("appearance") }
                        NavLink("设置") { onOpen("settings") }
                        NavLink("帮助与手势") { onOpen("help") }
                        SpacerH(24)
                    }
                }
            }
        }

        renameSession?.let { sid ->
            val target = controller.sessionStore.sessions.firstOrNull { it.id == sid }
            var value by remember(sid) { mutableStateOf(target?.title ?: "") }
            AlertDialog(
                onDismissRequest = { renameSession = null },
                title = { Text("重命名世界线", color = c.label, fontSize = 15.sp) },
                text = {
                    TextField(
                        value = value, onValueChange = { value = it }, singleLine = true,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = c.bubble, unfocusedContainerColor = c.bubble,
                            focusedTextColor = c.label, unfocusedTextColor = c.label,
                            cursorColor = c.gold, focusedIndicatorColor = c.gold, unfocusedIndicatorColor = c.border,
                        ),
                    )
                },
                confirmButton = { Text("确定", color = c.gold, fontSize = 14.sp, modifier = Modifier.clickable { controller.renameSession(sid, value); renameSession = null }.padding(8.dp)) },
                dismissButton = { Text("取消", color = c.muted, fontSize = 14.sp, modifier = Modifier.clickable { renameSession = null }.padding(8.dp)) },
                containerColor = c.sheetBg,
            )
        }
    }
}

@Composable
fun NavLink(label: String, sub: String? = null, badge: Int = 0, onClick: () -> Unit) {
    val c = LocalSwColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, color = c.label, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            if (sub != null) MonoText(sub, c.label3, 12)
        }
        if (badge > 0) {
            Box(
                Modifier.size(20.dp).background(c.coral, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text(badge.toString(), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
        }
        Spacer(Modifier.width(8.dp))
        Text("›", color = c.label3, fontSize = 13.sp)
    }
}
