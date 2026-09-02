package com.sixworlds.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * OpenAI 兼容 chat/completions 流式客户端 —— 行为对齐桌面 main.cjs 的 chat:send：
 * 流式优先（SSE 逐行解析 delta.content）、非流式自动降级、reasoning_effort 不被支持时
 * 去参重试一次、中途取消/断流保留已生成部分。
 */
class ChatClient {

    data class Config(val baseUrl: String, val apiKey: String, val model: String, val thinkLevel: String = "default")
    data class Message(val role: String, val content: String)

    sealed class Result {
        /** aborted=true：用户停止或断流；partial=true：断流但已保留部分文本。 */
        data class Ok(val content: String, val usage: JSONObject?, val aborted: Boolean, val partial: Boolean) : Result()
        data class Err(val message: String) : Result()
    }

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(240, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var currentCall: Call? = null

    fun cancelCurrent() {
        runCatching { currentCall?.cancel() }
    }

    suspend fun send(cfg: Config, messages: List<Message>, onDelta: (String) -> Unit, silent: Boolean = false): Result =
        withContext(Dispatchers.IO) {
            val wantReasoning = cfg.thinkLevel == "low" || cfg.thinkLevel == "medium" || cfg.thinkLevel == "high"
            var result = runOnce(cfg, messages, onDelta, silent, if (wantReasoning) cfg.thinkLevel else null)
            if (result is Result.Err && wantReasoning) {
                val hit = Regex("reasoning|thinking|unsupported|not support|invalid|unknown|extra_forbidden|unrecognized|unexpected.?field|not.?allowed", RegexOption.IGNORE_CASE)
                    .containsMatchIn(result.message)
                if (hit) result = runOnce(cfg, messages, onDelta, silent, null)
            }
            result
        }

    /** 拉取端点可用模型清单（GET /models）。返回 (清单, 错误信息)。 */
    suspend fun models(baseUrlRaw: String, apiKey: String): Pair<List<String>, String?> = withContext(Dispatchers.IO) {
        val baseUrl = baseUrlRaw.trim().trimEnd('/')
        if (baseUrl.isEmpty() || apiKey.isBlank()) return@withContext Pair(emptyList(), "地址与密钥不能为空")
        return@withContext try {
            val req = Request.Builder().url("$baseUrl/models")
                .header("Authorization", "Bearer $apiKey").build()
            val call = client.newCall(req)
            currentCall = call
            call.execute().use { resp ->
                val body = resp.body.string()
                if (!resp.isSuccessful) {
                    Pair(emptyList(), "HTTP ${resp.code} ${body.take(200)}")
                } else {
                    val arr = runCatching { JSONObject(body).optJSONArray("data") }.getOrNull()
                    val list = arr?.let { a ->
                        (0 until a.length()).mapNotNull { a.optJSONObject(it)?.optString("id")?.ifBlank { null } }
                    } ?: emptyList()
                    Pair(list, null)
                }
            }
        } catch (e: Exception) {
            Pair(emptyList(), friendlyError(e.message ?: e.javaClass.simpleName))
        }
    }

    /** 图像生成：POST images/generations，返回 (dataUrl, null) 或 (null, error)。 */
    suspend fun generateImage(
        baseUrlRaw: String, apiKey: String, model: String,
        prompt: String, size: String, negative: String = "", quality: String = ""
    ): Pair<String?, String?> = withContext(Dispatchers.IO) {
        val baseUrl = baseUrlRaw.trim().trimEnd('/')
        if (baseUrl.isEmpty() || apiKey.isBlank() || model.isBlank() || prompt.isBlank())
            return@withContext Pair(null, "地址/密钥/模型/提示词不能为空")
        val payload = JSONObject().put("model", model).put("prompt", prompt).put("size", size)
        if (negative.isNotBlank()) payload.put("negative_prompt", negative)
        if (quality.isNotBlank() && quality != "标准") payload.put("quality", quality)
        try {
            val req = Request.Builder().url("$baseUrl/images/generations")
                .header("Authorization", "Bearer $apiKey")
                .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()
            val call = client.newCall(req); currentCall = call
            call.execute().use { resp ->
                val body = resp.body.string()
                if (!resp.isSuccessful) return@withContext Pair(null, friendlyError("HTTP ${resp.code} ${body.take(300)}"))
                val item = runCatching { JSONObject(body).optJSONArray("data")?.optJSONObject(0) }.getOrNull()
                    ?: return@withContext Pair(null, "响应无图像数据")
                val b64 = item.optString("b64_json", "")
                if (b64.isNotBlank()) return@withContext Pair("data:image/png;base64,$b64", null)
                val url = item.optString("url", "")
                if (url.isNotBlank()) return@withContext Pair(url, null)
                Pair(null, "响应缺少 b64_json 和 url")
            }
        } catch (e: Exception) {
            Pair(null, friendlyError(e.message ?: e.javaClass.simpleName))
        }
    }

    /** 下载远程图片转 dataUrl。 */
    suspend fun fetchAsDataUrl(url: String): String? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url(url).build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                val bytes = resp.body.bytes()
                val mime = resp.header("Content-Type") ?: "image/png"
                "data:$mime;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            }
        }.getOrNull()
    }

    /** 端点连通性测试：GET {baseUrl}/models（低成本，不消耗 token）。 */
    suspend fun testEndpoint(baseUrlRaw: String, apiKey: String): String = withContext(Dispatchers.IO) {
        val baseUrl = baseUrlRaw.trim().trimEnd('/')
        if (baseUrl.isEmpty() || apiKey.isBlank()) return@withContext "地址与密钥不能为空"
        return@withContext try {
            val req = Request.Builder().url("$baseUrl/models")
                .header("Authorization", "Bearer $apiKey").build()
            val call = client.newCall(req)
            currentCall = call
            call.execute().use { resp ->
                val body = resp.body.string()
                if (!resp.isSuccessful) {
                    val msg = runCatching { JSONObject(body).optJSONObject("error")?.optString("message") }.getOrNull()
                    "HTTP ${resp.code}" + (if (!msg.isNullOrBlank()) " · $msg" else "") + " " + body.take(120)
                } else {
                    val models = runCatching { JSONObject(body).optJSONArray("data") }.getOrNull()
                    val count = models?.length() ?: 0
                    "连接成功，发现 $count 个可用模型"
                }
            }
        } catch (e: Exception) {
            friendlyError(e.message ?: e.javaClass.simpleName)
        }
    }

    private fun runOnce(cfg: Config, messages: List<Message>, onDelta: (String) -> Unit, silent: Boolean, reasoningEffort: String?): Result {
        val baseUrl = cfg.baseUrl.trim().trimEnd('/')
        if (baseUrl.isEmpty() || cfg.apiKey.isBlank() || cfg.model.isBlank()) {
            return Result.Err("请先在设置中填写 API 地址、密钥与模型。")
        }
        val payload = JSONObject()
            .put("model", cfg.model)
            .put(
                "messages",
                JSONArray().apply {
                    for (m in messages) put(JSONObject().put("role", m.role).put("content", m.content))
                }
            )
            .put("stream", true)
            .put("stream_options", JSONObject().put("include_usage", true))
        if (reasoningEffort != null) payload.put("reasoning_effort", reasoningEffort)

        var call: Call? = null
        try {
            val request = Request.Builder()
                .url("$baseUrl/chat/completions")
                .header("Authorization", "Bearer ${cfg.apiKey}")
                .header("Accept", "text/event-stream")
                .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()
            call = client.newCall(request)
            currentCall = call
            val response = call.execute()
            response.use { resp ->
                val ctype = resp.header("Content-Type") ?: ""
                if (!ctype.contains("text/event-stream")) {
                    // 非流式响应：按普通 JSON 处理
                    val body = resp.body.string()
                    val data = runCatching { JSONObject(body) }.getOrNull()
                    if (!resp.isSuccessful) {
                        val errObj = data?.optJSONObject("error")
                        val raw = errObj?.toString() ?: "HTTP ${resp.code} ${body.take(400)}"
                        return Result.Err(friendlyError(raw))
                    }
                    val msgObj = data?.optJSONArray("choices")?.optJSONObject(0)
                        ?.optJSONObject("message")
                    val content = if (msgObj != null && !msgObj.isNull("content"))
                        msgObj.optString("content") else ""
                    return Result.Ok(content, data?.optJSONObject("usage"), aborted = false, partial = false)
                }
                if (!resp.isSuccessful) {
                    val body = resp.body.string()
                    return Result.Err(friendlyError("HTTP ${resp.code} ${body.take(400)}"))
                }

                // 流式：逐行解析 SSE
                val source = resp.body.source()
                val full = StringBuilder()
                var usage: JSONObject? = null
                try {
                    while (true) {
                        val line = source.readUtf8Line() ?: break
                        val s = line.trim()
                        if (!s.startsWith("data:")) continue
                        val chunk = s.substring(5).trim()
                        if (chunk.isEmpty() || chunk == "[DONE]") continue
                        val j = runCatching { JSONObject(chunk) }.getOrNull() ?: continue
                        val deltaObj = j.optJSONArray("choices")?.optJSONObject(0)
                            ?.optJSONObject("delta")
                        val piece = if (deltaObj != null && !deltaObj.isNull("content"))
                            deltaObj.optString("content") else null
                        if (!piece.isNullOrEmpty()) {
                            full.append(piece)
                            if (!silent) onDelta(piece)
                        }
                        j.optJSONObject("usage")?.let { usage = it }
                    }
                } catch (e: IOException) {
                    // 取消（停止生成）→ 保留已生成内容；断流且有部分文本 → 标记 partial
                    return when {
                        call.isCanceled() -> Result.Ok(full.toString(), usage, aborted = true, partial = false)
                        full.isNotEmpty() -> Result.Ok(full.toString(), usage, aborted = true, partial = true)
                        else -> Result.Err(friendlyError(e.message ?: "网络错误"))
                    }
                }
                if (full.isEmpty()) return Result.Err("流式响应中没有收到文本内容")
                return Result.Ok(full.toString(), usage, aborted = false, partial = false)
            }
        } catch (e: Exception) {
            if (call?.isCanceled() == true) return Result.Ok("", null, aborted = true, partial = false)
            return Result.Err(friendlyError(e.message ?: e.javaClass.simpleName))
        }
    }

    /** 常见网络/HTTP 错误 → 中文提示（对齐桌面 friendlyError）。 */
    private fun friendlyError(msg: String): String {
        val m = msg.lowercase()
        return when {
            "abort" in m -> "请求被中止"
            "timeout" in m || "timed out" in m -> "连接超时：服务器没有及时响应，请检查网络或稍后重试"
            "connection refused" in m || "econnrefused" in m -> "无法连接到服务器：请检查 API 地址是否正确、服务是否在线"
            "enotfound" in m || "getaddrinfo" in m || "unable to resolve" in m -> "域名解析失败：请检查 API 地址拼写"
            "connection reset" in m || "econnreset" in m || "socket hang up" in m || "broken pipe" in m -> "网络连接中断：请稍后重试"
            "certificate" in m || "ssl" in m || "tls" in m -> "证书校验失败：请检查 API 地址是否为有效 https 站点"
            "401" in m || "unauthorized" in m -> "鉴权失败（401）：请检查 API 密钥是否正确"
            "403" in m || "forbidden" in m -> "无权限（403）：该密钥无权访问此模型或端点"
            "404" in m || "not found" in m -> "接口不存在（404）：请检查 API 地址是否包含 /v1 以及模型名"
            "429" in m || "rate limit" in m || "too many requests" in m -> "请求过于频繁（429）：请稍等片刻再试"
            "500" in m || "502" in m || "503" in m || "504" in m || "bad gateway" in m || "service unavailable" in m -> "服务端错误（5xx）：请稍后重试或更换端点"
            else -> msg
        }
    }
}
