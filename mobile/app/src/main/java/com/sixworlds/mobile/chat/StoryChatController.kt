package com.sixworlds.mobile.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sixworlds.mobile.data.ChatClient
import com.sixworlds.mobile.data.ChatMessage
import com.sixworlds.mobile.data.ChatSettings
import com.sixworlds.mobile.data.SessionStore
import com.sixworlds.mobile.data.StorySession
import com.sixworlds.mobile.data.Workspace
import com.sixworlds.mobile.engine.EngineBridge
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** 会话内搜索命中 */
data class SearchHit(
    val index: Int, val role: String, val text: String,
    val matchStart: Int, val matchEnd: Int, val at: Long,
)

/**
 * 聊天主流程 —— 对齐桌面 send()/enginePrep()/resolvePendingFlow()/重生成/回溯分叉。
 * 引擎任何故障都不阻断叙事主流程（降级为纯对话）。
 */
class StoryChatController(
    private val bridge: EngineBridge,
    private val client: ChatClient,
    private val settingsRepo: com.sixworlds.mobile.data.SettingsRepository,
    val sessionStore: SessionStore,
    private val engineRuntime: com.sixworlds.mobile.engine.EngineRuntime,
    private val kernelTextLoader: (String) -> String,
    private val notifyCallback: ((String, String) -> Unit)? = null,
) : ViewModel() {

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    private val _streaming = MutableStateFlow("")
    val streaming: StateFlow<String> = _streaming

    private val _engineBusy = MutableStateFlow(false)
    val engineBusy: StateFlow<Boolean> = _engineBusy

    private val _illustBusy = MutableStateFlow(false)
    val illustBusy: StateFlow<Boolean> = _illustBusy

    private val _toast = MutableStateFlow<String?>(null)
    val toast: StateFlow<String?> = _toast

    private val _settings = MutableStateFlow(ChatSettings())
    val settingsFlow: StateFlow<ChatSettings> = _settings

    private val _choices = MutableStateFlow<List<Choice>>(emptyList())
    val choices: StateFlow<List<Choice>> = _choices

    private val _sceneText = MutableStateFlow("")
    val sceneText: StateFlow<String> = _sceneText

    private val _lastUsage = MutableStateFlow<JSONObject?>(null)
    val lastUsage: StateFlow<JSONObject?> = _lastUsage

    private val _wsVersion = MutableStateFlow(0) // 世界集/会话结构变更信号（驱动抽屉刷新）
    val wsVersion: StateFlow<Int> = _wsVersion

    /** 搜索跳转目标（消息下标），ChatScreen 消费后置空 */
    val jumpTarget = MutableStateFlow<Int?>(null)

    private var sessionId: String? = null
    private var protocolText: String? = null

    init {
        viewModelScope.launch {
            _settings.value = settingsRepo.current()
            _messages.value = sessionStore.current().messages.toList()
            refreshChoices()
        }
    }

    fun saveSettings(s: ChatSettings) {
        viewModelScope.launch {
            settingsRepo.save(s)
            _settings.value = settingsRepo.current()
            _toast.value = "已保存"
        }
    }

    fun clearToast() { _toast.value = null }

    // ---- 世界集 / 世界线 ----

    fun currentWorkspace(): Workspace = sessionStore.currentWorkspace()

    fun sessionTitle(): String = sessionStore.current().title

    fun deleteMessageAt(index: Int) {
        val s = sessionStore.current()
        if (index in s.messages.indices) {
            s.messages.removeAt(index)
            sessionStore.persist()
            _messages.value = s.messages.toList()
            refreshChoices()
        }
    }
    fun sessionsOfCurrent(): List<StorySession> = sessionStore.sessionsOf(sessionStore.currentWsId)
    fun sessionsOf(wsId: String): List<StorySession> = sessionStore.sessionsOf(wsId)
    fun workspacesSnapshot(): List<Workspace> = sessionStore.workspaces.toList()
    fun currentWsId(): String = sessionStore.currentWsId
    fun currentSessionId(): String = sessionStore.currentId

    fun switchWorkspace(id: String) {
        if (_busy.value) { showToast("生成中，请稍候"); return }
        sessionStore.switchWorkspace(id)
        sessionId = null
        _messages.value = sessionStore.current().messages.toList()
        refreshChoices()
        bumpWs()
    }

    fun newWorkspace(name: String, kernelFile: String?) {
        sessionStore.newWorkspace(name.ifBlank { "新世界集" }, kernelFile)
        sessionId = null
        _messages.value = emptyList()
        _choices.value = emptyList()
        bumpWs()
    }

    fun renameWorkspace(id: String, name: String) {
        sessionStore.renameWorkspace(id, name)
        bumpWs()
    }

    fun deleteWorkspace(id: String) {
        if (_busy.value) { showToast("生成中，请稍候"); return }
        sessionStore.deleteWorkspace(id)
        sessionId = null
        _messages.value = sessionStore.current().messages.toList()
        refreshChoices()
        bumpWs()
    }

    fun newSession() {
        if (_busy.value) { showToast("生成中，请稍候"); return }
        sessionStore.newSession()
        sessionId = null
        _messages.value = emptyList()
        _choices.value = emptyList()
        bumpWs()
    }

    fun switchSession(id: String) {
        if (_busy.value) { showToast("生成中，请稍候"); return }
        sessionStore.switchTo(id)
        sessionId = null
        _messages.value = sessionStore.current().messages.toList()
        refreshChoices()
        bumpWs()
    }

    fun deleteSession(id: String) {
        if (_busy.value) { showToast("生成中，请稍候"); return }
        sessionStore.remove(id)
        sessionId = null
        _messages.value = sessionStore.current().messages.toList()
        refreshChoices()
        bumpWs()
    }

    fun renameSession(id: String, title: String) {
        val s = sessionStore.sessions.firstOrNull { it.id == id } ?: return
        s.title = title.ifBlank { s.title }
        sessionStore.persist()
        _messages.value = s.messages.toList()
        bumpWs()
    }

    private fun bumpWs() { _wsVersion.value = _wsVersion.value + 1 }

    // ---- 发送 / 停止 / 重生成 / 回溯分叉 ----

    fun send(text: String) {
        val value = text.trim()
        if (_busy.value) return
        if (_engineBusy.value) { showToast("上一回合状态正在补录，请稍候"); return }
        if (value.isEmpty()) return
        val cfg = _settings.value
        if (cfg.baseUrl.isBlank() || cfg.apiKey.isBlank() || cfg.model.isBlank()) {
            showToast("请先在设置中填写 API 地址、密钥与模型。")
            return
        }
        viewModelScope.launch { doSend(value, cfg, appendUser = true) }
    }

    fun stop() { client.cancelCurrent() }

    fun regen() {
        if (_busy.value || _engineBusy.value) return
        viewModelScope.launch {
            val s = sessionStore.current()
            val last = s.messages.lastOrNull() ?: return@launch
            if (last.role != "assistant") return@launch
            s.messages.removeAt(s.messages.size - 1)
            sessionStore.persist()
            _messages.value = s.messages.toList()
            runCatching { bridge.discardTurn(s.id, "regen", last.content.take(400)) }
            val cfg = _settings.value
            if (cfg.baseUrl.isBlank() || cfg.apiKey.isBlank() || cfg.model.isBlank()) {
                showToast("请先在设置中填写 API 地址、密钥与模型。")
                return@launch
            }
            val playerInput = s.messages.lastOrNull { it.role == "user" }?.content ?: ""
            doSend(playerInput, cfg, appendUser = false)
        }
    }

    /** 编辑历史行动 → 丢弃其后全部消息 → 以新行动重新生成（S5 回溯分叉） */
    fun forkFrom(msgIndex: Int, newText: String) {
        if (_busy.value || _engineBusy.value) { showToast("请等待当前回合结束"); return }
        viewModelScope.launch {
            val s = sessionStore.current()
            if (msgIndex !in s.messages.indices || s.messages[msgIndex].role != "user") return@launch
            val removed = s.messages.drop(msgIndex + 1)
            runCatching {
                removed.filter { it.role == "assistant" }.forEach {
                    bridge.discardTurn(s.id, "fork", it.content.take(400))
                }
            }
            val kept = s.messages.subList(0, msgIndex).toMutableList()
            kept.add(ChatMessage("user", newText.trim(), System.currentTimeMillis()))
            s.messages.clear()
            s.messages.addAll(kept)
            s.updatedAt = System.currentTimeMillis()
            sessionStore.persist()
            _messages.value = s.messages.toList()
            _choices.value = emptyList()
            val cfg = _settings.value
            if (cfg.baseUrl.isBlank() || cfg.apiKey.isBlank() || cfg.model.isBlank()) {
                showToast("请先在设置中填写 API 地址、密钥与模型。")
                return@launch
            }
            doSend(newText.trim(), cfg, appendUser = false)
        }
    }

    // ---- 搜索 ----

    fun search(query: String): List<SearchHit> {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        val hits = mutableListOf<SearchHit>()
        sessionStore.current().messages.forEachIndexed { idx, m ->
            val i = m.content.indexOf(q, ignoreCase = true)
            if (i >= 0) {
                hits.add(SearchHit(idx, m.role, m.content, i, i + q.length, m.at))
            }
        }
        return hits
    }

    // ---- 待补录（Pending Commit） ----

    suspend fun pendingsSnapshot(): List<JSONObject> = runCatching {
        val arr = bridge.pendings(sessionStore.current().id)
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }.getOrDefault(emptyList())

    fun discardPending(pendingId: String, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            runCatching { bridge.discardPending(sessionStore.current().id, pendingId) }
            showToast("已丢弃该待补录回合")
            onDone()
        }
    }

    /** 单条补录：静默请求补状态块并 resolvePending（对齐桌面 resolvePendingFlow 的单次循环体） */
    fun resolveSingle(pending: JSONObject, onDone: (Boolean) -> Unit) {
        if (_busy.value) { showToast("请等待当前回合结束"); return }
        viewModelScope.launch {
            val ok = runCatching { resolveOne(pending) }.getOrDefault(false)
            onDone(ok)
        }
    }

    fun resolveAllPendings(onResult: (ok: Int, total: Int) -> Unit) {
        if (_busy.value || _engineBusy.value) { showToast("请等待当前回合结束"); return }
        viewModelScope.launch {
            _busy.value = true
            var okN = 0
            var total = 0
            try {
                val targets = pendingsSnapshot()
                total = targets.size
                if (targets.isEmpty()) { showToast("没有待补录的回合"); return@launch }
                for (pc in targets) {
                    if (runCatching { resolveOne(pc) }.getOrDefault(false)) okN++
                }
            } finally {
                _busy.value = false
                if (total > 0) {
                    _toast.value = if (okN == total) "已补录 $okN 条回合状态" else "补录完成 $okN/$total（其余保持待补录）"
                    onResult(okN, total)
                }
            }
        }
    }

    private suspend fun resolveOne(pc: JSONObject): Boolean {
        val cfg = _settings.value
        val s = sessionStore.current()
        if (protocolText == null) protocolText = bridge.protocol()
        val meta = enginePrep(s, pc.optString("player_input"))
        val msgs = mutableListOf(ChatClient.Message("system", kernelTextLoader(effectiveKernelFile())))
        if (meta != null && meta.block.isNotEmpty()) msgs.add(ChatClient.Message("system", meta.block))
        val proto = protocolText
        if (!proto.isNullOrEmpty()) msgs.add(ChatClient.Message("system", proto))
        msgs.add(ChatClient.Message("user", pc.optString("player_input").ifEmpty { "（玩家行动）" }))
        msgs.add(ChatClient.Message("assistant", pc.optString("narrative")))
        msgs.add(ChatClient.Message("user", PATCH_RETRY_PROMPT))
        val rr = client.send(
            ChatClient.Config(cfg.baseUrl, cfg.apiKey, cfg.model, cfg.thinkLevel),
            msgs, onDelta = {}, silent = true
        )
        if (rr is ChatClient.Result.Ok && rr.content.isNotEmpty()) {
            val rs = bridge.resolvePending(s.id, pc.optString("pending_id"), rr.content)
            return rs.optBoolean("resolved")
        }
        return false
    }

    // ---- 快照 ----

    fun takeSnapshot(onDone: () -> Unit = {}) {
        viewModelScope.launch {
            runCatching {
                ensureExists()
                val snap = bridge.snapshot(sessionStore.current().id, storyLabel())
                _toast.value = "已拍快照：" + (snap.optString("label").ifEmpty { snap.optString("snapshot_id") })
                onDone()
            }.onFailure { _toast.value = "快照失败：${it.message}" }
        }
    }

    fun restoreSnapshot(snapshotId: String, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            runCatching {
                ensureExists()
                bridge.restore(sessionStore.current().id, snapshotId)
                _toast.value = "已恢复快照（此后的叙事保留在历史留痕中）"
            }.onFailure { _toast.value = "恢复失败：${it.message}" }
            onDone()
        }
    }

    suspend fun listSnapshots(): List<JSONObject> = runCatching {
        val arr = bridge.snapshots(sessionStore.current().id)
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }.getOrDefault(emptyList())

    suspend fun turnLogs(): List<JSONObject> = runCatching {
        val arr = bridge.turnLogs(sessionStore.current().id)
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }.getOrDefault(emptyList())

    suspend fun engineOverview(): JSONObject? = runCatching {
        bridge.overview(sessionStore.current().id)
    }.getOrNull()

    suspend fun turnLogIds(): JSONArray = runCatching {
        bridge.turnLogs(sessionStore.current().id)
    }.getOrDefault(JSONArray())

    suspend fun turnLogDetail(turnId: String): JSONObject? = runCatching {
        bridge.turnLog(sessionStore.current().id, turnId)
    }.getOrNull()

    // ---- 模型清单（S6 获取可用模型） ----

    fun fetchModels(onResult: (List<String>?, String?) -> Unit) {
        viewModelScope.launch {
            val cfg = _settings.value
            val (list, err) = client.models(cfg.baseUrl, cfg.apiKey)
            onResult(list, err)
        }
    }

    fun testConnection(onResult: (String) -> Unit) {
        viewModelScope.launch {
            val cfg = _settings.value
            onResult(client.testEndpoint(cfg.baseUrl, cfg.apiKey))
        }
    }

    /** 内核字数（设置页展示） */
    fun kernelWords(file: String): Int = runCatching { kernelTextLoader(file).length }.getOrDefault(0)

    fun toastPublic(msg: String) { _toast.value = msg }

    /** 导出/导入续玩码与配置的原始数据访问（S10 数据页使用） */
    fun sessionSaveCode(): String {
        val s = sessionStore.current()
        return JSONObject()
            .put("type", "sixworlds-savecode")
            .put("v", 1)
            .put("title", s.title)
            .put("messages", JSONArray().apply {
                s.messages.forEach { put(JSONObject().put("role", it.role).put("content", it.content).put("at", it.at)) }
            })
            .toString()
    }

    /** 进度包导入：会话 + 引擎状态 + 引擎重启（桌面 ↔ 移动端接续；兼容旧续玩码） */
    fun importProgress(json: String, onDone: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            val res = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                runCatching {
                    require(json.toByteArray(Charsets.UTF_8).size <= 128 * 1024 * 1024) { "导入文件过大（上限 128MB）" }
                    val obj = JSONObject(json)
                    if (obj.optString("type") == "sixworlds-progress") {
                        val importedSessions = obj.optJSONArray("sessions") ?: org.json.JSONArray()
                        sessionStore.validateProgressSessions(importedSessions)
                        obj.optJSONObject("engine")?.optJSONObject("files")?.let {
                            engineRuntime.importEngineFiles(it)
                        }
                        val n = sessionStore.importProgressSessions(importedSessions)
                        bridge.restartEngine()
                        sessionId = null
                        if (n > 0) "已导入 " + n + " 条世界线（含引擎进度）" else "已导入引擎进度"
                    } else if (importSaveCode(json)) "已导入世界线"
                    else throw IllegalStateException("不是有效的进度包或续玩码")
                }.getOrElse { e -> "导入失败：" + (e.message ?: e.javaClass.simpleName) }
            }
            _messages.value = sessionStore.current().messages.toList()
            refreshChoices()
            onDone(res.startsWith("已导入"), res)
        }
    }

    fun importSaveCode(json: String): Boolean {
        return runCatching {
            val obj = JSONObject(json)
            require(obj.optString("type") == "sixworlds-savecode") { "不是有效的续玩码" }
            val s = sessionStore.newSession()
            s.title = obj.optString("title").ifEmpty { "导入的世界线" }
            obj.optJSONArray("messages")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val mo = arr.optJSONObject(i) ?: continue
                    s.messages.add(ChatMessage(mo.optString("role"), mo.optString("content"), mo.optLong("at")))
                }
            }
            sessionStore.persist()
            _messages.value = s.messages.toList()
            true
        }.getOrDefault(false)
    }

    // ---- 内部流程 ----

    private fun effectiveKernelFile(): String {
        val ws = sessionStore.currentWorkspace()
        return ws.kernelFile ?: _settings.value.kernelFile
    }

    private data class EngineMeta(
        val storyId: String, val sessionId: String, val block: String,
        val retrievedIds: List<String>, val contextSize: Int, val playerInput: String,
    )

    private suspend fun doSend(value: String, cfg: ChatSettings, appendUser: Boolean) {
        val s = sessionStore.current()
        if (appendUser) {
            sessionStore.appendMessage(s, ChatMessage("user", value, System.currentTimeMillis()))
            _messages.value = s.messages.toList()
        }
        _choices.value = emptyList()
        _busy.value = true
        _streaming.value = ""
        try {
            val meta = enginePrep(s, value)
            val msgs = buildMessages(s, meta, cfg)
            // R78 合批：高频率 delta 按 50ms 窗口刷入状态，减少重组压力
            var buf = ""
            var last = 0L
            val r = client.send(
                ChatClient.Config(cfg.baseUrl, cfg.apiKey, cfg.model, cfg.thinkLevel),
                msgs,
                onDelta = { piece ->
                    buf += piece
                    val now = System.currentTimeMillis()
                    if (now - last >= 50) { _streaming.value += buf; buf = ""; last = now }
                },
            )
            if (buf.isNotEmpty()) _streaming.value += buf
            handleResult(s, meta, msgs, r, cfg)
        } catch (e: Exception) {
            showToast("出错了：${e.message ?: e.javaClass.simpleName}")
        } finally {
            _busy.value = false
            _streaming.value = ""
            refreshChoices()
        }
    }

    private suspend fun enginePrep(s: StorySession, playerInput: String): EngineMeta? = runCatching {
        val kernelFile = effectiveKernelFile()
        val kernelText = kernelTextLoader(kernelFile)
        val en = bridge.ensure(s.id, s.title, "builtin:$kernelFile", kernelText)
        if (!en.optBoolean("kernel_match", true)) {
            showToast("注意：世界内核与建线时不一致，引擎记忆可能错位")
        }
        val sid = sessionId ?: ("SES-" + java.lang.Long.toString(System.currentTimeMillis(), 36) + "-" + (1000..9999).random())
            .also { sessionId = it }
        val cx = bridge.context(s.id, playerInput)
        if (protocolText == null) protocolText = bridge.protocol()
        refreshScene()
        val ov = cx.optJSONObject("overview")
        val turn = ov?.optInt("engine_turn") ?: 0
        val ids = mutableListOf<String>()
        cx.optJSONArray("retrieved_ids")?.let { arr ->
            for (i in 0 until arr.length()) ids.add(arr.optString(i))
        }
        EngineMeta(
            storyId = s.id, sessionId = sid,
            block = if (turn > 0) cx.optString("block") else "",
            retrievedIds = ids, contextSize = cx.optInt("context_size"), playerInput = playerInput,
        )
    }.getOrNull()

    private suspend fun refreshScene() {
        runCatching {
            val ov = bridge.overview(sessionStore.current().id) ?: return@runCatching
            val scene = ov.optJSONObject("scene")
            _sceneText.value = if (scene != null) {
                listOf(
                    scene.optString("game_time"), scene.optString("location"),
                    scene.optJSONArray("participants")?.let { arr ->
                        (0 until arr.length()).mapNotNull { arr.optString(it).ifBlank { null } }.joinToString("、")
                    } ?: "",
                ).filter { it.isNotBlank() }.joinToString(" · ")
            } else ""
        }
    }

    private fun buildMessages(s: StorySession, meta: EngineMeta?, cfg: ChatSettings): List<ChatClient.Message> {
        val out = mutableListOf(ChatClient.Message("system", kernelTextLoader(effectiveKernelFile())))
        if (meta != null && meta.block.isNotEmpty()) out.add(ChatClient.Message("system", meta.block))
        val proto = protocolText
        if (meta != null && !proto.isNullOrEmpty()) out.add(ChatClient.Message("system", proto))
        for (m in s.messages.takeLast(cfg.ctxCount.coerceIn(2, 64))) out.add(ChatClient.Message(m.role, m.content))
        return out
    }

    private suspend fun handleResult(
        s: StorySession, meta: EngineMeta?, msgs: List<ChatClient.Message>, r: ChatClient.Result, cfg: ChatSettings,
    ) {
        if (r is ChatClient.Result.Ok && r.content.isNotEmpty()) {
            var narrative = r.content
            var pendingId: String? = null
            var pendingKept = false
            if (meta != null) {
                runCatching {
                    val commitBase = JSONObject()
                        .put("storyId", meta.storyId)
                        .put("sessionId", meta.sessionId)
                        .put("playerInput", meta.playerInput)
                        .put("intent", meta.playerInput.take(200))
                        .put("model", cfg.model)
                        .put("retrievedIds", JSONArray(meta.retrievedIds))
                        .put("contextSize", meta.contextSize)
                    val cm = bridge.commit(commitBase.put("raw", r.content).put("retryCount", 0))
                    cm.optStr("narrative")?.let { if (it.isNotEmpty()) narrative = it }
                    pendingId = cm.optStr("pending_id")
                    val status = cm.optString("patch_status")
                    if (!cm.optBoolean("committed") && (status == "PATCH_MISSING" || status == "PATCH_INVALID")) {
                        _engineBusy.value = true
                        try {
                            val retryMsgs = msgs +
                                ChatClient.Message("assistant", narrative) +
                                ChatClient.Message("user", PATCH_RETRY_PROMPT)
                            val rr = client.send(
                                ChatClient.Config(cfg.baseUrl, cfg.apiKey, cfg.model, cfg.thinkLevel),
                                retryMsgs, onDelta = {}, silent = true
                            )
                            if (rr is ChatClient.Result.Ok && rr.content.isNotEmpty()) {
                                val cm2 = bridge.commit(
                                    commitBase
                                        .put("raw", rr.content)
                                        .put("pendingId", pendingId ?: JSONObject.NULL)
                                        .put("retryCount", 1)
                                )
                                if (cm2.optBoolean("committed")) {
                                    _toast.value = "状态已补录（模型首轮缺状态块）"
                                } else {
                                    pendingKept = cm2.optStr("pending_id") != null || pendingId != null
                                }
                            } else {
                                pendingKept = pendingId != null
                            }
                        } finally {
                            _engineBusy.value = false
                        }
                    } else if (!cm.optBoolean("committed") && pendingId != null) {
                        pendingKept = true
                    }
                    if (!cm.optBoolean("committed") && !pendingKept) {
                        val errors = cm.optJSONArray("errors")
                        if (errors != null && errors.length() > 0) {
                            _toast.value = "状态记录未提交：" + (errors.optJSONObject(0)?.optString("message") ?: "未知错误")
                        }
                    }
                    refreshScene()
                }
            }
            if (pendingKept) _toast.value = "本回合状态未正式提交，已记录待补录（重启不丢失）"
            sessionStore.appendMessage(s, ChatMessage("assistant", narrative, System.currentTimeMillis(), pendingKept))
            if (s.title == "新世界线") s.title = deriveTitle(narrative)
            sessionStore.persist()
            _messages.value = s.messages.toList()
            if (r.aborted) showToast(if (r.partial) "网络中断，已保留部分内容" else "已停止生成（保留已生成内容）")
            autoGenerateIllust(narrative)
            notifyCallback?.invoke(s.title, "叙事已生成")
        } else if (r is ChatClient.Result.Ok) {
            showToast("已停止生成")
        } else {
            showToast((r as ChatClient.Result.Err).message)
        }
    }

    /** 演示数据：凛冬神殿场景（仅内存） */
    fun fillDemo() {
        if (_busy.value) return
        _sceneText.value = "凛冬神殿 · 中殿祭坛"
        val narrative = listOf(
            "寒光如利刃切开你的掌心——不，那是错觉。纹章石触感冰凉却不刺骨，像是握住了一块凝固的月光。",
            "",
            "祭坛上的浮雕在你指尖触碰的刹那缓缓亮起，古老的凛冬文字以蓝白双色交织燃烧，仿佛整座神殿正在从沉眠中苏醒。那刻入石心的誓约，已沉睡三百年。",
            "",
            "「终于……」",
            "",
            "身后传来阿尔维斯的低语，靴子踩过碎石发出细微声响。老骑士已放下了剑，在此刻选择了下跪。",
            "",
            "【守誓者支线已触发】纹章真正的持有人须在三个昼夜内抵达霜冠峰顶，否则纹章将归还虚空。",
            "",
            "【你需要决定】",
            "【A】即刻出发——三天时间不容浪费，命令阿尔维斯备马",
            "【B】先询问阿尔维斯关于霜冠峰的路线与危险",
            "【C】检视纹章石，尝试感知其中封存的魔力与记忆",
            "【D】环顾神殿四周，确认是否还有其他线索",
            "",
            "【简要状态】",
            "体力 68/100 · 威望 ★★★☆☆ · 阿尔维斯好感度：高",
        ).joinToString("\n")
        _messages.value = listOf(
            ChatMessage("user", "我沿着石阶缓步走向祭坛，双手展开，准备捧起那枚散发寒光的纹章石。", 0),
            ChatMessage("assistant", narrative, 0, illustLabel = "插图 · 凛冬神殿"),
        )
        refreshChoices()
    }

    /** 从叙事正文提炼插图提示词（对齐桌面 buildIllustPrompt：去选项/状态，取叙事主体） */
    private fun buildIllustPrompt(text: String, settings: ChatSettings): String {
        var t = text
        t = t.replace(Regex("【[^】*]*】[^【]*"), " ").replace(Regex("【[^】]*】"), " ")
        t = t.replace(Regex("\\s+"), " ").trim()
        if (t.isEmpty()) t = text.take(300)
        if (t.length > 600) t = t.take(600)
        val prefix = if (settings.illust.prefixEnable) settings.illust.prefix + " " else ""
        return (prefix + t).take(800)
    }

    /** 生成指定消息的插图 */
    fun generateIllustFor(msgIndex: Int) {
        if (_busy.value || _illustBusy.value) return
        viewModelScope.launch {
            _illustBusy.value = true
            try {
                val s = sessionStore.current()
                if (msgIndex !in s.messages.indices) return@launch
                val msg = s.messages[msgIndex]
                val cfg = _settings.value
                val prompt = buildIllustPrompt(msg.content, cfg)
                val (url, err) = client.generateImage(
                    cfg.illust.baseUrl.ifBlank { cfg.baseUrl },
                    cfg.illust.apiKey.ifBlank { cfg.apiKey },
                    cfg.illust.model, prompt,
                    cfg.illust.size, cfg.illust.negative
                )
                if (url != null) {
                    // dataUrl 直接存储；远程 URL 先下载转 dataUrl
                    val dataUrl = if (url.startsWith("data:")) url
                    else client.fetchAsDataUrl(url) ?: url
                    s.messages[msgIndex] = s.messages[msgIndex].copy(illustDataUrl = dataUrl)
                    sessionStore.persist()
                    _messages.value = s.messages.toList()
                    _toast.value = "插图已生成"
                } else {
                    _toast.value = "插图生成失败：${err ?: "未知错误"}"
                }
            } finally {
                _illustBusy.value = false
            }
        }
    }

    /** 提交成功后自动生成插图（如果启用） */
    private fun autoGenerateIllust(narrative: String) {
        val cfg = _settings.value
        if (!cfg.illust.enabled || !cfg.illust.auto) return
        if (narrative.length < cfg.illust.minLen) return
        viewModelScope.launch {
            _illustBusy.value = true
            try {
                val prompt = buildIllustPrompt(narrative, cfg)
                val size = cfg.illust.size.ifBlank { "1344x768" }
                val (url, err) = client.generateImage(
                    cfg.illust.baseUrl.ifBlank { cfg.baseUrl },
                    cfg.illust.apiKey.ifBlank { cfg.apiKey },
                    cfg.illust.model, prompt, size, cfg.illust.negative
                )
                if (url != null) {
                    val dataUrl = if (url.startsWith("data:")) url
                    else client.fetchAsDataUrl(url) ?: return@launch
                    val idx = sessionStore.current().messages.indexOfLast { it.role == "assistant" }
                    if (idx >= 0) {
                        sessionStore.current().messages[idx] =
                            sessionStore.current().messages[idx].copy(illustDataUrl = dataUrl)
                        sessionStore.persist()
                        _messages.value = sessionStore.current().messages.toList()
                    }
                }
            } finally { _illustBusy.value = false }
        }
    }

    private fun refreshChoices() {
        val last = _messages.value.lastOrNull()
        _choices.value = if (last != null && last.role == "assistant") {
            val parsed = parseChoices(last.content)
            if (parsed.isNotEmpty()) parsed else extractQuoteChoices(last.content).map { Choice("", it) }
        } else emptyList()
    }

    /** 会话标题取自首轮叙事：先剥离状态块/【标记】/markdown 记号，避免标题出现「【你需要决定】#…」 */
    private fun deriveTitle(narrative: String): String =
        narrative
            .substringBefore("<<<")
            .replace(Regex("【[^】]*】"), " ")
            .replace(Regex("[#*>`]"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(24)
            .ifEmpty { "新世界线" }

    private fun storyLabel(): String = sessionStore.current().title.ifEmpty { "世界线" }

    /** 确保引擎故事已创建（演示模式/新会话直接拍快照时补建） */
    private suspend fun ensureExists() {
        val s = sessionStore.current()
        bridge.ensure(s.id, s.title, "builtin:" + effectiveKernelFile(), kernelTextLoader(effectiveKernelFile()))
    }

    private fun showToast(msg: String) { _toast.value = msg }

    private fun JSONObject.optStr(key: String): String? =
        if (has(key) && !isNull(key)) getString(key) else null

    companion object {
        private val PATCH_RETRY_PROMPT = listOf(
            "上一轮叙事已经生成。当前系统缺少合法 State Patch。",
            "请仅根据已经生成的叙事和当前 State，输出对应的结构化 State Patch（按此前给你的状态记录协议）。",
            "不要重新生成剧情。不要修改、扩写或复述已经生成的叙事。回复只包含状态块本身。",
            "如果重新审视后确认这一回合确实没有任何状态变化，只输出 <<<NO_STATE_CHANGE>>>。"
        ).joinToString("\n")
    }
}
