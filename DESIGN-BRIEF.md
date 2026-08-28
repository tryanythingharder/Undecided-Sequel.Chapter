# 提示词：为「六面世界」桌面应用做整套统一 UI/UX 设计

把下面全文直接交给设计 AI。

---

你是一位资深桌面应用与设计系统设计师，擅长 Electron 桌面产品、深浅双主题设计系统、中文排版与克制的奇幻书卷美学。请为以下产品输出**一套完整、可直接落地为 CSS 的统一视觉与交互规范**。你必须先通读全部背景，再按文末「交付要求」输出。

---

## 一、产品全景（是什么 + 全部功能）

**六面世界（Six Worlds）**：Windows 桌面端「AI 私人故事引擎」。玩家"转生"进一个文字世界，以一条条**世界线**推进剧情：AI 以第二人称叙事每一幕（含【场景·时间】标题块），并给出 A/B/C 选项按钮；玩家也可自由输入行动。气质：**安静、留白、少装饰、书卷气、一点琥珀色的仪式感**。

### 全部功能清单（每项都必须有对应视觉设计）

**故事引擎**
1. 转生开局：中央「开始游戏」空状态 + 出身预设快捷标签（如「贵族血脉」，点击填入输入框可改再发送）。
2. 回合叙事：AI 回复流式输出（尾部光标闪烁），支持【甲龙历 407.03.01｜清晨】式场景块、引用条、加粗、分隔线。
3. 选项系统：每幕自动解析出 A/B/C…选项按钮（左侧键位徽标 + 标签，hover 抬起）；多选组合模式（Ctrl+点选 → 底部组合工具条「已选 n 项 · A + B · 组合发送 · 清空」）；点击选项直接作为行动发送。
4. 兜底建议：AI 未给选项时，从正文提取「引号候选」生成虚线次级按钮，或三条通用建议（继续推进/调查周围/等待发展）。
5. 自由行动：底部输入框（Enter 发送 · Shift+Enter 换行 · 空框按 ↑ 召回历史行动）。
6. 灵感按钮：✦ 灵感，随机填入一条行动建议到输入框。
7. IF 分歧：悬停自己发过的行动 → 工具条「IF 分歧」→ 在新世界线复刻到该节点，换选择走不同结局。
8. 消息工具条（hover 显示）：复制 · 重生成 · 插图 · IF 分歧 · 保存。
9. 生成中：发送钮变「停止」（可中断）；顶部出现**生成中灵动岛**。
10. 思考程度：下拉选 默认/浅/中/深。

**世界与世界线管理**
11. 工作区（世界）：左上角切换器（菱形印记 + 世界名 + caret）→ 浮层菜单：工作区列表 / 新建 / 重命名 / 设置专属内核… / 删除（危险红）。
12. 世界线（会话）：侧栏按日期分组列表（今天/昨天…），条目=标题+相对时间，active 高亮；**双击行内重命名**；删除（生成中禁删，需确认）；「新世界线」主按钮。
13. 侧栏搜索：按标题+正文过滤当前工作区世界线；另有一层会话内文字搜索（Ctrl+F 行内条：输入 + n/n + 上下跳转 + 高亮）。
14. 故事进度条：侧栏收起时左缘出现细轨 + 幕节点圆点 + 填充进度；悬停节点弹出预览卡（该幕摘要，有插图则含缩略图），点击跳转。

**插图系统**
15. 每条 AI 叙事可配插图：自动生成开关或消息旁手动生成；插图卡内嵌消息流（骨架 shimmer → 淡入 / 生成中呼吸点 / 失败态可重试）。
16. 画风 6 选：轻小说原作风/动漫/水彩/油画/水墨/写实 + 自定义画风提示词；尺寸、质量、负面词、种子锁（高级折叠区）。
17. 画廊（Ctrl+G）：右侧滑入抽屉；头部=标题+数量+关闭；工具条=世界线下拉 + 保存全部插图到文件夹 + 导出为故事存档；网格卡片 + 点击大图灯箱（←→ 翻页 · Esc 关）。
18. 故事存档导出：整条世界线导出为自包含 HTML（文字+内嵌插图）。

**配置系统（设置 = 独立无边框小窗 614×461）**
19. 四 Tab：**文本模型**（提供商预设 / BaseURL / 密钥👁 / 模型名+获取模型+连接测试 / 测试结果条 / 可选模型清单勾选 / 手动添加）；**插图模型**（自动开关+全部连接/画风/尺寸/质量/高级）；**外观·内核**（见 20-24 + 内核状态）；**高级**（配置导出 JSON / 导入 JSON / 危险区）。
20. 主题系统：7 调色板 × 明暗 = 14 套；标题栏「主题」弹层：色板格（双色圆点+名）+ 明暗三选（跟随系统/深/浅）。
21. 外观项：字体 sans/serif、圆角三档、密度三档（紧凑/标准/宽松）、阅读列宽三档（--read-w）、字号缩放（Ctrl+=/-/0，写 --font-size）。
22. 布局：三模式（标准=侧栏+聊天 / 专注=隐藏侧栏 / 沉浸=再隐藏头部）+ 侧栏左/右换向。
23. 首启向导：三步卡（文本模型 → 插图模型 → 主题外观），步骤指示器、前进/后退滑动、主题选项大卡（✓ 选中）、「稍后再说」跳过。
24. 模型用量弹层：点输入区模型芯片弹出，显示模型名/token 用量等信息。

