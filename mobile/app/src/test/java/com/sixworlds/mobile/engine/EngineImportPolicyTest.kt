package com.sixworlds.mobile.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class EngineImportPolicyTest {
    private val root = Files.createTempDirectory("sixworlds-import-test").toFile()

    @Test
    fun acceptsExpectedEnginePaths() {
        val target = EngineImportPolicy.resolveTarget(root, "snapshots/S-001/SNAP-001.json", 128)
        assertTrue(target.path.startsWith(root.canonicalPath))
    }

    @Test
    fun ignorableLegacySkipsDerivedIndexAndTmp() {
        // 旧版导出包携带的派生索引/临时文件：应跳过而不是让整个导入失败
        assertTrue(EngineImportPolicy.isIgnorableLegacy("memory.db"))
        assertTrue(EngineImportPolicy.isIgnorableLegacy("memory.db-wal"))
        assertTrue(EngineImportPolicy.isIgnorableLegacy("tmp/orphan.json"))
        assertTrue(EngineImportPolicy.isIgnorableLegacy("tmp\\orphan.json"))
        assertFalse(EngineImportPolicy.isIgnorableLegacy("stories/S-001.json"))
        assertFalse(EngineImportPolicy.isIgnorableLegacy("snapshots/S-001/SNAP-001.json"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsTraversal() {
        EngineImportPolicy.resolveTarget(root, "stories/../../outside.json", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsWindowsAbsolutePath() {
        EngineImportPolicy.resolveTarget(root, "C:\\temp\\outside.json", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsTmpFiles() {
        EngineImportPolicy.resolveTarget(root, "tmp/orphan.json", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnexpectedExtensions() {
        EngineImportPolicy.resolveTarget(root, "stories/payload.js", 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsOversizedFiles() {
        EngineImportPolicy.resolveTarget(root, "stories/S-001.json", EngineImportPolicy.MAX_FILE_BYTES + 1)
    }
}
