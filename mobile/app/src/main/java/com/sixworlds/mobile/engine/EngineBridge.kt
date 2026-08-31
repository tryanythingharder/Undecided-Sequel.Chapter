package com.sixworlds.mobile.engine

import org.json.JSONArray
import org.json.JSONObject

/** 引擎调用失败（引擎内部错误会经 envelope 的 ok:false 传回）。 */
class EngineException(message: String) : RuntimeException(message)

/**
 * 故事状态引擎的 Kotlin 门面 —— API 面逐条对齐桌面 main.cjs 的 ipcMain.handle，
 * 玩家路径一律 PLAYER 级别（条款 6/7/8，钳制在 JS 桥内完成）。
 */
class EngineBridge(private val runtime: EngineRuntime) {

    private suspend fun envelope(name: String, payload: JSONObject): JSONObject {
        val res = runtime.call(name, payload)
        if (!res.optBoolean("ok")) throw EngineException(res.optString("error", "引擎调用失败：$name"))
        return res
    }

    private suspend fun dataObj(name: String, payload: JSONObject): JSONObject? {
        val d = envelope(name, payload).opt("data")
        return if (d == null || d == JSONObject.NULL) null else d as? JSONObject
    }

    private suspend fun dataArr(name: String, payload: JSONObject): JSONArray {
        val d = envelope(name, payload).opt("data")
        return (d as? JSONArray) ?: JSONArray()
    }

    suspend fun restartEngine() = runtime.restart()

    suspend fun ensure(storyId: String, title: String, kernelId: String, kernelText: String): JSONObject =
        dataObj(
            "ensure",
            JSONObject()
                .put("storyId", storyId).put("title", title)
                .put("kernelId", kernelId).put("kernelText", kernelText)
        ) ?: JSONObject()

    suspend fun context(storyId: String, playerInput: String): JSONObject =
        dataObj("context", JSONObject().put("storyId", storyId).put("playerInput", playerInput)) ?: JSONObject()

    /** payload 需含 storyId/sessionId/playerInput/intent/model/raw/retrievedIds/contextSize/retryCount[/pendingId]。 */
    suspend fun commit(payload: JSONObject): JSONObject = dataObj("commit", payload) ?: JSONObject()

    suspend fun protocol(): String {
        val d = envelope("protocol", JSONObject()).opt("data")
        return d?.toString() ?: ""
    }

    suspend fun overview(storyId: String): JSONObject? =
        dataObj("overview", JSONObject().put("storyId", storyId))

    suspend fun snapshot(storyId: String, label: String): JSONObject =
        dataObj("snapshot", JSONObject().put("storyId", storyId).put("label", label)) ?: JSONObject()

    suspend fun snapshots(storyId: String): JSONArray =
        dataArr("snapshots", JSONObject().put("storyId", storyId))

    suspend fun restore(storyId: String, snapshotId: String): JSONObject =
        dataObj("restore", JSONObject().put("storyId", storyId).put("snapshotId", snapshotId)) ?: JSONObject()

    suspend fun pendings(storyId: String): JSONArray =
        dataArr("pendings", JSONObject().put("storyId", storyId))

    suspend fun turnLogs(storyId: String): JSONArray =
        dataArr("logs", JSONObject().put("storyId", storyId))

    suspend fun turnLog(storyId: String, turnId: String): JSONObject? =
        dataObj("log", JSONObject().put("storyId", storyId).put("turnId", turnId))

    suspend fun resolvePending(storyId: String, pendingId: String, raw: String): JSONObject =
        dataObj(
            "resolvePending",
            JSONObject().put("storyId", storyId).put("pendingId", pendingId).put("raw", raw)
        ) ?: JSONObject()

    suspend fun discardPending(storyId: String, pendingId: String): JSONObject =
        dataObj(
            "discardPending",
            JSONObject().put("storyId", storyId).put("pendingId", pendingId)
        ) ?: JSONObject()

    suspend fun discardTurn(storyId: String, reason: String, excerpt: String): JSONObject =
        dataObj(
            "discardTurn",
            JSONObject().put("storyId", storyId).put("reason", reason).put("excerpt", excerpt)
        ) ?: JSONObject()
}
