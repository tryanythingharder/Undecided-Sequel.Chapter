# 原型优化记录（对照 full-merged.md 提示词自查表）

基准：`../full-merged.md` 第三部分完整性自查表。已用 Playwright 截图验证（`shots/` 目录，1120×700 @2x）。

## 修复清单

### 入场动画（IntroScreen.tsx / index.css / App.tsx）
1. **副词 CODEX 流光扫字补齐**：原稿缺失（被换成中文副题「属于自己的小说」）。改为 flex 行 lockup——外层 `codex-expand` 关键帧（max-width 0→420px 生长），容器自动再居中、六面世界随之平滑左移让位；内层 `title-codex-reveal` 细缝切入（inset 52%→34%→0 + skewX 9°→0）+ `.codex-code` 渐变流光扫字（白→琥珀→青，background-clip:text）；末字符「X」实心金 #d8c486。
2. **色散阴影强度校正**：主词 text-shadow 从 .65 透明度降到 .24/.18（原稿过强像故障风）。
3. **离场双层时序补齐**：粒子 canvas 单独先行淡出（560ms → opacity .22 + scale 1.008），整层 620ms 后跟进——原稿只有整层淡出。
4. **兜底 8s → 12s**（提示词规定）。

### 主界面（MainInterface.tsx / index.css）
5. **浅色 token 全部违规修正**：#ffffff 舞台→#f3f1ec 暖纸、#1a1a1a 文字→#26231e、#e8e8e8 边框→#e4e1da 等，全部对齐规范调色板（index.css :root）。
6. **34 处硬编码三元色值 → CSS 变量**：`isDark ? "#c98b4b" : "#a5641f"` 等 5 组模式全部替换为 var(--accent)/var(--text-*)/var(--border)，随 .dark 类自动切换。
7. **插图三态补齐**：新增「生成中」（虚线框 + 扫动流光线 + 文案）与「失败」（红调 + 重试绘制）两个状态演示区。
8. **搜索高亮演示补齐**：`<mark>` accent-glow 底 + accent 字色命中效果。
9. **「展开选项」补齐（C4）**：选项区收起后显示玻璃胶囊按钮。

### 灵动岛（DynamicIsland.tsx）
10. **状态间 morph**：圆角（999↔22px）、min-width、内距加 `.5s var(--ease-spring)` 过渡，切换不再瞬跳。

## 验证
- `npx tsc --noEmit` 通过（exit 0）
- Playwright 截图 9 张：浅/深主界面、灵动岛 3 态、入场 4 关键帧、点击进入后
- 遗留（不影响验收）：vite.config.ts 的 configLoader 警告（Figma Make 脚手架自带）

## 复跑方式
```
npm install
npm run dev -- --port 5199
# 浏览器打开 http://localhost:5199 ，右下角 Demo Panel 可切主题/触灵动岛/重播入场
```