**系统层**
25. 无边框窗口自绘标题栏：品牌印记+名 ｜ 画廊 · 置顶（图钉态高亮）· 主题 ｜ 最小化/最大化/关闭（hover 红）。窗口位置尺寸记忆。
26. 灵动岛通知：顶部居中玻璃胶囊（成功/失败/信息三态），spring 入场、下滑离场。
27. 生成中灵动岛：呼吸光环 + 流光扫过 + 圆点脉动。
28. 入场动画（Splash）：黑场 → canvas 尘埃 → 品牌字 5.2s 长曲线展开 + 金色扫光 → 信号脉冲 → 「点击进入」→ 缩放淡出进主界面。
29. 帮助模态：双 Tab（怎么玩=编号步骤引导 / 快捷键=kbd 键帽表格）+ 右下角「?」浮钮。
30. 全部快捷键：Ctrl+B 侧栏 · Ctrl+N 新世界线 · Ctrl+F 搜索 · Ctrl+G 画廊 · Ctrl+, 设置 · Ctrl+/ 快捷键表 · Enter/Shift+Enter · ↑ 召回 · Ctrl+=/-/0 字号 · Esc 关闭/清空。
31. 空状态/加载/错误/存储不足警告（toast 长驻 8s）四态统一设计。
32. 内核状态 chip（侧栏底部「内核 · 已加载」）。

## 二、页面与组件结构（DOM 骨架，类名不可改）

```
body
├─ #splash（入场动画层：canvas.dust / .splash-lockup 品牌字 / .splash-signal / .splash-enter / .splash-noise）
├─ header.titlebar（40px 高、拖拽区）
│   ├─ .titlebar-brand：#btn-sidebar-toggle(◂) · .sigil 菱形印记 · .titlebar-name
│   └─ .titlebar-actions：#btn-gallery 画廊 · #btn-pin 置顶 · #btn-theme 主题 · 分隔线 · min/max/close(红hover)
├─ .layout（侧栏方向可反转 .sb-right）
│   ├─ aside.sidebar（200px；拖缘伸缩；收起后 48px 图标栏+会话徽标）
│   │   ├─ .ws-btn 工作区 → .ws-menu 浮层（列表/新建/重命名/专属内核/删除）
│   │   ├─ .new-chat「新世界线」主钮
│   │   ├─ .sb-search 搜索框
│   │   ├─ .session-area：标签行(世界线+收起钮) + #session-list（日期分组 .session-item）
│   │   └─ .sidebar-foot：#kernel-chip + #btn-settings 设置
│   └─ main.chat
│       ├─ .progress-rail（.rail-nodes 节点/.rail-track/.rail-fill）+ .rail-pop 预览卡
│       ├─ .chat-header：#chat-title 标题 + #chat-status 状态
│       ├─ .search-bar 行内搜索条
│       ├─ #messages 消息流（阅读宽 720px 居中）
│       │   └─ .msg.user / .msg.assistant → .msg-role + .msg-time + .msg-body
│       │       + .msg-tools(hover 工具条) + .illust/.illust-pending/.illust-error
│       ├─ .choices 选项区：头部(「这一幕的 N 个选择」+ 多选组合 + 收起▴)
│       │   + .choice(键位徽标.ck+标签/.picked/.fallback 虚线) + .multi-bar 组合工具条
│       │   + 收起态 #choices-expand「展开选项」胶囊
│       └─ .composer：.composer-box(textarea 自增高) + .composer-foot
│           ├─ .composer-config：模型chip×2 + .model-pop 用量 + .hint + 模型下拉 + 思考下拉
│           └─ .composer-actions：✦灵感 + 发送⏎/停止
├─ #btn-help 右下浮钮 ｜ #gallery 画廊抽屉 ｜ #theme-pop 主题弹层(.swatch-grid+明暗三选)
├─ #guide 帮助模态(help-tabs 双页) ｜ .confirm 确认框 ｜ .confirm.wizard 三步向导
├─ .lightbox 大图 ｜ 灵动岛层(.toast 通知 + #island-busy 生成中)
└─ 设置窗口（独立窗 body.settings-win）：.modal-head(44px+重置+min/max/close 46×44贴角)
    + .modal-tabs 四页签 + .modal-body(.set-group 表单组/.row/.mini/.test-result/
    .model-dropdown 筛选列表/.models-pick 清单勾选)
```

## 三、现有设计令牌（基准面；可换值、增变量，不可删变量名）

