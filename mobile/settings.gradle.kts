// 六面世界 · 移动端 —— 折中方案阶段一
// 原生 Kotlin Compose UI + 内嵌 V8 运行桌面版故事状态引擎
// 注意：本文件的头注释里不要出现形如 engine/与星号 的写法组合——
// Kotlin 块注释支持嵌套，注释里出现斜杠+星号会吞掉整个 pluginManagement
pluginManagement {
    repositories {
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/central")
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://maven.aliyun.com/repository/google")
        google()
        mavenCentral()
    }
}
rootProject.name = "sixworlds-mobile"
include(":app")
