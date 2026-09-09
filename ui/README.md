# UI / UX 目录

这个目录集中放置所有界面与交互层代码，应用数据和世界引擎不放在这里。

## 目录结构

- `classic/`：当前默认的经典桌面聊天界面。修改常规界面时，优先改这里的 `index.html`、`styles.css` 和 `app.js`。
- `proto/`：原型工作台界面。可以在设置的主题抽屉中切换；适合试验新的界面结构和交互。
- `shared/`：两套界面共用的组件和运行时模块，例如外观、选项、搜索、画廊、发送流、提示、进度栏、桌宠和会话客户端。

## 常用修改位置

| 目标 | 位置 |
| --- | --- |
| 界面结构 / 文案 / 控件 | `classic/index.html` |
| 视觉样式 / 颜色 / 主题 | `classic/styles.css`，主题逻辑在 `shared/appearance.js` |
| 界面交互和渲染 | `classic/app.js` |
| 设置窗口 | `classic/settings.html`、`classic/settings.js` |
| 原型工作台 | `proto/` |
| 两套界面共用的组件 | `shared/` |
| 桌宠 | `shared/bloub*.js`、`shared/pet-*.cjs` |

## 修改建议

1. 先改 `classic/` 里的 HTML/CSS，通常可以不动业务引擎。
2. 如果一段行为会在经典界面和原型界面同时使用，放到 `shared/`，不要复制两份。
3. 只改视觉时优先使用 CSS 变量；主题、配色、字体、布局相关的变量集中在各界面 `styles.css` 的 `:root` / `html[data-theme]` 区块。
4. 运行 `npm start` 或双击仓库根目录的 `启动游戏.cmd` 查看效果。
