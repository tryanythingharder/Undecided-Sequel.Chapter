<div align="center">

# 六面世界 · Six Worlds

**一款 Windows 桌面端「AI 私人故事引擎」—— 转生进一个文字世界，你的每个选择都算数。**

以《六面世界：人生模拟器》世界内核为舞台：AI 逐幕推进叙事、每幕给出 A/B/C 选项按钮，也可自由行动；
支持世界线分歧回溯（IF 线）、AI 插图生成、画廊集与故事存档导出。兼容任意 OpenAI 兼容大模型端点。

![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-blue)
![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)
![Version](https://img.shields.io/badge/version-1.2.3-c98b4b)
![License](https://img.shields.io/badge/license-MIT-green)

[功能总览](#-功能总览) · [截图预览](#-截图预览) · [快速开始](#-快速开始) · [打包发布](#-打包发布) · [开发与测试](#-开发与测试) · [免责声明](#-免责声明)

</div>

---

## 📸 截图预览

| 入场动画 | 主界面 · 叙事与选项 |
| --- | --- |
| ![入场动画](docs/shots/01-splash.png) | ![主界面](docs/shots/02-main-dark.png) |

| 主题弹层 · 7 调色板 × 明暗 | 羊皮纸浅色主题 |
| --- | --- |
| ![主题](docs/shots/03-theme-pop.png) | ![浅色](docs/shots/04-light-paper.png) |

| 画廊 · 插图集 | 设置 · 独立系统窗口 |
| --- | --- |
| ![画廊](docs/shots/05-gallery.png) | ![设置](docs/shots/06-settings.png) |

## ✨ 功能总览

### 🎭 故事引擎

- **回合制叙事**：AI 以【甲龙历 407.03.01｜清晨】式场景块逐幕推进，流式打字机输出、可随时「停止」（保留已生成半段）；
- **选项按钮**：每幕自动解析 A/B/C 选项渲染为可点击卡片（多格式兼容：【A】/ A. / 1. / ① / 加粗列表）；点击即行动；
- **多选组合**：Ctrl+点选多项 →「已选 N 项：A + B」→ 一键组合发送；**选项区自动收起/展开**（上滑翻历史不打扰）；
- **自由行动**：输入框自由描述（Enter 发送 · Shift+Enter 换行 · **空框按 ↑ 召回历史行动**）；「✦ 灵感」一键填入行动提示；
- **IF 分歧回溯**：对结果不满意？悬停你发出的行动点「IF 分歧」——在新世界线复刻到该节点，换一个选择走向不同结局，母线完整保留（`IF ·` 前缀 + 「← 母线」面包屑）；
- **消息工具条**：复制 · 重生成 · 生成插图 · IF 分歧 · 保存插图；
- **出身预设**：新世界线空态提供 4 个转生出身，点击预填、可编辑再发送；
- **轻量 Markdown**：加粗 / 斜体 / 行内代码 / 分隔线，安全转义渲染。

### 🌍 世界与世界线

- **多工作区**：每个工作区独立的世界线集合 + 可绑定**专属世界内核**（不同世界并行）；
- **多世界线**：持久化保存、双击重命名、拖拽排序、按 今天/昨天/7 天内/更早 自动分组、相对时间显示；
- **全局搜索**（侧栏，跨世界线标题+正文）+ **会话内搜索**（Ctrl+F，命中高亮 n/n 跳转）；
- **故事进度条**：侧栏收起时左缘出现，节点=每次世界回应，悬停预览（含插图）、点击跳转那一幕。

### 🖼 AI 插图

- OpenAI 兼容图像端点（OpenAI / 智谱 CogView / 硅基流动 Kolors / 通义万相 / 自定义）；
- 7 种画风（含「原作轻小说」预设与自定义提示词）× 7 档尺寸 + 清晰度 / 负面词 / 种子锁定；
- 自动生成或悬停手动生成；失败自动重试 +「↻ 重试绘制」；
- **画廊**（Ctrl+G）：按世界线浏览全部插图、大图查看器（←→ 循环切换）、批量保存、**导出为自包含 HTML 故事存档**。

### 🎨 外观与主题

- **7 套调色板**（经典琥珀 / 羊皮纸 / 林间 / 紫晶 / 海渊 / 蔷薇 / 高对比）× **明暗三态**（跟随系统 / 深 / 浅）；
- 全部 14 组合关键对比度**实测 WCAG AA**；
- 字体（无衬线/衬线）、圆角、密度、阅读列宽、字号（Ctrl+=/-/0）全部可调、即时预览；
- 布局三模式（标准 / 专注 / 沉浸）+ 侧栏左右换向；
- **入场动画**与**灵动岛通知**（玻璃胶囊 spring；生成中呼吸光环 + 流光）。

### ⚙️ 模型与配置

- 预设 7 家 OpenAI 兼容端点（DeepSeek / OpenAI / Kimi / 智谱 / 通义 / 硅基流动 / 自定义），均可改地址/密钥/模型；
- 「获取模型」拉取 `/models` 下拉点选（带筛选）、「测试」连接验证（GET，不耗 token）；
- **思考程度**（默认/浅/中/深，映射 reasoning_effort）；对话栏直接切换模型；
- 模型用量芯片：本线 / 全部世界线 token 统计与扣费信息；
- **三步首启向导**（外观 → 对话模型 → 插图模型）+ 免责声明确认；配置导入/导出（JSON，脱敏不含密钥）。

### 🖥 桌面级体验

无边框自绘标题栏 · 窗口置顶（多级兜底）· 窗口状态记忆 · 单实例锁 · 标题双击最大化 · 系统通知 ·
每会话输入草稿 · 上下文自动压缩（内核 + 最近 24 条）· 存储不足即时警示 · 渲染崩溃自动恢复 ·
全键盘可达 + 焦点环 + aria-live（无障碍）· 全中文界面。

## 🚀 快速开始

### 方式一：下载打包版（推荐）

到 [Releases](https://github.com/tryanythingharder/Undecided-Sequel.Chapter/releases) 下载：

| 文件 | 说明 |
|---|---|
| `六面世界 Setup x.y.z.exe` | 安装版：可选目录、创建快捷方式 |
| `六面世界-便携版-x.y.z.exe` | 免安装单文件，双击即用 |

### 方式二：源码运行

```powershell
git clone https://github.com/tryanythingharder/Undecided-Sequel.Chapter.git
cd Undecided-Sequel.Chapter
npm install        # 仅首次
npm start          # 或直接双击 启动游戏.cmd
```

### 首次配置

1. 启动后按向导选择外观（可跳过）；
2. 设置（Ctrl+,）→ 文本模型：选提供商、填 API Key（**密钥只存本机**，请求由主进程发起，不进入渲染层）；
3. 可选：插图模型同页配置；「测试」按钮验证连通性（不消耗 token）。

### 常用快捷键

| 快捷键 | 功能 | 快捷键 | 功能 |
|---|---|---|---|
| `Enter` / `Shift+Enter` | 发送 / 换行 | `Ctrl+N` | 新世界线 |
| `↑`（空框） | 召回上一条行动 | `Ctrl+B` | 收起/展开侧栏 |
| `Ctrl+F` | 会话内搜索 | `Ctrl+G` | 画廊 |
| `Ctrl+,` | 设置 | `Ctrl+/` | 快捷键面板 |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | 字号 缩放/缩小/复位 | `Esc` | 关闭浮层 / 清空搜索 |

## 📦 打包发布

```bash
npm run icon   # 可选：重新生成应用图标（build/icon.svg → .ico/.png）
npm run dist   # 打包 NSIS 安装版 + 便携版单文件（产物在 dist/）
```

- 国内网络慢可先设镜像：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`
- 打包只含运行必需文件（main / preload / kernel.md / renderer），不含 node_modules 与开发脚本。

## 🧭 项目结构

```
├── main.cjs              # Electron 主进程：窗口/置顶/HTTP 桥(SSE 流式)/插图桥/单实例锁
├── preload.cjs           # contextBridge 安全桥，暴露极窄 IPC API
├── renderer/
│   ├── index.html        # 主界面 DOM
│   ├── settings.html     # 设置独立窗口
│   ├── app.js            # 界面逻辑（会话/选项解析/IF 线/画廊/主题/搜索…）
│   ├── settings.js       # 设置窗口逻辑（双窗口实时同步）
│   └── styles.css        # 全部样式（CSS 变量驱动 7 调色板 × 明暗）
├── kernel.md             # 世界内核《六面世界：人生模拟器》（可替换任意世界观）
├── build/                # 应用图标源文件
├── docs/shots/           # README 截图
├── scripts-dev/          # Playwright 开发/回归脚本（见下）
└── 启动游戏.cmd           # 双击启动（首次自动 npm install）
```

## 🧪 开发与测试

- `npm start` — 开发运行；所有脚本以 `SIXWORLDS_TEST=1` 启动并重定向 userData 到 `test-profile/`，**永不触碰真实用户配置**；
- `node scripts-dev/verify.cjs` — 35 项 UI 断言；`node scripts-dev/e2e-mock.cjs` — 本地 mock 服务端全链路（80 项）；
- `node scripts-dev/test-choices.cjs` — 选项解析/多选/收起回归（25 项）；`scripts-dev/` 下另有侧栏、会话、置顶、搜索、插图重试等 20+ 专项套件；
- `node scripts-dev/capture-readme-shots.cjs` — 重新生成 README 截图（种演示数据后逐屏捕获至 `docs/shots/`）。

## ❓ 常见问题

<details>
<summary><b>请求报 401 / 429 / 超时？</b></summary>
错误已本地化为中文提示：401 检查密钥、429 为限流稍后再试、超时可重发（错误消息带「↻ 重试这一回合」）。流式中断会保留已生成的半段文本。
</details>

<details>
<summary><b>换电脑如何迁移配置？</b></summary>
设置 → 高级 → 导出配置（JSON，<b>不含密钥</b>）；新机器导入后重填密钥即可。世界线数据保存在本机 <code>%APPDATA%/六面世界</code>。
</details>

<details>
<summary><b>支持非 DeepSeek 的模型吗？</b></summary>
支持任意 OpenAI 兼容端点（含本地 Ollama / LM Studio），改 Base URL 即可；不支持流式的端点自动回退非流式。
</details>

## ⚠️ 免责声明

- 本项目为**本地个人工具**，代码采用 MIT 许可证；`kernel.md` 世界内核为基于《无职转生》的同人创作，版权归原作（理不尽な孫の手）所有，仅作学习交流，不得用于商业用途；
- 使用本工具产生的 AI 生成内容由使用者自行负责；调用模型/插图 API 产生的费用由使用者自行承担；
- 请遵守所接模型服务商的服务条款。

## License

[MIT](LICENSE) © 2026
