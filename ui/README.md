# UI / UX 目录

这个目录集中放置所有界面与交互层代码，应用数据和世界引擎不放在这里。

## 目录结构

- `classic/`：当前默认的经典桌面聊天界面。修改常规界面时，优先改这里的 `index.html`、`styles.css` 和 `app.js`。
- `proto/`：原型工作台界面。可以在设置的主题抽屉中切换；适合试验新的界面结构和交互。
- `d/`：方案D「通用阅读」界面（自 `classic/` fork，功能与数据完全同源）。以方便阅读为先：顶栏胶囊分段（故事 ⇄ 内核）、左侧面板三态（停靠 / 细轨 / 悬停浮层）、面板头部图钉为停靠唯一开关；取消停靠后面板只以浮层出现，永远不占布局。内核六步排版沿用 kernel-design-v3。
- `shared/`：各界面共用的组件和运行时模块，例如外观、选项、搜索、画廊、发送流、提示、进度栏、桌宠和会话客户端。

## 常用修改位置

| 目标 | 位置 |
| --- | --- |
| 界面结构 / 文案 / 控件 | `classic/index.html` |
| 视觉样式 / 颜色 / 主题 | `classic/styles.css`，主题逻辑在 `shared/appearance.js` |
| 界面交互和渲染 | `classic/app.js` |
| 设置窗口 | `classic/settings.html`、`classic/settings.js` |
| 原型工作台 | `proto/` |
| 方案D 通用阅读（三态面板） | `d/`（视觉层在该目录 `styles.css` 尾部「方案D 视觉层」注释段） |
| 各界面共用的组件 | `shared/` |
| 桌宠 | `shared/bloub*.js`、`shared/pet-*.cjs` |

## 修改建议

1. 先改 `classic/` 里的 HTML/CSS，通常可以不动业务引擎。
2. 如果一段行为会在多套界面同时使用，放到 `shared/`，不要复制多份。
3. `d/` 的面板三态机在 `d/app.js`「方案D 左侧面板三态」注释段；状态由 `cfg.sbDock` 持久化，并与旧键 `sidebarCollapsed` 保持同步（切回 classic/proto 时语义正确）。
4. 只改视觉时优先使用 CSS 变量；主题、配色、字体、布局相关的变量集中在各界面 `styles.css` 的 `:root` / `html[data-theme]` 区块。
5. 运行 `npm start` 或双击仓库根目录的 `启动游戏.cmd` 查看效果；主题抽屉 →「界面方案」可在经典 / 原型 / 通用阅读之间即时切换。
