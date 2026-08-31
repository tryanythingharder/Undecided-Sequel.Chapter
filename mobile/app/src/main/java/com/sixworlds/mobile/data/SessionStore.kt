package com.sixworlds.mobile.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class ChatMessage(
    val role: String,
    val content: String,
    val at: Long,
    val pending: Boolean = false,
    val illustLabel: String = "",
    val illustDataUrl: String = "",
)

data class StorySession(
    val id: String,
    val wsId: String,
    var title: String,
    val createdAt: Long,
    var updatedAt: Long,
    val messages: MutableList<ChatMessage>,
)

/** 世界集（工作区）：绑定内核，会话完全隔离 */
data class Workspace(val id: String, var name: String, var kernelFile: String?, val createdAt: Long)

/**
 * 世界集 → 世界线 两级持久化（对照桌面 workspaces.v1 + sessions）。
 * 单文件 JSON + 原子写；旧版无世界集结构时自动迁移进「默认世界」。
 */
class SessionStore(context: Context) {

    private val file: File = File(context.filesDir, "sessions.json")
    val workspaces: MutableList<Workspace> = mutableListOf()
    val sessions: MutableList<StorySession> = mutableListOf()
    var currentWsId: String = ""
        private set
    var currentId: String = ""
        private set

    init {
        runCatching { restoreFromDisk() }
        if (workspaces.isEmpty()) {
            workspaces.add(Workspace("w" + java.lang.Long.toString(System.currentTimeMillis(), 36), "默认世界", null, System.currentTimeMillis()))
        }
        if (currentWsId.isEmpty() || workspaces.none { it.id == currentWsId }) currentWsId = workspaces.first().id
        if (sessions.isEmpty()) newSession()
        if (sessions.none { it.id == currentId }) currentId = sessionsOf(currentWsId).firstOrNull()?.id ?: newSession().id
    }

    // ---- 查询 ----

    fun current(): StorySession = sessions.firstOrNull { it.id == currentId } ?: sessions.first()

    /** 进度包导入：保留桌面端原始 id（与引擎故事文件对应）；返回导入条数 */
    fun importProgressSessions(arr: org.json.JSONArray): Int {
        var n = 0
        for (i in 0 until arr.length()) {
            val so = arr.optJSONObject(i) ?: continue
            var id = so.optString("id").ifBlank { "WS-" + java.lang.Long.toString(System.currentTimeMillis(), 36) + "-" + (100..999).random() }
            while (sessions.any { it.id == id }) id += "-" + (10..99).random()
            val msgs = mutableListOf<ChatMessage>()
            so.optJSONArray("messages")?.let { ma ->
                for (j in 0 until ma.length()) {
                    val mo = ma.optJSONObject(j) ?: continue
                    msgs.add(ChatMessage(mo.optString("role"), mo.optString("content"), mo.optLong("at", System.currentTimeMillis())))
                }
            }
            sessions.add(
                0,
                StorySession(
                    id = id, wsId = currentWsId,
                    title = so.optString("title").ifEmpty { "导入的世界线" },
                    createdAt = so.optLong("createdAt", System.currentTimeMillis()),
                    updatedAt = so.optLong("updatedAt", System.currentTimeMillis()),
                    messages = msgs,
                ),
            )
            currentId = id
            n++
        }
        persist()
        return n
    }
    fun currentWorkspace(): Workspace = workspaces.firstOrNull { it.id == currentWsId } ?: workspaces.first()
    fun sessionsOf(wsId: String): List<StorySession> =
        sessions.filter { it.wsId == wsId }.sortedByDescending { it.updatedAt }

    // ---- 世界集 ----

    fun switchWorkspace(id: String) {
        if (workspaces.none { it.id == id }) return
        currentWsId = id
        val first = sessionsOf(id).firstOrNull()
        if (first != null) currentId = first.id else newSession()
        persist()
    }

    fun newWorkspace(name: String, kernelFile: String?): Workspace {
        val w = Workspace("w" + java.lang.Long.toString(System.currentTimeMillis(), 36) + "-" + (100..999).random(), name, kernelFile, System.currentTimeMillis())
        workspaces.add(w)
        currentWsId = w.id
        newSession()
        return w
    }

    fun renameWorkspace(id: String, name: String) {
        workspaces.firstOrNull { it.id == id }?.name = name.ifBlank { "未命名世界集" }
        persist()
    }

    fun setWorkspaceKernel(id: String, kernelFile: String?) {
        workspaces.firstOrNull { it.id == id }?.kernelFile = kernelFile
        persist()
    }

    fun deleteWorkspace(id: String) {
        sessions.removeAll { it.wsId == id }
        workspaces.removeAll { it.id == id }
        if (workspaces.isEmpty()) {
            workspaces.add(Workspace("w" + System.currentTimeMillis().toString(36), "默认世界", null, System.currentTimeMillis()))
        }
        if (currentWsId == id || workspaces.none { it.id == currentWsId }) {
            currentWsId = workspaces.first().id
            val first = sessionsOf(currentWsId).firstOrNull()
            currentId = first?.id ?: newSession().id
        }
        persist()
    }

    // ---- 世界线 ----

