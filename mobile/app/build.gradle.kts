import org.jetbrains.kotlin.gradle.dsl.JvmTarget

/* app 模块 —— 关键点：
 * 1. engine/ 与 kernel*.md 不复制进仓库，构建时从仓库根实时拷入 assets（桌面端改动自动同步）
 * 2. Javet（javet-v8-android）自带 4 个 ABI 的 V8 native 库（每个约 100MB），
 *    debug 裁剪到 arm64-v8a（真机）+ x86_64（模拟器），release 仅保留 arm64-v8a
 */
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val repoRoot = rootDir.parentFile // mobile/.. = 仓库根

// 版本号与桌面端同源：release tag 打在仓库根版本上，移动端跟随（桌面 1.5.0 ⇒ APK 1.5.0）
val pkgVersion = (groovy.json.JsonSlurper()
    .parseText(repoRoot.resolve("package.json").readText()) as Map<*, *>)
    .getOrDefault("version", "0.0.0").toString()

val genAssets = layout.buildDirectory.dir("generated/engineAssets")
val prepareEngineAssets = tasks.register<Copy>("prepareEngineAssets") {
    from(repoRoot.resolve("engine")) { into("engine") }
    from(repoRoot.resolve("kernel.md"))
    from(repoRoot.resolve("kernel-xianxia.md"))
    into(genAssets)
}

val releaseStorePath = providers.environmentVariable("SIXWORLDS_RELEASE_STORE_FILE").orNull
val releaseStorePassword = providers.environmentVariable("SIXWORLDS_RELEASE_STORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("SIXWORLDS_RELEASE_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("SIXWORLDS_RELEASE_KEY_PASSWORD").orNull
val releaseSigningReady = listOf(releaseStorePath, releaseStorePassword, releaseKeyAlias, releaseKeyPassword).all { !it.isNullOrBlank() }

android {
    namespace = "com.sixworlds.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sixworlds.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = pkgVersion
        ndk {
            abiFilters.add("arm64-v8a")
        }
    }

    sourceSets["main"].assets.srcDir(genAssets)

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = file(releaseStorePath!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            ndk {
                abiFilters.add("x86_64")
            }
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            if (releaseSigningReady) signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

tasks.named("preBuild") { dependsOn(prepareEngineAssets) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    // 2026.08 BOM（compose 1.12）要求 beta 通道的 android-36.1（API 37），稳定通道暂用 2026.06.01
    implementation(platform("androidx.compose:compose-bom:2026.06.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.datastore:datastore-preferences:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:5.4.0")
    // 内嵌 V8：运行桌面版故事状态引擎（engine/*.js）
    implementation("com.caoccao.javet:javet-v8-android:5.0.11")
    testImplementation("junit:junit:4.13.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
