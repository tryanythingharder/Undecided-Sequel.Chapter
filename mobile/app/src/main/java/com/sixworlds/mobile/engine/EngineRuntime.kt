package com.sixworlds.mobile.engine

import android.content.Context
import com.caoccao.javet.interop.V8Host
import com.caoccao.javet.interop.V8Runtime
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.Executors

/**
 * 内嵌 V8 运行时（Javet, V8 模式）—— 承载桌面版故事状态引擎（engine 目录源码）。
 *
 * 与 JS 的通信只依赖两个 Javet API（官方 README 验证）：
 *   - createV8Runtime()
 *   - getExecutor(script).executeString()   （脚本一律以字符串表达式收尾）
 * 全部数据以 JSON 字符串编组；文件系统为「内存虚拟 fs + 每次调用后落盘」，
 * 契约细节见 assets/bridge/engine-bridge.js 头注释。
 *
 * V8 具有线程亲和性：所有运行时操作都钉在单线程 dispatcher 上。
 */
class EngineRuntime(context: Context) {

    private val appContext: Context = context.applicationContext
    val engineDir: File = File(appContext.filesDir, "story-engine")

    private val dispatcher: CoroutineDispatcher =
        Executors.newSingleThreadExecutor { r -> Thread(r, "js-engine") }.asCoroutineDispatcher()

    private var runtime: V8Runtime? = null

    suspend fun call(name: String, payload: JSONObject): JSONObject = withContext(dispatcher) {
        val rt = ensureStarted()
        val script = "globalThis.__engineApi(${jsString(name)}, ${jsString(payload.toString())})"
        val result = rt.getExecutor(script).executeString()
        applyFlush(rt)
        JSONObject(result)
    }

    suspend fun close() = withContext(dispatcher) {
        runtime?.let { runCatching { it.close() } }
        runtime = null
    }

    /** 进度包导入：引擎文件落盘 + 重启运行时（下次调用按磁盘现状重新播种） */
    suspend fun restart() = withContext(dispatcher) {
        runtime?.let { runCatching { it.close() } }
        runtime = null
    }

    /** 写入进度包携带的引擎文件（严格限制在 story-engine 受支持目录），在 IO 线程调用 */
    fun importEngineFiles(files: org.json.JSONObject): Int {
        val pending = mutableListOf<Pair<File, String>>()
        var totalBytes = 0
        val keys = files.keys()
        while (keys.hasNext()) {
            val rel = keys.next()
            if (EngineImportPolicy.isIgnorableLegacy(rel)) continue   // 旧包派生文件（memory.db*/tmp）：跳过，不阻断导入
            require(pending.size < EngineImportPolicy.MAX_FILES) { "进度包中的引擎文件数量过多" }
            val raw = files.opt(rel)
            require(raw is String) { "进度包中的引擎文件内容必须是文本" }
            val bytes = raw.toByteArray(Charsets.UTF_8).size
            totalBytes += bytes
            require(totalBytes <= EngineImportPolicy.MAX_TOTAL_BYTES) { "进度包中的引擎数据总量过大" }
            val target = EngineImportPolicy.resolveTarget(engineDir, rel, bytes)
            pending += target to raw
        }
        for ((target, content) in pending) {
            target.parentFile?.mkdirs()
            atomicWrite(target, content)
        }
        return pending.size
    }

    /** 仅在 js-engine 线程上调用。 */
    private fun ensureStarted(): V8Runtime {
        runtime?.let { return it }
        // createV8Runtime() 是泛型方法 <R : V8Runtime>，必须显式标注期望类型
        val rt: V8Runtime = V8Host.getV8Instance().createV8Runtime()

        // 1) 注入引擎源码表（assets/engine/*.js，构建时从仓库根 engine/ 实时拷入）
        val filesJson = buildFilesJson()
        rt.getExecutor("globalThis.__files = JSON.parse(${jsString(filesJson)})").executeString()

        // 2) 载入桥接层（脚本末尾追加字符串表达式，保证 executeString 拿到完成值）
        val bootstrap = appContext.assets.open("bridge/engine-bridge.js")
            .bufferedReader(Charsets.UTF_8).use { it.readText() }
        val bootResult = rt.getExecutor(bootstrap + "\n'bridge-ok'").executeString()
        check(bootResult == "bridge-ok") { "引擎桥加载失败：$bootResult" }

        // 3) 以磁盘现状初始化（进程重启恢复）
        val payload = JSONObject()
            .put("dataDir", engineDir.absolutePath.replace('\\', '/'))
            .put("files", JSONObject(buildSeedJson()))
        val initResult = rt.getExecutor("globalThis.__engineInit(${jsString(payload.toString())})").executeString()
        val initJson = JSONObject(initResult)
        check(initJson.optBoolean("ok")) { "引擎初始化失败：${initJson.optString("error")}" }
        applyFlush(rt)
        return rt
    }

    /** 从虚拟 fs 取脏文件并真实落盘（null 值 = 删除）。 */
    private fun applyFlush(rt: V8Runtime) {
        val flush = rt.getExecutor("globalThis.__fsFlushJson()").executeString()
        val dirty = JSONObject(flush)
        if (dirty.length() == 0) return
        val root = engineDir.absolutePath.replace('\\', '/')
        val keys = dirty.keys()
        while (keys.hasNext()) {
            val abs = keys.next()
            check(abs == root || abs.startsWith("$root/")) { "flush 路径越界：$abs" }
            val rel = abs.substring(root.length).trimStart('/')
            val target = File(engineDir, rel)
            val value = dirty.get(abs)
            if (value == null || value == JSONObject.NULL) {
                target.delete()
            } else {
                target.parentFile?.mkdirs()
                atomicWrite(target, value.toString())
            }
        }
    }

    private fun atomicWrite(target: File, content: String) {
        val tmp = File(target.parentFile, target.name + ".tmp" + System.currentTimeMillis())
        tmp.writeText(content, Charsets.UTF_8)
        try {
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: Exception) {
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }

    private fun buildFilesJson(): String {
        val obj = JSONObject()
        val names = appContext.assets.list("engine") ?: emptyArray()
        for (name in names.sorted()) {
            if (!name.endsWith(".js")) continue
            val text = appContext.assets.open("engine/$name")
                .bufferedReader(Charsets.UTF_8).use { it.readText() }
            obj.put("engine/$name", text)
        }
        return obj.toString()
    }

    private fun buildSeedJson(): String {
        val obj = JSONObject()
        if (engineDir.exists()) {
            engineDir.walkTopDown().filter { it.isFile }.forEach { f ->
                val abs = f.absolutePath.replace('\\', '/')
                runCatching { obj.put(abs, f.readText(Charsets.UTF_8)) }
            }
        }
        return obj.toString()
    }

    /** JSON 文本 → JS 字符串字面量（转义换行/引号/控制字符/U+2028/2029）。 */
    private fun jsString(s: String): String {
        val sb = StringBuilder(s.length + 16)
        sb.append('"')
        for (c in s) {
            when (val code = c.code) {
                0x5C -> sb.append("\\\\")   // 反斜杠
                0x22 -> sb.append("\\\"")   // 双引号
                0x0A -> sb.append("\\n")
                0x0D -> sb.append("\\r")
                0x09 -> sb.append("\\t")
                0x08 -> sb.append("\\b")
                0x2028 -> sb.append("\\u2028")
                0x2029 -> sb.append("\\u2029")
                else -> if (code < 0x20) sb.append("\\u%04x".format(code)) else sb.append(c)
            }
        }
        sb.append('"')
        return sb.toString()
    }
}
