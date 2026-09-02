buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // Kotlin 2.4 要求 R8 9.1.29+；使用 Google Maven 可用的首个维护版。
        classpath("com.android.tools:r8:9.1.31")
    }
}

plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.4.10" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10" apply false
}

// Windows 的 Java 参数文件在非 ASCII 仓库路径下可能无法加载测试类。
// 测试入口可通过环境变量把构建产物放到系统临时目录；正常 IDE/CI 构建不受影响。
providers.environmentVariable("SIXWORLDS_GRADLE_BUILD_DIR").orNull?.let { externalRoot ->
    layout.buildDirectory.set(file("$externalRoot/root"))
    subprojects {
        layout.buildDirectory.set(file("$externalRoot/${project.name}"))
    }
}
