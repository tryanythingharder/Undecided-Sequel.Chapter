# 六面世界 · 移动端（Android）

折中方案阶段一：**原生 Kotlin Compose UI + 内嵌 V8 运行桌面版故事状态引擎**。
桌面端（Electron）与本目录完全隔离——桌面代码零改动，唯一共享的是仓库根的
`engine/`（故事状态引擎）与 `kernel*.md`（世界内核），它们在构建时被实时拷入
assets，桌面端改动无需任何同步动作即可生效到移动端。

## 目录结构

```
mobile/
├── app/
│   ├── build.gradle.kts            # 构建配置（含 engine 资产拷贝任务、ABI 裁剪）
│   └── src/main/
│       ├── assets/bridge/engine-bridge.js   # JS 桥：CommonJS 加载器 + fs/path/crypto 垫片
│       ├── java/com/sixworlds/mobile/
│       │   ├── engine/EngineRuntime.kt      # Javet V8 运行时（虚拟 fs + JSON 编组）
│       │   ├── engine/EngineBridge.kt       # 引擎门面（对齐桌面 ipcMain.handle API 面）
│       │   ├── chat/StoryChatController.kt  # 聊天主流程（对齐桌面 renderer send()）
│       │   ├── data/ChatClient.kt           # OpenAI 兼容流式客户端（对齐 main.cjs chat:send）
│       │   ├── data/SettingsRepository.kt   # DataStore + AndroidKeyStore 加密 API Key
│       │   ├── data/SessionStore.kt         # 叙事会话持久化（对照桌面 localStorage）
│       │   └── ui/…                         # Compose 界面（聊天 / 设置 / 快照）
│       └── AndroidManifest.xml
├── tools/bridge-test.mjs           # 桥接层仿真测试（Node 即可运行，无需安卓环境）
└── README.md
```

## 桥接设计（为什么桌面引擎能一行不改地跑在手机上）

桌面引擎是 CommonJS 代码，依赖 Node 的 `fs`/`path`/`crypto` 与一处
`SharedArrayBuffer`。engine-bridge.js 用约 300 行垫片补齐：

| 依赖 | 垫片方案 |
|---|---|
| 模块加载 | 宿主（Kotlin）把 `assets/engine/*.js` 注入 `__files`，桥内实现 `require` |
| `fs` | 内存虚拟 fs；启动时注入磁盘现状（seed），每次引擎调用后 Kotlin 取脏文件原子落盘 |
| `crypto.createHash('sha1')` | 纯 JS SHA-1（UTF-8），已与 `node:crypto` 逐字节比对（含中文/emoji） |
| `SharedArrayBuffer` | store.js 的 Windows 重命名退避在安卓不可达，另做无操作降级兜底 |

与宿主的通信只依赖两个 Javet API：`createV8Runtime()` 与
`getExecutor(script).executeString()`，全部数据以 JSON 字符串编组，
把嵌入式运行时的互操作面收敛到最小。

**先跑仿真测试再上真机**（不装任何安卓工具链）：

```bash
cd mobile
node tools/bridge-test.mjs
```

覆盖：CommonJS 加载器、虚拟 fs 落盘与重启恢复、SHA-1 一致性、
引擎全流程（ensure → context → commit → 补录 Pending → 快照/恢复 → 回合日志）。

## 构建与运行

要求：JDK 17、Android SDK（compileSdk 36；Android Studio 会自动装）。

- **Android Studio（推荐）**：打开 `mobile/` 目录 → 等待 Gradle Sync → 运行 `app`。
- **命令行**：

```bash
cd mobile
./gradlew assembleDebug          # 产物：app/build/outputs/apk/debug/app-debug.apk
```

仓库已配置阿里云 Google 镜像优先、官方源兜底；Gradle 分发包走腾讯镜像
（`gradle/wrapper/gradle-wrapper.properties`），国内网络实测 5MB/s。

## 本机实战踩坑记录（2026-08，Windows + JDK 17）

1. **构建路径含中文**：AGP 默认拒绝非 ASCII 路径，已在 `gradle.properties`
   加 `android.overridePathCheck=true`（本工程无 NDK 编译环节，实测可用）。
2. **settings.gradle.kts 静默失效**：Kotlin 块注释支持嵌套，头注释里出现
   `engine/*.js` 的「斜杠+星号」会让注释永远闭合不了，整个 pluginManagement
   被吞掉且无任何报错。已改写文件并在此留档，勿在块注释里写该组合。
3. **阿里云 central 镜像缺大文件**：javet-v8-android 的 103MB AAR 在镜像上
   只有 POM 没有本体，依赖解析认准首个仓库后不回退 → 依赖解析直接走
   Maven Central 官方源（实测速度快）。
4. **版本栈**：2026-08 的前沿 AndroidX（compose 1.12 / lifecycle 2.11 /
   okhttp 5.5）要求 beta 通道的 android-36.1（API 37），稳定通道锁定为
   compose-bom 2026.06.01 + lifecycle 2.10.0 + okhttp 5.4.0 + compileSdk 36。
5. **Javet 5.x 泛型**：`V8Host.getV8Instance().createV8Runtime()` 返回
   `<R : V8Runtime> R`，Kotlin 局部变量必须显式标注 `val rt: V8Runtime = …`。

## 体积注意

Javet 的 `javet-v8-android` 自带 4 个 ABI 的 V8 native 库（每个约 100MB）。
`app/build.gradle.kts` 已用 `abiFilters` 裁剪到 arm64-v8a（真机）+ x86_64（模拟器），
Debug 包仍会比较大；只发真机时把 x86_64 一行删掉即可，AGP 打包时也会对
native 库做 strip 瘦身。

## MVP 范围与后续迭代

已实现：流式聊天、状态引擎全流程（含补录 Pending 与快照恢复）、系统级加密的
API Key、双内核切换、端点连通性测试、**选项点击**（parseChoices/extractQuoteChoices
逐行移植自桌面，含引号兜底）、**叙事结构化渲染**（【你需要决定】/【简要状态】/
选项行弱化/Markdown 基础）、**重生成**（discardTurn 留痕）、**世界线管理**
（列表/切换/新建/删除）、**待补录横幅与一键补交**（对齐桌面 resolvePendingFlow）。

已知 TODO：

- 桌面端更细的结构化渲染样式（场景行等）与多选模式（Ctrl/勾选组合发送）
- 插图生成与保存到相册、系统通知、上下文轮数设置
- 上下文轮数当前固定 24（与桌面默认一致）
- 桌面 ↔ 手机进度同步：**已实现**。桌面端「设置 → 数据管理 → 导出移动端进度包」（聊天记录 + 引擎状态 + 快照打成单个 JSON）→ 微信/网盘传到手机 → 设置 · 数据 →「进度包 / 续玩码导入」。反向同理（手机进度包导出）。
- 真机验证（V8 原生库加载、流式、引擎提交）——APK 已产出，待设备实测
- Release 链路：签名 keystore、混淆、ABI 裁剪（砍掉 x86_64 约省 110MB）
