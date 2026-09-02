package com.sixworlds.mobile.engine

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