    fun newSession(): StorySession {
        val now = System.currentTimeMillis()
        val s = StorySession(
            id = "WS-" + java.lang.Long.toString(now, 36) + "-" + (100..999).random(),
            wsId = currentWsId,
            title = "新世界线",
            createdAt = now,
            updatedAt = now,
            messages = mutableListOf(),
        )
        sessions.add(0, s)
        currentId = s.id
        persist()
        return s
    }

    fun switchTo(id: String) {
        if (sessions.none { it.id == id }) return
        currentId = id
        sessions.firstOrNull { it.id == id }?.let { currentWsId = it.wsId }
        persist()
    }

    fun remove(id: String) {
        sessions.removeAll { it.id == id }
        if (sessions.isEmpty()) {
            newSession()
            return
        }
        if (currentId == id) {
            currentId = sessionsOf(currentWsId).firstOrNull()?.id ?: sessions.first().id
        }
        persist()
    }

    fun appendMessage(session: StorySession, m: ChatMessage) {
        session.messages.add(m)
        session.updatedAt = System.currentTimeMillis()
        persist()
    }

    fun persist() = runCatching { atomicWrite() }

    // ---- 序列化 ----

    private fun atomicWrite() {
        val tmp = File(file.parentFile, file.name + ".tmp" + System.currentTimeMillis())
        tmp.writeText(toJson(), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.writeText(toJson(), Charsets.UTF_8)
            tmp.delete()
        }
    }

    private fun toJson(): String {
        val wsArr = JSONArray()
        for (w in workspaces) {
            wsArr.put(
                JSONObject()
                    .put("id", w.id).put("name", w.name)
                    .put("kernelFile", w.kernelFile ?: JSONObject.NULL)
                    .put("createdAt", w.createdAt)
            )
        }
        val sArr = JSONArray()
        for (s in sessions) {
            val msgs = JSONArray()
            for (m in s.messages) {
                msgs.put(
                    JSONObject()
                        .put("role", m.role).put("content", m.content)
                        .put("at", m.at).put("pending", m.pending).put("illustLabel", m.illustLabel).put("illustDataUrl", m.illustDataUrl)
                )
            }
            sArr.put(
                JSONObject()
                    .put("id", s.id).put("wsId", s.wsId).put("title", s.title)
                    .put("createdAt", s.createdAt).put("updatedAt", s.updatedAt)
                    .put("messages", msgs)
            )
        }
        return JSONObject()
            .put("v", 2)
            .put("currentWsId", currentWsId)
            .put("workspaces", wsArr)
            .put("currentId", currentId)
            .put("sessions", sArr)
            .toString()
    }

    private fun restoreFromDisk() {
        if (!file.exists()) return
        val obj = JSONObject(file.readText(Charsets.UTF_8))
        currentWsId = obj.optString("currentWsId")
        currentId = obj.optString("currentId")
        obj.optJSONArray("workspaces")?.let { arr ->
            for (i in 0 until arr.length()) {
                val w = arr.optJSONObject(i) ?: continue
                workspaces.add(
                    Workspace(
                        w.optString("id"), w.optString("name"),
                        if (w.isNull("kernelFile")) null else w.optString("kernelFile"),
                        w.optLong("createdAt"),
                    )
                )
            }
        }
        val legacy = obj.optJSONArray("sessions") != null && workspaces.isEmpty()
        obj.optJSONArray("sessions")?.let { arr ->
            for (i in 0 until arr.length()) {
                val so = arr.optJSONObject(i) ?: continue
                val msgs = mutableListOf<ChatMessage>()
                so.optJSONArray("messages")?.let { ma ->
                    for (j in 0 until ma.length()) {
                        val mo = ma.optJSONObject(j) ?: continue
                        msgs.add(
                            ChatMessage(
                                role = mo.optString("role"),
                                content = mo.optString("content"),
                                at = mo.optLong("at"),
                                pending = mo.optBoolean("pending"),
                                illustLabel = mo.optString("illustLabel"),
                                illustDataUrl = mo.optString("illustDataUrl"),
                            )
                        )
                    }
                }
                sessions.add(
                    StorySession(
                        id = so.optString("id"),
                        wsId = if (so.has("wsId")) so.optString("wsId") else (workspaces.firstOrNull()?.id ?: ""),
                        title = so.optString("title"),
                        createdAt = so.optLong("createdAt", so.optLong("at")),
                        updatedAt = so.optLong("updatedAt", so.optLong("at")),
                        messages = msgs,
                    )
                )
            }
        }
        if (sessions.any { it.wsId.isEmpty() || workspaces.none { w -> w.id == it.wsId } }) {
            val fallbackWs = workspaces.first().id
            val fixed = sessions.map { s ->
                if (s.wsId.isEmpty() || workspaces.none { w -> w.id == s.wsId })
                    StorySession(s.id, fallbackWs, s.title, s.createdAt, s.updatedAt, s.messages)
                else s
            }
            sessions.clear()
            sessions.addAll(fixed)
        }
    }

    private fun StorySession.sessionFixWs(wsId: String) {
        // 旧档迁移：StorySession 的 wsId 为 val，借助重建（仅迁移路径使用）
        val fixed = StorySession(id, wsId, title, createdAt, updatedAt, messages)
        val idx = sessions.indexOf(this)
        if (idx >= 0) sessions[idx] = fixed
    }
}
