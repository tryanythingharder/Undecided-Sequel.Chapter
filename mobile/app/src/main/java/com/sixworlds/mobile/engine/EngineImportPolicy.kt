package com.sixworlds.mobile.engine

import java.io.File

internal object EngineImportPolicy {
    const val MAX_FILE_BYTES = 8 * 1024 * 1024
    const val MAX_TOTAL_BYTES = 128 * 1024 * 1024
    const val MAX_FILES = 5000

    private val allowedRootDirs = setOf("stories", "snapshots", "pendings", "logs")
    private val safeSegment = Regex("^[A-Za-z0-9_.-]{1,180}$")

    fun resolveTarget(engineDir: File, relativePath: String, contentBytes: Int): File {
        require(contentBytes in 0..MAX_FILE_BYTES) { "进度包中的引擎文件过大" }
        require(relativePath.isNotBlank() && relativePath.length <= 512) { "进度包路径为空或过长" }
        require('\u0000' !in relativePath) { "进度包路径包含空字符" }

        val rel = relativePath.replace('\\', '/')
        require(!rel.startsWith('/') && !Regex("^[A-Za-z]:").containsMatchIn(rel)) { "不允许绝对路径" }
        val segments = rel.split('/')
        require(segments.size in 2..3) { "引擎文件目录层级不正确" }
        require(segments.none { it.isBlank() || it == "." || it == ".." || !safeSegment.matches(it) }) {
            "引擎文件路径包含非法片段"
        }
        require(segments.first() in allowedRootDirs) { "不支持的引擎文件目录" }
        require(segments.first() != "tmp" && segments.last().endsWith(".json")) { "不支持的引擎文件类型" }

        val root = engineDir.canonicalFile
        val target = File(root, segments.joinToString(File.separator)).canonicalFile
        require(target.path.startsWith(root.path + File.separator)) { "引擎文件路径越界" }
        return target
    }

    /** 旧版导出包可能携带派生索引/临时文件（memory.db*、tmp/）：跳过不落盘，也不让整个导入失败 */
    fun isIgnorableLegacy(relativePath: String): Boolean {
        val rel = relativePath.replace('\\', '/')
        return rel.substringBefore('/') == "tmp" || rel.substringAfterLast('/').startsWith("memory.db")
    }
}