```
色彩 --bg --panel --panel-2 --border --border-strong --text --text-dim --text-faint
     --accent(琥珀#c98b4b) --accent-dim --accent-glow --accent-hover --on-accent(主钮前景,保AA)
     --danger --danger-btn --ok --overlay
海拔   --surface-1/2/3(由panel推导) --shadow-1/2/3 --shadow-float
形     --radius-sm:8px --radius-md:12px --radius-lg:16px --radius-xl:20px (+data-radius 三档覆盖)
动     --ease-out:cubic-bezier(.16,1,.3,1) --ease-spring:cubic-bezier(.32,1.35,.35,1)
字     --sans(Segoe UI/PingFang SC/雅黑) --mono(Cascadia) --font-size:14px(可缩放) --read-w:720px(三档)
图标   16px 网格 / 1.5px stroke / currentColor / round cap；.ic-sm 12px .ic-lg 16px，全部内联 SVG
```
7 调色板（data-palette × data-theme 各出 dark+light）：**classic 经典(琥珀) / paper 羊皮纸(米金) / forest 林间(苔绿) / violet 紫晶 / ocean 海渊 / rose 蔷薇 / contrast 高对比(金黑)**。首用联动：paper→衬线、forest→宽松、contrast→紧凑（toast 告知可改回）。

## 四、动效系统（语义全部保留；曲线/时长可统一）

| 动画 | 用途 | 现值 |
|---|---|---|
| **Splash 全套** | 入场仪式 | 5.2s 主展开(cubic-bezier(.22,1,.36,1))+3.5s 扫光+4.2s 信号+7s 呼吸底光，点击后缩放1.010淡出 |
| **灵动岛 in/out** | 通知 | .55s spring 入 / .3s 滑退，玻璃胶囊 |
| **island breath/scan** | 生成中 | 2.4s 呼吸光环 + 1.4s 流光 |
| modalin/fade | 弹窗 | .3s，上浮12px+缩放.985 |
| drawerin | 画廊抽屉 | .35s spring 右滑入36px |
| msgin | 消息进场 | .25s 上浮6px |
| wizfwd/wizback | 向导翻页 | .22s ±18px |
| shimmer/blink/busydot | 骨架/光标/等待点 | 1.4s/1s/1.1s |
| popin/out | 小浮层 | .14s |
| zoomin | 灯箱 | .2s .94起 |

## 五、硬性约束

1. Electron+原生 HTML/CSS/JS，**无框架**；样式集中单文件，靠 CSS 变量换肤。
2. 无边框窗自绘标题栏，拖拽区 `-webkit-app-region`；主窗 1120×760(min380)；设置独立窗 614×461(4:3)。
3. CSP 禁外链：**无网络字体/图标库**，只能系统字体栈 + 内联 SVG。
4. **所有类名/ID/DOM 结构冻结**（自动化测试依赖）；你只能改视觉层。
5. 380px 极窄窗（侧栏收起+进度条）到最大化全可用；614×461 小窗内四 Tab 表单密度舒适。
6. 全部 14 套主题文字对比 ≥ WCAG AA；焦点环可见；`--on-accent` 深浅模式分别验证。
7. 系统开启「关闭动画效果」时 Splash 与灵动岛仍完整播放（现状即如此，保持）。
8. 深色为默认气质（黑底+琥珀），浅色须同样成立；纸质感/书卷气优先于科技感。

## 六、交付要求（按此结构逐项输出）

1. **设计原则** 3~5 条（锚定"安静书卷气+仪式感"，说明取舍）。
2. **完整 Design Token 表**：沿§三变量名给出 7 调色板 × dark/light = **14 套全量色值**（含 surface 三档、阴影三档、overlay、accent-hover、on-accent 及 AA 验证依据），并补充你认为需要的衍生变量（如 hover/active 透明度刻度、玻璃材质 blur/描边高光参数）。
3. **字体与排版**：字阶表（14px 基准）、行高、字重策略、中英混排与标点规则、衬线体切换方案、消息正文的阅读优化（720px 列宽下的行长验证）。
4. **组件规格书**：对§二每个组件给出：尺寸/内边距/圆角/描边/投影 + hover·active·disabled·选中·加载·错误 六态 + 深浅两模式示意说明。重点细画：**选项按钮（键位徽标体系）、消息气泡的"你/世界"双方识别、灵动岛玻璃材质、生成中胶囊、进度条节点、模型 chip、设置窗表单、向导三步卡、画廊卡片**。
5. **图标语言**：16 网格线条图标规范（线宽/端点/圆角/视觉密度），列出需要新增的图标清单。
6. **动效规范**：把§四统一到 2~3 条缓动 + 时长刻度（如 120/200/300/550ms），逐组件标注用哪档；Splash 与灵动岛曲线不得弱化；给出统一的进场/离场/刷新三语言。
7. **空/加载/错误/成功四态**：统一图形语言（可用 CSS/SVG 实现的克制方案，不引外部图）。
8. **落地映射**：所有产出表达为「CSS 变量区块 + 关键组件 CSS 片段」，可直接替换进现有 styles.css；不改 DOM。
9. **验收自查表**：对照§五逐条自评通过。

输出语言：中文。格式：结构化 Markdown，token 用代码块，规格用表格。
