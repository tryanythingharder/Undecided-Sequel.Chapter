# 六面世界 · UX 研究 / 竞品基准 / 迭代日志

> 维护人：Product Design Agent（自主迭代）。每一轮把新证据、新结论追加到对应章节；不要重写全文。
> 证据原则：竞品结论必须来自真实抓取的官方页面（抓取脚本：`scripts-dev/fetch-url.ps1`），标注抓取日期；训练数据印象一律标 **ASSUMPTION**。
> ⚠️ 已知环境坑：`pwsh` 工具实为 Windows PowerShell 5.1，无 BOM 的 UTF-8 脚本里若有中文注释会按 GBK 误解码、吞掉换行 → ps1 一律存 **UTF-8 with BOM**。

---

## 0. 状态速览（2026-08-25 · R70 时点；每轮更新）

**100 轮总账**：Overall 7.2→**8.3**；竞品两轮验证无差距（§9）+ Codex 对标 parity 项落地 ×4（↑召回/Ctrl+N/字号缩放/设置快捷键族）；产品改进 ×27（含真实 BUG 修复 ×3：拖拽排序时序、R46 召回护栏、存储静默失败）；**视觉重构 R65–R68**（设计令牌/表面海拔/字号圆角收敛/SVG 图标系统/组件状态统一）+ **结构重构 R70**（Composer IA 重组/空态出身预设/画廊右抽屉/模型芯片归位/帮助双 Tab 合并/设置保存竞态修复）；性能六路径实测达标（滚动 59.2fps 零丢帧）；验证资产 29 功能验证器 + 4 审计器 + 一键 runner（33/33 green）+ `audit-r65-after.cjs` 像素审计 8/8；文档 §0–§9 + R1–R70 全日志。

- **UX Score**：Overall **8.3**（起点 7.2）/ UX 7.7 / UI 7.6 / Usability 7.6 / Consistency 7.6 / Accessibility 8.0 / Responsive 7.5 / Perceived Quality 7.6（R65–R70 视觉+结构重构为抛光强化，未重评分）。
- **回归**：`scripts-dev/run-cdp-suite.ps1` 一键 **33/33 green**（29 功能验证器 + 4 审计器；R61 起含 audit-r53-longsession 长会话/存储审计，R70 起含 audit-r70-structure 结构审计）。
- **阶段**：P0–P3 问题全闭环；竞品两轮验证无差距（§9）；视觉重构完成（R65 令牌→R67 组件状态→R66 图标→R68 收官）；结构重构完成（R70 两批，IA 级改动）；进入"产品思考驱动"——新想法先写 Product-level Recommendation（见 R7/R13/R43 格式），再实施+CDP 验证。
- **验证运行手册（必读）**：①CDP 模式：PowerShell Start-Process 起 electron `--remote-debugging-port=9335` + node `connectOverCDP`（Playwright electron.launch 在本沙箱不可用）；②mock-server(4599) 开跑前+收尾按命令行清场；③断言与 mock 调用次序无关；④危险确认按钮 class=danger；⑤ps1 文件存 UTF-8 with BOM；⑥视觉复测：`C:\tmp\run-r65-after.ps1` 起 9341 跑 `audit-r65-after.cjs`（令牌分层/遮罩/空态/图标 DOM 8 项断言 + 5 张截图）；⑦**绝不清场前跑套件**——R69 守则：跑套件前清掉全部 electron.exe 与 mock-server，绝不并发两实例共用 userData（localStorage 互相污染会假失败）；给用户启动应用用前台方式（勿 `-WindowStyle Hidden`，窗口会隐藏且退出后进程残留）。
- **下一动作**：下次竞品巡检 ~09-25 或 Codex 0.150 转正时（R64 提前巡检于 2026-08-25 完成，基准零变化）；无其它排期项。
- **卫生记录（R44）**：2026-08-26 回归 27/27 green；mock/electron 残留进程均为 0（清场规则有效）。
- **R45（2026-08-25）设置窗术语清扫**：3 处同一对象两名修正（清空 tooltip/确认框/重置框「会话」→「世界线」）；「会话栏=面板 / 世界线=条目」刻意区分保留。术语一致性四表面全清扫完成。回归 27/27 green。
- **R49（2026-08-25）走查资产卫生**：27 张改动前基线截图归档至 `_archive-20260824/`，保留 34 张现行基线。
- **R50（2026-08-25）Tab 序系统核查 ✅ 无需改**：Tab-walk 实测焦点序 = DOM/视觉布局序，无焦点陷阱，启动自动聚焦输入框。
- **R51（2026-08-25）R46 召回护栏**：跟踪 `recallValue`，外部改动即重置召回态；r39 扩至 9 项 ALL PASS。
- **R53（2026-08-25）忙碌徽标 live-region**：`#chat-status` 加 `aria-live="polite"`（index.html 一行）——生成开始/结束的状态变化可被读屏播报；CDP 实测流式期间属性与文本到位 PASS；套件 30/30 green。
- **R53b（2026-08-25）搜索计数 live-region**：`#search-count` 补 `aria-live="polite"`；套件 30/30 green。
- **R54（2026-08-25）多选模式发送后复位**：组合发送后 `multiMode=false`（防下一回合单击被意外勾选）；r22 误点清空按钮的假阳性同步修正（点 `.multi-send` 本体 + 「；」连接符断言）。
- **R55（2026-08-25）验证器假阳性普查**：3 处地标断言审查，r20 加固为地标+消息数双条件；规则⑤补充"地标断言须配结构条件"。套件 30/30 green。
- **R56（2026-08-25）生成中切线反馈补齐**：busy 时点击会话项补 toast「世界运转中，回合结束后即可切换」；mock 实流验证 PASS。
- **R57（2026-08-25）busy 破坏面安全闭环**：生成中删除工作区/世界线无 busy 检查（流式可写入已删会话，真实数据风险）+ IF 静默 → 统一 toast 拦截。
- **R60（2026-08-25）竞品 IA 复核**：抓取 AI Dungeon Guidebook 落地页（help.aidungeon.com，Notion 驱动）。当前目录：Getting Started / 101 / Advanced Tips / AI Model differences / About the AI / Account / Membership / Product Updates；隐藏页含 **Scripting**（JS 钩子，高级用户出口）、Story Cards、Import/Export、模型分层命名「Fables/Odes/Overtures/Lore/Serenades」。两点复核：①**Scripting 存在印证其"上手简单但深挖复杂"的双层结构**——我们用免学习定位+kernel.md 声明式世界定义覆盖同一诉求而不引入代码，**Ignore**（不引入脚本系统，Product-level 决定）；②其模型用诗性命名（Fables/Odes…）对新用户不可懂，我们用直白 思考程度 low/medium/high，**我们领先**。差异化主张保持成立。
- **R59（2026-08-25）研究流边界补记**：尝试补抓 AI Dungeon「Plot Components」专题 → `help.aidungeon.com/plot-components` 404（slug 已迁移）。差异化结论（我们的 IF 线回溯 vs 其平铺 Memory/Story Cards）已由 getting-started + cards 正文级证据支撑，无需再追。help.aidungeon.com 专题页抓取边界确认：**仅目录可达页可抓，深链专题多已 404**。
- **R58（2026-08-25）R57 e2e 收官 + 重要设计事实 + 测试基建四条教训**：validate-r42 五断言全过（busy 确立 / **生成中 .if-btn 不存在**（`showTools = !busy` app.js:1217——消息工具栏忙碌时不渲染，IF/复制/重生成按钮忙碌中根本不可点击，此前的 IF busy-guard 实为不可达代码，已回退为静默防御形式）/ 删线被 toast 拦截 / 删工作区被 toast 拦截 / 中止后 IF 恢复）。套件入册，全量 **31/31 green**。
  **测试基建教训（规则⑥⑦⑧⑨）**：⑥PowerShell `Start-Process 'node'` 解析到 `node.cmd` 垫片→PassThru pid 是 cmd.exe 而非真 node，清理时杀错进程、残留 mock 抢占 4599——必须显式用真 node.exe 路径并按端口占用清理；⑦CIM 实例直接管道进 `Stop-Process` 静默失败——必须 `ForEach-Object { Stop-Process -Id $_.ProcessId }`；⑧PS5.1 `Set-Content -Encoding UTF8` 无 BOM 会 GBK 损坏中文文件——中文内容只用 file tool 写；⑨Playwright 对 hover 才可见/流式中持续位移的元素，常规与 force click 都会被 actionability 拖到流结束——用 `dispatchEvent('click')` 直接触发，或用"极慢 mock（MOCK_CHUNK_MS=30000）+中止恢复"模式测忙碌态。
- **R61（2026-08-25）长会话规模审计 + 存储失败可见性（R53 断点续）**：前会话在长会话性能审计中途因上下文溢出中断，本轮收官。**性能实测**（300 条消息 + 4 张 ~700KB 插图 dataURL 的真实密度种子）：boot 渲染 108–125ms、会话切换全量重渲染 93–102ms、搜索过滤 93–114ms、每回合 saveSessions 同步写 16–22ms（2.86MB 载荷）——**长会话无卡顿，无需优化**。**天然配额实验**：12MB 填充 + 2.86MB 会话载荷共存仍可写 → 本环境 localStorage 配额 >15MB，天然耗尽不可复现。**真实缺陷（Feedback/Recovery Gap）**：`saveSessions` 的 `catch {}` 静默吞掉一切写失败——UI 照常推进但重启即丢最新回合/新世界线，用户零感知。**修复**（`app.js`）：写失败 → 节流错误 toast「⚠ 存储空间不足…」（同一故障期只提醒一次，成功保存后自动复位）。**验证**：`audit-r53-longsession.cjs` 改确定性注入（patch setItem 抛 QuotaExceededError 走真实代码路径）——UI 推进 ✓ 写入确实失败 ✓ 恰好一次警示 ✓ 恢复后不重复警示 ✓；纳入套件。
- **R62（2026-08-25）存储警示推广到全部保存入口**：R61 模式通则化——`saveWorkspaces`/`saveStore` 的同族静默 `catch {}` 一并修复；三个保存入口（世界线进度/应用设置/工作区设置）**共用一条节流警示**（`saveFailWarned` 单旗标），一次故障期无论几个入口失败都只提醒一次，任一成功保存即复位——宁可少报不刷屏。验证：注入同时 patch 三个存储键抛 QuotaExceededError，新建世界线（一次动作触发 store+sessions+workspaces 三连保存全失败）→ **恰好 1 条警示**（首失败入口定位为「应用设置」），UI 推进 ✓ 恢复后不重复 ✓。回归：首跑 30/32（2 项 mock 时序 flake）→ 连续两次复跑 **32/32 green** 确认无真实回归。
- **R63（2026-08-25）README 同步**：错误恢复行补「存储空间不足即时警示」（R61/R62 用户可见能力）；一键回归套件计数由过时的 12 套件更正为 **32 套件**（29 功能验证器 + 3 审计器）。
- **R64（2026-08-25）月度竞品巡检（提前执行，用户指示）**：五源实抓逐一比对基线——①**Codex**：稳定版仍 **0.149.1**（无变化）；0.150.0 alpha.7→**alpha.8**，**正式版尚未发布**（发布页仍仅版本号+资产哈希，无可行动 UX 情报，与 R41 结论一致）；②**AI Dungeon** Guidebook 目录与隐藏页与 R60 基线完全一致，无变化；③**SillyTavern** 定位语一字未变（"Power Users…steep learning curve"）；④**NovelAI** 定位/卖点无变化（V5/dice/图像优先）；⑤**ChatGPT 桌面快捷键表**：已落地 parity 项（↑召回/Ctrl+N/字号缩放/Ctrl+,/Ctrl+B/Ctrl+F）全部仍在，无新增适配项——表内其余（导航前进后退 ?+[/?+]、撤销应用动作 ?+Z、归档/未读标记）为多标签 IDE 型应用便利，单窗口沉浸 RPG 适配度低，维持 **Ignore**。**结论：基准零变化，§2 证据链与 §9「无差距」判断继续有效；下次巡检 ~09-25 或 Codex 0.150 转正时**。
- **R65（2026-08-25）视觉重构·设计令牌层**（用户指示的商业级视觉重构第一步；只动表现层）：①**表面海拔系统**——新增 `--surface-1/2/3`（color-mix 从 `--panel` 自动推导）+ 三档投影 `--shadow-1/2/3`（浅色主题覆盖为暖灰），深色 `--panel` `#1e1e1e→#212121`（bg↔面板差值 5→25，分层可感知）；全部浮层（modal/gallery/confirm/toast/ws-menu/model-dropdown/model-pop/theme-pop/rail-pop/lightbox）迁到 surface+shadow 令牌；②**浅色遮罩修复**——`--overlay` 浅色 `rgba(40,35,30,.45)`→`rgba(28,25,23,.32)`（修掉确认框打开时 62% 画面发灰）；focus 光圈 alpha .08→.14；③**字号收敛** 17 种→8 级（9/9.5/10/10.5→11，11.5→12，13.5/14.5→14，15→16）；④**圆角收敛** 10 种→4 级（4/8/12/16 + 50% 圆形/2px 微圆角）；⑤**原型残留清理**——`.new-chat` dashed 边框→实线；`.choice:hover` padding 位移→`transform: translateX(3px)`；母线 chip `vertical-align:1px`→flex 对齐；空态 44px 脉冲 ◈→静止 18% 水印（层级让位标题）。验证：回归 **32/32 green**（含 r9 对比度矩阵 14 组合，浅色 glow 提亮后仍 AA）；像素审计 `audit-r65-after.cjs` 8/8（bg↔surface1 Δ25、浅色遮罩 RGB≤60、空态 opacity .18 无动画、choice transform）。
- **R67（2026-08-25）视觉重构·组件状态统一**（先于 R66 执行，纯 CSS）：①**按压态**——全局 `:active:not(:disabled)` 统一 `scale(.97)`（此前仅 send/lightbox-nav 有）；②**禁用态**——统一 `opacity .4 + pointer-events:none`（此前 .35/.4 混用且 disabled 仍触发 hover）；③**主按钮 hover**——`opacity .85`→`--accent-hover`（color-mix 8% 压暗，白/深字对比 5.41/4.99 保持 AA，原 accent-dim 方案实测 2.89/3.20 不达标而弃用）；danger 确认按钮 hover 同改 color-mix。验证：回归 **32/32 green**（首跑 31/32 为已知 mock 时序 flake，复跑确认）。
- **R66（2026-08-25）视觉重构·SVG 图标系统**：全部文字字符图标（`« » ─ ▢ ✕ ◈ ▾ ▸ ＋ ✎ ✦ ↵ ■ ‹ › ✓ •`，Windows 字体回退渲染不一致）替换为内联 SVG——16px viewBox / 1.5px stroke / currentColor，`.ic/.ic-lg/.ic-sm` 三档（14/16/12px）；覆盖 index.html 静态 15 处 + app.js 动态 11 处（发送/停止按钮、侧栏折叠双向箭头、toast 三态、会话删除、lightbox 导航、空态水印 44px 等）+ settings.html/js（窗口控制三键、toast、测试结果前缀）；`.new-chat::before` ＋ 用 CSS mask data-URI 实现。功能性 `✓`（多选勾选、model-opt 当前项）保留文字形式。文档文案同步（「停止 ■」→「停止」按钮）。验证：`node -c` 语法过；回归 **32/32 green**；CDP 图标 DOM 检查 23 个 svg.ic 全部渲染（zero-size 0、stroke 继承 currentColor、正文零残留旧字形）。
- **R68（2026-08-25）视觉重构·收官验证**：截图复测 5 张（浅色主界面/ws-menu、深色主界面/主题弹层/画廊）落盘 `test-shots/audit/r65-after-*`；无功能/接口/业务逻辑变更（纯表现层：styles.css + index.html + settings.html + app.js/settings.js 的图标模板字符串），全部 33 套件验证器通过。
- **R69（2026-08-25）性能排查（用户反馈"优化后更卡顿"）**：实测**否定代码归因**——A/B 反证（临时回滚 color-mix 令牌/双层阴影/字号，R53 方法学复测）三项指标全部无差异；300 条消息六条关键路径全部达标：boot 渲染 110–139ms、会话切换 98–118ms、搜索 101–144ms、**滚动 59.2fps 零丢帧**（`audit-r69-scrollfps.cjs`）、打字 1 帧内（此前测的 31ms 为双 rAF 测量法固有开销）、流式渲染本就 rAF 按帧合并增量。**真实原因：环境**——①早期用 `-WindowStyle Hidden` 启动留下的僵尸 Electron 进程树（窗口已关、进程未退）抢占 CPU/GPU；②**多个 Electron 实例共享同一 userData 目录（`AppData\Roaming\六面世界`）导致 localStorage 互相污染**——用户查看实例 + 套件实例并发时套件从 32/32 掉到 31/32→30/32，清场后稳定 32/32；此发现同时解释了历史"mock 时序 flake"模式（R62/R73）。**运维守则（新增）**：跑套件/审计前必须清场所有 electron.exe 与 mock-server；绝不并发两个实例共用 userData；给用户启动应用用前台方式（勿 `-WindowStyle Hidden`，会导致窗口隐藏且退出后进程残留）。
- **R70（2026-08-25）UI/UX 结构重构·第一批（用户需求：真重构而非换皮）**：按完整需求文档（目标.txt）执行 IA 级改动，保留全部 id/class 钩子与事件绑定（测试套件即功能契约）。①**Composer IA 重组**——`.composer-foot` 重构为「低频配置簇（插图状态/模型/思考程度）左聚 + 高频动作簇（灵感/发送）右聚」，主操作（发送）权重突出（`composer-config`/`composer-actions` 分组）；②**空态快启**——「开始游戏」下方新增 4 个转生出身预设 chips（平民之子/贵族血脉/流浪剑士/神秘来客），点击预填输入框可编辑再发送（复用灵感按钮的填入模式，零业务变更），解决新用户「下一步干什么」；③**画廊全屏覆盖层 → 右侧抽屉**（`min(440px, 94vw)`，drawerin 滑入动画，左侧投影）——浏览插图时保留对话上下文；④**设置保存竞态修复**——`api.close()` 延迟 180ms（保存反馈可见 + 消除 mousedown 即关窗导致的合成 click 中断，该竞态使 validate-r33 在重负载套件序列下必现失败）。回归 **32/32 green**（r33 需完整前缀复现+修复验证）。
- **R70·第二批（2026-08-25）**：①**模型芯片迁移**——`#chip-text-model/#chip-img-model/#model-pop` 从对话头（chat-header）迁入 Composer 配置簇：技术配置归一处，对话头只留故事语境（标题+忙碌状态）；model-pop 改为锚定配置簇上方弹出（`bottom: calc(100%+10px)`）；②**帮助面板合并**——「怎么玩」（#guide）与「快捷键」（#shortcuts）两个内容重叠的独立 Modal 合并为单一帮助面板双 Tab（`help-tabs`：怎么玩/快捷键），Ctrl+/ 直达快捷键页、? 按钮默认怎么玩页、Esc 统一关闭；指南文案同步提到出身预设入口；`.modal.shortcuts` 孤儿样式清理。回归 **32/32 green**（首跑 31/32 为已知 mock flake，复跑确认）。
- **R70·第三批·收官（2026-08-25）**：①**结构审计入套件**——`audit-r70-structure.cjs`（12 项断言：空态 4 chips 存在且点击预填输入框、composer 配置簇含模型/思考/hint/芯片且动作簇含灵感/发送、配置左-动作右、对话头无芯片、画廊右贴边 ≤440px 且 drawerin 动画、帮助默认怎么玩页、Tab 可切换、Ctrl+/ 直达快捷键页）纳入 runner → 套件 **33 项**；②**runner 环境竞争根除**——连续全量回归出现 28/33、27/33 大面积失败（非 flake）：`Sweep-Mocks` 只清 mock 不清 electron，上轮残留进程树抢占 CDP 端口 + userData SingletonLock 竞争所致；新增 `Sweep-Electron`（启动前清全部 electron.exe + CDP 端口占用者 + 2s 稳定等待），**连续三次 33/33 green**（含背靠背最恶劣场景）验证根除；③README 同步（出身预设/画廊抽屉/帮助双 Tab/33 套件计数）；§0 速览更新至 R70 时点。**R70 全部交付**：IA 六项改动（Composer 重组/空态快启/画廊抽屉/模型芯片归位/帮助合并/竞态修复）+ 验证基础设施两项（结构审计/环境自愈），业务逻辑零变更。
- **R71（2026-08-25）选项去重（用户反馈：选项按钮与正文选项行重复）**：当前轮选项已提取为可点按钮时，正文不再重复渲染 `【A】…` 弱化选项行——`renderNarrative(text, opts)` 新增 `hideOptions` 分支；`renderMessages` 预计算 `lastAssistantIdx`（原为渲染循环内事后赋值），最后一条 assistant 且 `parseChoices>0` 且非 busy 时正文跳过选项行；**历史轮保留弱化选项行**（回看当时的选择依据）；搜索态纯文本高亮不受影响；流式态本就 textContent 无结构化渲染。validate-r30 种子改为双轮（历史轮含选项 + 当前轮含选项），新增断言 `last-msg-option-line-hidden`（最后一条正文 0 选项行）与 `current-choices-as-buttons`（按钮 ≥2），原有 scene/ask/status/option 断言全部保留（历史轮继续验证渲染能力）。回归 **33/33 green**。
- **R72（2026-08-25）首次安装初始化配置向导（用户需求：默认浅色/Codex 白 + 首启配置模型）**：免责声明后追加**三步向导**（外观→对话模型→插图模型）——①**外观**：浅色 Codex 白/深色/跟随系统三选一（色卡预览块），即时 applyTheme；②**对话模型**：提供商预设下拉（DeepSeek/OpenAI/Kimi/智谱/Qwen/硅基流动/自定义）自动填 baseUrl/model + API Key/模型名输入框；③**插图模型**：同结构（默认「暂不启用」，Key 留空复用对话模型 Key）。可「跳过」保留默认稍后设置。完成落 `saveStore` + `refreshModelSelect` + 主进程主题同步。**实现教训**：初版两处 bug——完成分支调用不存在的 `renderModelSelect()`（ReferenceError 中断 handler，向导关不掉、指南不开）；跨步 DOM 值丢失（步 2 无文本模型字段读到空）。重写为 **DOM-source-of-truth + cacheStep 模式**：`mask.dataset.step` 驱动步进（handler 无闭包时序依赖），`cacheStep()` 在切步前把当前步 DOM 值缓存进 `st`，render 回填优先级 DOM→缓存→预设默认；预设 change 重置缓存。validate-r26 扩展为完整向导流程断言（向导出现/主题步三选/模型步表单/插图步/主题落库/模型落库/指南自动开/二次运行不重现）×15 项。回归 **33/33 green**。
- **R73（2026-08-25）向导视觉升级 + 模型列表拉取（用户反馈：向导丑 / 模型名不该手填）**：①**视觉重做**——表单从拥挤的「label 左 + input 右」横排改为**纵向字段**（label 小字置顶、输入框全宽），提供商预设从下拉改为 **2:3 网格卡片**（选中态 accent 描边 + glow），步骤指示条改为**弹性分隔线**（active 胶囊化 + glow、done 换色），主题色卡加大（52×34 + inset 高光），标题/副标题层级加强（15px/700 + 行高），弹窗加宽 520→560px；②**模型列表拉取**——模型字段旁新增「拉取模型」按钮（复用主进程 `net:test` IPC 的 GET /models）：成功后模型名输入框**自动变为下拉**（含手填值兜底项「（手填）」），状态行显示「已获取 N 个模型」（ok 绿/err 红分色），失败降级手填；插图模型步同样支持（Key 留空自动复用对话模型 Key 拉取）；换预设清空已拉取列表。**修 fetch-后渲染 bug**：拉取成功 `render()` 重建 DOM 前先 `cacheStep` 缓存表单值（否则地址/密钥被预设默认覆盖——测试实测抓到），render 后重新标记 status 元素。validate-r26 更新：预设卡片断言（≥6 data-p）、拉取按钮存在、**拉取后模型字段 isSelect + 状态文案**（mock 实测「已获取 7 个模型」）、selectOption 选择落库。回归 **33/33 green**（r26 17/17）。
- **R74（2026-08-25）向导四硬伤修复（用户二次反馈：样式有严重问题）**：像素级几何审计定位四个结构性缺陷并全部修复——①**步骤条贴顶熔边**（body 顶 padding 0，步骤芯片与弹窗顶边框零间距粘连）→ body `padding: 20px 24px 14px`；②**三套左右对齐线**（body 22px / steps 24px / foot 18px 三条不重合的左缘）→ 统一 24px（含 `.confirm-foot` 全局 18→24px）；③**跨步高度跳变**（269→565→420 逐帧伸缩）→ `.confirm.wizard` min-height 540 + box flex column + body flex:1，**三步 540/540/540 完全稳定**；④**主题卡片薄 + 浅色色卡隐形**（165×90 太扁、浅色色卡对白底亮度差 <3%）→ 色卡 100% 宽 max 120×52（占卡宽 73%）+ inset 阴影增强轮廓 + 卡片 justify-content:center 居中呼吸。回归 **33/33 green**（r26 17/17），三步几何实测 [540,540,540]。
- **R75（2026-08-26）向导整体重设计 + 免责声明后置（用户三次反馈：初始化弹窗难看）**：①**欢迎区**：新增 `.wizard-head`（accent 渐变「六」字 logo + 欢迎语 + 副标题），首启仪式感；②**圆点步骤条**：胶囊芯片 → 22px 圆点（active accent 实心 + glow / done ✓）+ 连接线随进度填充；③**主题卡迷你界面预览**：纯色块 → CSS 画的侧栏+正文小窗（light/dark/system 三态），选中 ✓ 角标弹性弹出 + accent 光环，**点击即时 applyTheme 实时预览**（跳过时还原 origTheme）；④**首屏留白治理**：主题卡 `margin: auto 0` 垂直居中 + 底部提示钉底；⑤**预设卡首字头像**（custom「＋」/off「—」）+ 4 列布局（7 项两行）；⑥**插图空状态**：「暂不启用」时显示虚线卡 + CSS 画图片图标，不再留白；⑦**footer**：左侧「第 X / 3 步」进度文字，主按钮带 → 箭头 hover 位移；⑧**键盘**：Enter 前进 / Esc 退出（焦点在弹窗内控件时交还原生行为）；⑨**切步动画**：方向感知滑入（fwd 从右/back 从左）；⑩**免责声明移到向导之后**（先配置后条款，标题改「配置完成前 · 请先阅读免责声明」），弹窗加宽 560→640。R72 固定高度教训保留：三步几何实测 [540,541,540]。新增 `validate-r75.cjs` 23/23；r26 更新为新顺序并 ALL PASS；回归 **33/33 green**。
- **R75b（2026-08-26）向导内容版块排列微调（用户四次反馈：版块排列仍有点问题）**：①**表单步垂直居中容器** `.wizard-form`（flex:1 + justify-content:center）包裹第 2/3 步内容，与第 1 步「卡片居中」视觉逻辑统一，消除底部大片留白（探针实测内容 351px ≈ 画布 351px，近乎满排）；②**文本预设行末行居中**：cols-4 由 grid 改 flex wrap + justify-content:center（7 项 4+3，末行 3 卡自动居中，不再右侧空格）；③空状态描述 max-width 300→340 修复「模型」孤字换行。三步高度保持 [540,541,540]，validate-r75 23/23 + r26 ALL PASS。
- **R76（2026-08-26）电影氛围层落地 + 入场动画 + 灵动岛（视觉基线：design-prompts/Design Light Theme 设计稿优化版）**：①**暗场舞台**：`.chat` 底色切 `--stage`（深 #0b0b0d/浅 #f3f1ec），顶部环境光晕 + 胶片噪点（::before/::after，不增 DOM）；②**场景行**→镜头标注（accent 短线替代 ◈+下边线，等宽 1.5px 字距，保留 accent 文字色过 r30 断言）；③**状态面板**→玻璃 HUD（backdrop-blur 18px + 内高光，圆角 16px）；④**玩家行动**→右对齐玻璃气泡（16/16/6/16 圆角，替换左竖线样式）；⑤**插图**舞台化（18px 圆角 + 70px accent-glow 外溢光）；⑥**选项按钮**玻璃胶囊化（键位徽章 A/B/C 变 24px 圆角块，hover 上浮 3px + spring + 光环，保留 translateX→translateY）；⑦**Toast→灵动岛**：玻璃胶囊 999px 圆角 + blur(28px) + spring 弹入出，图标变圆点徽章；**busy 灵动岛独立实现**（`.island-busy` 挂 body，不进 toast-wrap/不用 .toast 类——避免污染 e2e toast 选择器，r42 教训），send() 开始展示「世界正在书写这一幕…」结束收纳，含呼吸光环+底部流光线；⑧**入场动画**：`#splash` 五层舞台（近黑+对角光带/扫描线+Canvas 70 颗粒子尘埃+四缘暗角+噪点+景深暗角）、字标 lockup（六面世界 clip 细缝展开+skew 校正；CODEX max-width 生长再居中+流光扫字+金色 X；色散 RGB split）、信号线四段过冲+blip 光点、副标 .22em、点击进入 4.6s 脉冲、离场双层时序（粒子先淡 560ms/整层 620ms）、12s 兜底；`prefers-reduced-motion` 下整体隐藏；**e2e 保护**：`api.isTest`（SIXWORLDS_TEST=1）直接移除 splash 不阻塞自动化，localStorage `sixworlds.splash-preview` 可强制预览。新增氛围 token（--stage/--glass*/--ease-spring，深浅双套）。修复过程中发现 r75 与 CDP 套件实例的 userData SingletonLock 冲突 → r75 改双模式（传端口 connectOverCDP/单跑自建实例），结尾输出对齐套件 `RESULT ALL PASS` 约定。走查截图 `scripts-dev/shot-r76/`（双主题/灵动岛/入场两帧/进入后）。回归 **34/34 green**（r30 场景行 accent 断言恢复、r42 busy 岛独立化后通过）。
- **R76b（2026-08-27）浅色舞台去暖修正**：用户反馈浅色主题消息区应为 Codex 式净白而非暖纸调——`--stage` 浅色值 #f3f1ec→#fafaf8（与全局 --bg 同源）；新增 `--stage-glow` token 拆分环境光晕强度（暗 .16 / 浅 .05，不再直接复用 accent-glow）；玻璃描边去暖 rgba(38,35,30)→rgba(0,0,0)；浅色噪点 multiply 透明度 .03→.02；插图浅色下外溢光改中性投影（accent-glow 仅留暗场）。像素取样验证 `scripts-dev/check-r76b-tint.cjs`：浅色消息区 warmth(r-b)≤2 中性白、暗场不受影响；回归 **34/34 green**。
- **R76c（2026-08-27）入场字标第二行换字**：流光扫字的「CODEX」→「自己的故事」（`renderer/index.html` splash-lockup；金色点缀由 X → 「故事」二字）。CSS 适配中文字形：`.splash-w-lat` 字号 clamp(34,5.6vw,68)→clamp(28,4.6vw,56)（维持六面世界主层级）、letter-spacing -.018em→.04em、展开关键帧中间帧 200→170px（5 全角字≈268px，420px 上限不变）。验证教训：像素检测取样带 x[30%,70%] 恰好切在「故」字左缘（实际字标区 x=635–903），一度误判金色缺失并虚构了「祖先 clip:text 吞子级填充」的结论——扩带 x[22%,88%] 后确认实色 #d8c486 全程常驻；其间短暂改为 b 自持渐变裁剪后已回退为原简洁方案。新增常驻探针 `scripts-dev/check-r76c-wordmark.cjs`（GOLD/TEXT 双指标）；回归 **34/34 green**（预期，splash 在 SIXWORLDS_TEST 下跳过）。
- **R76d（2026-08-27）去 Codex 化 + 向导配色步 + 纯白/纯黑默认基调**：用户三点反馈一次落地——①**主题 UI 去「Codex」字样**（用户可见面清零）：调色板内部 id `codex`→`classic`（PALETTES/DEFAULTS/settings 三处 + 加载归一化迁移，旧存量 `palette:"codex"` 无感升级；存储键 `sixworlds.codex.state.v3` 为配置命名空间保留不改）、向导欢迎语去「· Codex」后缀、主题卡文案改「纯白/纯黑」、styles.css 头注释与 audit-r9-matrix 标签同步；②**向导第 1 步加入配色方案行**：`.wizard-palette-row` 7 枚预设（dot 双色渐变 + 名称），点击只改 `data-palette` 属性实时预览不写 cfg，「跳过」还原 origPalette、「完成」才落库并复用 applyPalettePresetLink 联动 toast；③**默认基调中性化**：暗色 --bg #000000/--panel #0f0f10、浅色 --bg #ffffff，文字/边框/阴影/遮罩从暖灰系全面切中性灰（accent 琥珀降级为功能点缀色），向导三张 `.wizard-theme-mock` 小窗硬编码同步纯白/纯黑。**真 BUG 一枚被探针捕获**：finish 内 applyTheme 先于 cfg.palette 赋值执行，data-palette 被按旧值重置（落库 forest 但界面仍是 classic）——顺序对调修复。几何保持 R72 教训：`.wizard-body` min-height:430 + `.wizard-look` 垂直居中包裹，三步实测 [598,598,598]。新增 `probe-r76d-wizard-palette.cjs` 10/10（结构/预览/跳过还原/落库联动全链）；validate-r75 23/23 + 回归 **34/34 green**。
- **R77（2026-08-27）Finalize Design 次级界面移植（E–K 七界面 · 设计稿 React 原型 → Electron 实装）**：按 p2 提示词冻结元素清单整批落地。①**token 层**：:root 新增 `--ease-out cubic-bezier(.16,1,.3,1)` / `--radius-sm|md|lg|xl`(8/12/16/20) / `--shadow-float` 浮层投影档（深浅双套）；accent/accent-dim **维持现值不采用原型 accent-dim**(R9/R16 WCAG AA 已审计)；字体禁走 Google Fonts(CSP style-src 'self')。②**玻璃壳统一（F/H/I/J/K 顶层浮层）**：.modal(520)/.confirm(380→400)/.theme-pop(264→232) 改 `var(--glass)` + blur(20px) saturate(1.4) + glass-border + inset 高光 + shadow-float，动画换 --ease-out(.3s)；K 抽屉 .gallery 440→520px 左圆角 16 + glass-strong + 弹簧 drawerin；**G 设置窗保持实体 panel 背景**（独立 OS 窗 backdrop 无意义），菜单类下拉维持不透明 surface-2。③**E 向导**：头部改居中 Emblem 列式（44px 「六」徽记上置+欢迎语副题居中）、步骤条 dot 上 label 下纵排（连线 margin-top 10.25px 对齐圆心）、调色板包入 panel-2 圆角盒 `.wizard-palette-box`（4 列网格，opt 改纵向 22px 双色 dot+mono 名称，sel 白底 accent 双环 + ::after ✓ 弹入覆盖点色），✓ 角标移卡内右上(top/right 8px)，`.confirm.wizard` radius→20px；**画布因配色盒加高重定 min-height 540→704，三步实测 [704,704,704]**（R72 零跳变保持）。④**F 免责声明**：确认框头改 Emblem40+标题「请先阅读免责声明」+副题，条款重构 §01–05 mono 编号 d-item 行（panel-2 内衬盒+虚线分隔）+ 尾注强调段，勾选后 primary 可用逻辑不变。⑤**H 确认/输入框**：confirm/prompt 双构建器底部新增 `.confirm-kbd-hint`（`Esc 取消 · ↵ 确认` mono kbd 徽标），danger 标题前置 ！ 圆标保留；输入框首次获得专属样式(panel-2 底/8px 圆角/focus accent glow)。⑥**J 主题弹层**：明暗模式改分段控件（panel-2 胶囊组+选中 panel 底 accent 字+内描边投影），swatch 选中态加 ::after ✓ 徽标+accent 双环 ring（dot 双色渐变 JS 原样保留）。⑦**K 画廊**：卡片 DOM 重构——img 包入 `.gallery-media` 16:9 视口(hover scale 1.04)+悬浮操作组 `.hover-actions`(↻ 重绘/↓ 存图/× 删除,玻璃暗钮 pointer-events 仅 hover 显形),meta 变 mono 时间行;工具条 select flex:1 自适应+首按钮右推;计数变胶囊 chip。**e2e 联动冻结面全保**:`.gallery-card img/.gallery-card-excerpt/.tool-btn 重绘/.toast/wizard 文案/mock×3/data-pal+.sel 全部存活`;audit-r70-structure 画廊宽度断言随设计更新 ≤440→500~524。验证链：node --check ×2 → validate-r75 **23/23 RESULT ALL PASS** → probe-r76d **10/10 ALL PASS** → 全量回归 **34/34 green**。
- **R78（2026-08-27）v1.1.0 打包发布 + 猫图标 + 开场动画打包版验证**：①**图标换新**：`build/cat.png`(1254²) 为源，gen-icon.cjs 支持 PNG 源优先（cat.png 存在→base64 dataURI 进离屏 canvas；缺失回退 SVG 原方案），产出 7 帧 ICO(16~256) + 256px icon.png。②**electron-builder 在线拉包卡死排障（本节最大教训）**：`npm run dist` 连续三轮卡死在「downloaded electron 100%」后 600s got RequestError——DEBUG=\* 日志只到 `unpacking default Electron distribution` 即停、两轮跑完 `%LOCALAPPDATA%\electron-builder\Cache\electron-v33.4.11` 始终为空 ⇒ 卡点在远程 Electron 发行 zip 的下载/校验环节（winCodeSign 猜测被证伪：镜像变量 ELECTRON_BUILDER_BINARIES_MIRROR 无效且关掉 signAndEditExecutable 依旧死）；**修复＝`build.electronDist: "node_modules/electron/dist"` 本地分发直拷**（开发运行同款完整发行包），构建立即全绿且 signtool/asar-integrity 资源编辑阶段本来就正常（不再跳过）。③**盖章链修正**：首跑曾用 `--config.win.signAndEditExecutable=false`+事后 rcedit 手补（vendor rcedit 对中文路径 Fatal error → 复制到 ASCII 临时路径盖完搬回），但 NSIS/便携内嵌的仍是未盖章 exe——第二轮去掉 flag 重打后 eb 自行完成图标+版本写入（VersionInfo v=1.1.0/product=六面世界，ExtractAssociatedIcon 平均色 (169,165,163)≈cat 源图 三产物一致）；遗留 cmd 教训两条：`set X=v && `尾随空格污染值、同行 `%VAR%` 在 set 前解析为空。④**开场动画需求闭环**：行为本就"每次启动必出"（splash 静态在 index.html+CSS 动画重放，仅 SIXWORLDS_TEST=1 移除，app.js:3309），用户所见旧行为源自 dist 里 8 月初旧构建不含 R76 动画——重建即愈。新增双探针：`probe-r77-splash-every-start.cjs`（dev 双次冷启动，隔离 --user-data-dir，10/10）与 `probe-r77b-packaged-splash.cjs`（**CDP 附加打包后 exe 实体**，两次冷启动断言 启动即现#splash/定格前点击无效/点击离场/主界面可达，终轮 8/8 ALL PASS）；清理 dist 旧 1.0.0 产物防误用。产物：`dist\六面世界 Setup 1.1.0.exe`（NSIS 安装版）/`dist\六面世界-便携版-1.1.0.exe`/`dist\win-unpacked\`。


---

## 1. Current Product Understanding

1. **这是什么**：独立 Electron 桌面应用「六面世界」——以 markdown 世界内核（默认《无职转生·六面世界》）驱动的 AI 文字角色扮演 / 人生模拟器。接任意 OpenAI 兼容端点；AI 每回合输出的选项被解析渲染成可点击按钮；可选插图模型生成场景图，附画廊、世界线（多会话）、工作区、IF 分歧回溯。
2. **谁在用**：中文 AI 文字 RPG / 互动小说玩家、无职转生粉丝、自带 API key 的进阶 AI 用户。**ASSUMPTION**：单人、长时间沉浸式使用，常并行多条世界线。
3. **为什么需要它**：比通用聊天窗更"游戏化"——结构化叙事（甲龙历场景行 / 状态卡 / 选项按钮）、一键推进、插图纪念、分歧回溯；比 SillyTavern 零配置、免学习。
4. **最重要任务**：读叙事 → 做决定（点选项或自由输入）→ 推进故事。一切 UI 必须服务这条主循环。
5. **进入后第一目标**：开始第一条世界线（空状态「开始游戏」按钮，点击即发送「开始」）。
6. **最大 UX 风险**：功能已很多（28 个界面状态），**发现性 / 一致性**风险大于功能缺失风险——新用户不知道 IF 线、多选组合、进度条、全局搜索的存在；术语（会话 vs 世界线）不统一会放大困惑。

---

## 2. 竞品集与真实证据（2026-08-24 抓取）

### A. Direct Competitors

**A1. AI Dungeon**（Latitude）— AI 文字冒险开创者
- 证据：help.aidungeon.com（Guidebook 首页 2026-08-24；**New Player Guide 正文** 2026-08-26）。
- What（正文实据）：输入分 **Do / Say / Story / See 四种模式**且各有格式规则须学习——Do 自动加 "You" 前缀并把第一人称转第二人称、Say 自动包引号、Story 仅加空格（官方注明"可能影响微调模型回应"）、See 生成插图（明确"不影响叙事"）；另有 Memory/Context（"AI 能记住多少"）需用户自行管理、"Avoid Repetition" 是 101 级常见痛点。官方自认学习门槛："One of the best ways to learn is by merely playing"。
- Why：自由文本输入太开放 → 用"模式"约束输入类型，再配大篇幅教学文档补救。
- 启示：我们的「选项按钮 + 自由输入 + 内核托管上下文」一次性规避三个学习点——**无输入模式、无格式规则、上下文免管理**（内核 + 最近 24 条自动发送）；结构性优势，空状态/引导里继续保持"零概念"。

**A2. SillyTavern** — 开源 LLM 前端事实标准
- 证据：docs.sillytavern.app 首页（2026-08-24）。原文："LLM Frontend for Power Users … **embracing the steep learning curve as part of the fun**"。
- What：功能极全（角色卡 / World Info / 群聊 / 扩展 / 主题 CSS），官方坦然承认学习曲线陡峭；角色卡是必填概念。
- Why：目标是"给玩家最大控制权"，复杂度是刻意取舍。
- 启示：赛道共同弱点 = 上手成本。我们的差异化：**核心循环零概念**——不用角色卡/世界书/扩展，打开即玩；高级能力（IF 线、多选组合）做成渐进发现而非前置学习。

**A3. NovelAI**（Anlatan）— AI 写作 + 动漫插图一体化
- 证据：novelai.net 首页（2026-08-24）。
- What：以图像生成为第一卖点（"AI Anime Image Generator & Storyteller"），"Purpose-built Creative Editor"；订阅 $10/$15/$25 分层，免费 30 张试水。
- Why：插图是此类产品的付费驱动力，编辑器围绕"生成-调整-再生成"循环设计。
- 启示：我们的插图是叙事的纪念品而非生产力工具——画册/重绘/导出已覆盖；可借鉴"随机灵感"（dice）思路降低自由输入门槛（候选机会，见 §5）。

### B. Indirect Competitors

**B1. ChatGPT 桌面应用** — 通用 AI 聊天（大量用户拿来做角色扮演/故事接龙，间接满足同一需求）
- 证据：learn.chatgpt.com/docs/app.md（2026-08-24 抓取）。定位语："Your command center for complex work"；"**Keep every chat in view:** Move between projects and long-running work without losing context"。
- What：一个桌面工作区并行多个长期会话；新手路径极简：安装 → 登录 → 选位置 → 发第一条消息；Codex 模式入口为 "New chat"（另有 Quick chat 快捷图标）。
- Why：长期任务切换的痛点是"丢上下文"，所以把会话可见性做成核心卖点。
- 启示：我们的世界线侧栏 + 工作区 + 每会话输入草稿正是同一原则，方向已被验证；但"发第一条消息"的门槛上，ChatGPT 是打开即输入，我们需先配置 API key——空状态的「开始游戏」必须在密钥未配时给出明确引导（见 §6 P1-3）。

**B2. Character.AI** — 角色对话头部产品
- 证据：character.ai 与 support.character.ai 均 403 反爬（2026-08-25 两次尝试）→ 维持 **ASSUMPTION**，不再尝试；间接竞品证据以 B1 为准。
- ASSUMPTION：核心竞争力是"零输入开聊"——选角色即进入对话，永远不缺话题；依赖平台侧角色生态。
- 启示：内核即我们的"角色"。「开始游戏」一键开局与其同构；可借鉴的是**开局后持续供给话题**——我们的选项按钮已解决，无需改。

### C. Best-in-Class（设计对标）

**C1. Codex 桌面程序 / Codex CLI**（官方对标）
- 证据：learn.chatgpt.com/docs/codex/cli.md + github.com/openai/codex README（2026-08-24 抓取）。
- 关键原则 1："**Stay in control:** Choose the model, reasoning effort, permissions, and commands" —— 模型与推理强度选择器常驻对话区。我们已实现（composer 的模型/思考程度下拉），与 Codex 同级。
- 关键原则 2：官方 best practice 是任务前后建 Git checkpoint 以便回退 —— 与我们的 IF 线/世界线复刻同构；"可回溯"是 agentic/生成式产品建立信任的标准手段。
- 视觉语言：细边线、mono 字体、琥珀点缀、低噪声 chrome——本项目已整体对齐（README 记录的设计系统）。

**C2. Linear / Raycast**（键盘优先参照，**ASSUMPTION** 通用设计常识）
- 借鉴原则而非样式：高频操作必须有键盘路径。我们已有 Ctrl+B/F/G/,// 与快捷键面板（Ctrl+/），达标；无需引入 Command Palette（功能量级不匹配，强行加入违反极简原则）。

---

## 3. Competitor Matrix（维度裁决；证据见 §2，判断基于 28 状态截图走查 test-shots/audit/）

| 维度 | 六面世界 | AI Dungeon | SillyTavern | NovelAI | Codex(对标) | 裁决（What/Why→Recommendation） |
|---|---|---|---|---|---|---|
| First Impression | 中（空状态干净但占位文案曾错位） | 弱（需先读文档） | 弱（角色卡前置） | 强（视觉即卖点） | 强 | 我们已优于直接竞品；占位错位已修→Improve 完成 |
| Onboarding | 免责+九步图文指南，仅首次 | 重文档补救 | 官方承认陡峭 | 编辑器自解释 | 极轻 | 我们采用"渐进发现"——Adopt 并守住 |
| Core Flow（主循环） | 读→点选/输入→推进，1-2 次点击 | 需选输入模式 | 配置链长 | 围绕生成器 | 极简 | **结构性领先**：选项按钮免打字免模式→守住 |
| Navigation | 侧栏世界线+工作区+时间分组+拖拽 | 冒险列表 | 会话/角色双层 | 项目制 | 会话+项目 | 同级，IA 已合理→Ignore 大改 |
| Search | 会话内 Ctrl+F + 全局过滤（跨线） | 未见公开亮点 | 基础 | 基础 | 全局搜索 | 已达标→Ignore |
| Feedback | Toast+忙碌徽标+流式+停止+重试映射 | 标准 | 标准 | 生成进度明确 | 流式+diff | 同级偏上→保持 |
| Empty State | CTA + R10 未配密钥预防提示（实测三态） | 文档链接 | 需先建卡 | 直接生成 | 输入框即起点 | **领先**（预防>恢复） |
| Error Handling | 中文映射+重试按钮+断流保半段 | 标准 | 裸露错误较多 | 标准 | 标准 | **领先**→守住 |
| Visual Hierarchy | 结构化叙事（场景行/状态卡/决定块） | 纯文本流 | 聊天气泡 | 编辑器 | diff 层级 | **差异化优势**→守住 |
| Responsive UX | R11 实测 700/500px 无溢出、自收侧栏、进度轨可见 | Web 自适应 | 桌面优先 | 桌面优先 | 桌面优先 | 同级达标（实测） |
| Accessibility | R8–R34：14 组合全 AA、焦点环全覆、键盘全旅程、读屏通告、减少动态 | 未公开承诺 | 未公开承诺 | 未公开承诺 | 行业基准 | **领先**（清单全闭环，证据倾向） |
| Perceived Quality | 7 调色板×明暗+动效体系 | 一般 | 主题靠社区 | 高 | 高 | 同级→持续抛光（P3 不优先） |

---

## 4. 真实 UX Gap（来自截图走查 + 代码审查，非"竞品更漂亮"式结论）

- **Clarity Gap（已修）**：侧栏按钮"新会话"与列表标签"世界线"、条目"新世界线"三个术语并存；输入占位在空会话也写"点选上方选项"。→ R5 已统一术语、占位随上下文切换。
- **Discoverability Gap（✅ R7/R15 已关）**：IF 分歧/故事进度条已有一次性轻提示（可关、用过即消）；多选组合为可见标签按钮无需提示。
- **Feedback Gap（✅ R10 代码复核关闭）**：`illustPending` 在叙事原位渲染「正在绘制」动效占位 + 重试带次数标签，反馈链完整。
- **Conversion Gap（✅ R6/R10 已关）**：无密钥发送 → toast + 自动开设置（R6 走查）；R10 起空状态提前琥珀提示（预防>恢复），三态实测。
- **Trust Gap（低）**：密钥仅本机、链接外部打开、错误中文映射、断流保半段——基础信任要素齐。

## 5. Opportunity：竞品共同未解决的问题

1. **"免学习的完整感"**：AI Dungeon 用模式+文档补救开放输入，SillyTavern 拥抱陡峭曲线，NovelAI 围绕专业编辑器。三家都假设用户愿意学习。**机会 = 零概念开局 + 渐进发现高级能力**——我们已在结构上做到，护城河是把这条体验打磨到无摩擦（每轮迭代的主线）。
2. **决定的可回溯性**：Codex 官方 best practice 是 checkpoint 回退；文字 RPG 赛道无人把"分歧回溯"做成一等公民。IF 线是我们的差异化杀手级功能，但它的发现性恰恰是当前最弱的——**把 IF 线从"藏在悬停工具条"提升到"用户看得见"是最高杠杆的下一步**（P1-1，产品级改动需先提案，见 §8）。
3. **话题供给**：Character.AI 靠角色生态解决"不知道说什么"（ASSUMPTION）；我们的选项按钮已解决回合内话题，但**自由输入时空白**——NovelAI 的 dice（随机灵感）思路可借鉴：输入框旁一个低打扰的"灵感"入口（P2 候选，不承诺）。

---

## 6. 启发式审核结论 + 问题优先级（P0 阻塞 / P1 核心 / P2 效率 / P3 抛光）

- **P0**：无。主循环（读→决定→推进）在任何走查状态下未被阻断。
- **P1-1 发现性**（✅ R7 已修：一次性 IF 提示条，e2e 验证）。
- **P1-2 一致性**（✅ R5 已修）：术语 会话/世界线 不统一。
- **P1-3 转化**（✅ R6 走查 + R10 预防提示）：恢复路径本存在，已加提前引导。
- **P1-4 匹配**（✅ R5 已修）：输入占位与当前可用操作不符。
- **P2-1 无障碍**（✅ R8/R9/R10/R14：14 组合全 AA + 焦点环 + 高对比抽测）。
- **P2-2 窄窗**（✅ R11 实测 700/500px 全过）：390px 非目标形态，不做移动布局。
- **P2-3 自由输入灵感**（✅ R13 已修：✦ 灵感入口，e2e 验证）。
- **P3**（✅ R16 已修）：选项卡静止边、暗色 danger 文本。

## 7. UX / UI Direction（当前迭代遵循的方针）

- **Experience principle**：零概念开局，渐进发现；叙事是主角，chrome 退后；每个决定都可回溯。
- **信息层级**：叙事正文 > 决定块/选项 > 主 CTA > 状态/元信息 > 设置类。
- **导航**：左侧栏=世界线集合（时间分组+拖拽+搜索）；会话内滚动=时间轴；进度轨=收起态的地图。不做全局重构。
- **交互**：高频全键盘可达；破坏性操作必确认；占位/标签必须与当前可用操作一致（R5 确立的规则，今后所有文案改动遵守）。
- **视觉**：延续 Codex 语言（细边线/mono/琥珀点缀/低噪声）；琥珀仅用于主动作与 IF；阴影统一 `0 12px 32px`；不新增装饰性元素。
- **动效**：popin .14s 进场、popout 离场、hover .12s 基准——已统一，新组件必须复用。
- **响应式**：桌面优先；<760px 收侧栏；不为 390px 做移动布局（窗口最小宽度兜底）。

## 8. 迭代日志

### R1–R3（2026-08-24，早前会话，上下文已压缩）
- 完成产品理解、28 状态截图走查（test-shots/audit/01–28）、启动竞品研究；修复 fetch-url.ps1 的 PS5.1/GBK/BOM 环境问题。

### R4–R5（2026-08-24/25）
- 完成 §2 全部竞品证据抓取（官方页面真实抓取，URL 与日期见 §2）。
- **Changes Made**（代码，已验证 ALL PASS，`node scripts-dev/validate-r5.cjs`）：
  1. `renderer/index.html:38` 侧栏按钮「新会话」→「新世界线」+ title（P1-2 术语统一；CSS `::before` 的＋自动保留）。
  2. `renderer/index.html:88` 输入占位精简为「自由描述你的行动…（Enter 发送 · Shift+Enter 换行）」。
  3. `renderer/app.js:1414/1419` 占位随上下文切换：有选项时→「点选上方选项直接行动，或在此自由描述…（Enter 发送）」（P1-4）。
  4. 新增 `scripts-dev/validate-r5.cjs`：CDP 连接式验证（绕过本环境 Playwright electron.launch 的 pipe 限制——**此后所有验证统一用：PowerShell Start-Process 起 electron --remote-debugging-port=PORT + node 脚本 connectOverCDP**）。
- 环境诊断：Playwright `_electron.launch` 在本沙箱失败（named pipe），直连 CDP 正常；已沉淀为上面的标准验证路径。

### Product UX Score（R5 末）
- Overall 7.2 / UX 7.0 / UI 7.5 / Usability 7.0 / Consistency 7.5（+0.5 修复后） / Accessibility 6.0（未系统核查） / Responsive 6.5 / Perceived Quality 7.5

### Top Problems（当前）
1. P1-1 IF 线发现性（最高杠杆） 2. P1-3 密钥未配引导 3. P2-1 焦点/对比度核查 4. P2-2 窄窗复核 5. P2-3 自由输入灵感（候选） 6. P3 选项卡低对比 7. Discoverability 全局轻提示机制 8. 插图首绘中反馈（待复核） 9. B2 Character.AI 证据待抓取 10. 移动端明确不做（窗口最小宽度需确认存在）

### R6（2026-08-25）
- **P1-3 已闭环（代码走查）**：`app.js:1729` 无密钥发送 → 错误 Toast「请先在设置中填写 API 地址、密钥与模型。」+ 自动打开设置窗口。恢复路径存在且直达修复点，非断点 → 降级为 P2 抛光项"空状态在密钥缺失时提前提示（预防优于恢复）"，移入 backlog。
- 文档 §1–§8 全部落盘完成（竞品证据/矩阵/Gap/机会/优先级/方针/日志）。

### R7 · Product-level Recommendation：IF 线发现性（P1-1）

- **为什么需要改**：IF 分歧是本产品对竞品的差异化杀手功能（§5-2：赛道无人把分歧回溯做一等公民，Codex 官方也以 checkpoint 回退为最佳实践），但目前只存在于用户消息悬停工具条——用户必须"恰好悬停自己发过的消息 + 看懂图标"才能发现。九步指南提过，但指南仅首启动出现一次。差异化功能发现不了 = 不存在。
- **用户价值**：新用户在第一次"想重选"的时刻（第一次收到结果不满意时）恰好看到入口；老用户零打扰。
- **方案（最小实现）**：首次出现选项区时，在选项头部下方插一条一次性可关闭提示条：「选错了也没关系——悬停你发出的行动，点「IF 分歧」换条路重走」。点 ✕ 或使用过 IF 后置 `sixworlds.ifhint-seen.v1` 标记，永不再现。**不是**常驻 UI、不改工具条、不动 IF 逻辑。
- **技术影响**：仅 app.js 选项渲染块 + 少量 CSS；localStorage 一个布尔键；无数据/API/流程改动；可逆。
- **风险**：低——一次性提示条的打扰感（用"首次 + 可关 + 用后自消"控制）；与"选项区自动收起"的交互需在收起时不显示。
- **是否值得**：值得。最高杠杆的 P1，成本约 30 行代码。

### R7 实施记录（✅ 已验证 ALL PASS，`node scripts-dev/validate-r7.cjs`，6 项断言）
- **Changes Made**：
  1. `renderer/app.js`（choices 块）：首次出现选项时渲染一次性 `.if-hint` 提示条「选错了也没关系——悬停你发出的那条行动，点「IF 分歧」换条路重走」+ ✕ 关闭置 `sixworlds.ifhint-seen.v1`。
  2. `renderer/app.js` `branchFrom()`：实际开辟 IF 线时同样置标记（用过即不再提示）。
  3. `renderer/styles.css`：`.if-hint` 虚线琥珀边样式；并入 `.choices.collapsed` 隐藏清单（选项区收起时不显示）。
  4. 新增 `scripts-dev/validate-r7.cjs`（CDP 连接式；预设 `sixworlds.onboard.v1` 跳过免责遮罩——**后续所有点击类断言都必须先置此键**）。
- UX Score 更新：Overall 7.2 → **7.4**（Discoverability Gap 最大项关闭；Usability 7.0→7.2）。

### R7 收尾（2026-08-25）
- 回归扫描：R5 + R7 验证器同会话连跑 **双 ALL PASS**（validate-r5.cjs / validate-r7.cjs，CDP 模式）。
- B2 Character.AI：character.ai 与 support.character.ai 均 403（反爬，两次尝试 2026-08-25）→ 维持 §2-B2 的 ASSUMPTION 标注，不再尝试；间接竞品证据以 B1 ChatGPT 桌面 + A 组三家为准，充分性足够。
- 更新后 Next：**R8** = P2-1 焦点可见性/对比度系统核查（CDP + computed style）；backlog 不变（空状态密钥预防提示 P2、插图首绘反馈复核 P2、选项卡浅色对比 P3）。

### R8（2026-08-25）P2-1 无障碍核查 ✅ 已修复并复测
- 工具：`scripts-dev/audit-r8-a11y.cjs`（CDP；页内取 computed style，Node 算 WCAG 对比度）。
- 焦点可见性：发送/选项卡/新世界线/主题 全部 2px 琥珀 outline，可 Tab 到达 → **PASS 无需改**。
- 对比度修复（styles.css，小字功能文本 --text-faint→--text-dim，浅色琥珀主题实测 2.62→**5.39**）：`.choices-title`、`.if-hint`、`.empty-tip`（顺带去掉 .65 不透明度）、`.hint`。
- 测量伪影记录：「当前会话项」WARN 3.31 系 accent-glow 半透明底被当作不透明取值，真实 ≈11:1，无需改。
- 未覆盖：其余 6 套调色板对比度矩阵（同构变量，风险低）→ R9 候选；暗色主题实测。
- UX Score：Accessibility 6.0 → **7.0**；Overall 7.4 → **7.5**。

### R9（2026-08-25）调色板对比度矩阵 ✅ MATRIX ALL PASS
- 工具：`scripts-dev/audit-r9-matrix.cjs`（14 组合 × text/bg、dim/bg、acc/bg、on-acc/acc 四对）。
- 发现：text/dim 全部达标；系统性问题是**主按钮白字压 accent**——7 套深色主题 accent 偏亮（白字 1.45–3.09），paper/light 4.02，共 8 组合不达 AA。
- 修复（styles.css）：新增 `--on-accent` 变量——深色默认 `#241c10`、浅色默认 `#fff`（含 media 默认块）、paper/light 单独 `#1a1208`（4.61）；`.send` 与 `button.primary` 的 `color:#fff` → `var(--on-accent)`。复测 14/14 PASS，R5 回归 PASS。
- UX Score：Accessibility 7.0 → **7.5**；Overall 7.5 → **7.6**。
### R10（2026-08-25）✅ 三项全闭环，回归 3×ALL PASS
1. **P2 空状态密钥预防提示**：`app.js` 空状态在 API 未配时追加 `.empty-cfg-tip`「尚未配置 API —— 点击「开始游戏」将自动打开设置完成配置」（琥珀色）；`styles.css` 配套。验证 `validate-r10.cjs`：未配→显示、已配→隐藏、空态完整。注意：state 为**扁平键**（`sixworlds.codex.state.v3` 顶层即 cfg 字段，测试注入勿套 `cfg:` 嵌套）。
2. **P2 插图首绘反馈**：代码复核关闭——`m.illustPending` 在叙事原位渲染 `.illust-pending`「正在绘制这一幕的插图」动效 + 重试带次数标签，反馈链完整，无需改。
3. **P3 danger 按钮**：深色主题新增 `--danger-btn:#b84040`（白字 3.6→5.5 AA），`.confirm-foot .danger` 改用 `var(--danger-btn, var(--danger))`；浅色本就达标（4.9）。
- UX Score：Overall 7.6 → **7.7**（Error Prevention +；Usability 7.2→7.3）。
### R11（2026-08-25）窄窗实测 ✅ 双宽 PASS
- 工具：`scripts-dev/audit-r11-responsive.cjs`（700px + 500px 实测几何，截图 r11-*.png）。
- 结果：两宽均无横向溢出（scrollW=视口）；<760px 侧栏自动收起 ✓；收起态进度轨可见 ✓；输入框 598/398px、发送可见 ✓；选项卡 624/424px 堆叠正常 ✓。桌面应用的响应式行为达标，**不做 390px 手机布局的决策成立**（窗口最小宽度兜底）。
- UX Score：Responsive 6.5 → **7.5**（实测驱动）；Overall 7.7 → **7.8**。
## 9. 第二轮竞品验证（R12，2026-08-25；对照 §3 矩阵 + R5–R11 全部已验证修改）

**Usability**：我们 7.3 vs 竞品——AI Dungeon 需学输入模式、SillyTavern 官方承认陡峭、NovelAI 面向专业编辑器。我们的主循环 1–2 次点击、零概念开局 + R7 起 IF 一次性提示 → **领先**，且差距是结构性的（竞品补文档，我们补交互）。
**Efficiency**：点选项即推进、多选组合、Ctrl 系快捷键全键盘可达 → **领先**于三家直接竞品；与 Codex 的键盘优先同级。
**Clarity**：R5 术语统一 + 占位随上下文切换、R10 空状态预防提示后，占位/标签与可用操作全部一致 → 达行业最佳实践线。
**Visual hierarchy**：结构化叙事（场景行/状态卡/决定块）是独家优势 → **领先**。
**Interaction**：动效体系统一、悬停工具条、流式+停止+重试 → 与 Codex 同级；弱项=悬停依赖发现（R7 已补 IF，多选组合/进度条仍仅靠指南）→ 同级偏上。
**Accessibility**：R8/R9/R10 后 14 组合全 AA、焦点环全覆 → **可能领先**（竞品未公开承诺 AA；ASSUMPTION 但证据倾向）。
**Perceived quality**：7 调色板 + 动效 + 窄窗实测无 overflow → 同级。

- **我们领先**：主循环效率、叙事结构、错误恢复中文映射、分歧回溯（独家）、免学习。
- **我们落后**：插图生成器的专业深度（NovelAI 的 inpaint/vibe-transfer——不适合我们，Ignore）；角色/世界生态（Character.AI，ASSUMPTION——非本产品形态）。
- **行业标准**：流式输出、会话管理、模型切换、快捷键——全部达标。
- **竞品真正的优势**：NovelAI 的图像工具链深度、SillyTavern 的可扩展生态——两者都以复杂度为代价，与我们"零概念"定位互斥。
- **我们的差异化机会**：继续加深"决定可回溯"（IF 线）与"免学习完整感"——下一轮候选：灵感入口（解决自由输入空白，提案待写）。
- **结论**：无仍需追赶的明显差距 → 进入抛光与差异化加深阶段，不再跟随竞品功能。

### R13 · Product-level Recommendation：自由输入「灵感」入口（P2，差异化加深）

- **为什么需要改**：主循环中"有选项"场景由选项按钮供给话题，但用户自由输入时面对空白输入框——"不知道能做什么"是文字 RPG 的经典弃坑点。证据：AI Dungeon 专门发明 Do/Say/Story/See 输入模式 + 大量新手文档来补救同一问题（§2-A1，官方 Guidebook）；NovelAI 用 dice 随机灵感解决提示词空白（§2-A3，官网首页）。
- **用户价值**：在"想自己行动但卡住"的时刻给一个可编辑的起点；不打断、不强迫、不耗 token。
- **方案（最小实现）**：composer 左下加一个低打扰 ghost 小按钮「✦ 灵感」，点击把一条**本地静态轮换**的通用行动提示填入输入框（用户可编辑后再发送）。约 12 条，覆盖感知/社交/探索/整理四类（如"环顾四周，记下所有出口"、"追问对方的真实来意"、"检查随身物品与状态"、"先稳住局势，观察再动"）。**不引入 AI 生成**——额外 API 调用带来成本/延迟/失败态，违背极简；dice 原则的本质是"给一个起点"而非"给最优建议"。
- **技术影响**：app.js composer 一个按钮 + 点击填入 + 少量 CSS；无数据/API/流程改动；可逆；约 25 行。
- **风险**：低——composer foot 已有 hint/模型/思考下拉，需用 ghost 小按钮控制视觉重量（与「多选组合」同级样式）；静态建议与剧情可能脱节（文案保持通用祈使句+可编辑，风险可控）。
- **是否值得**：值得。补齐主循环最后一个"无供给"时刻（空状态有开始按钮、选项时刻有按钮、错误有重试——唯独自由输入无供给），P2 效率/理解成本。

### R13 实施记录（✅ ALL PASS，`validate-r13.cjs` 4 项 + 回归 3×ALL PASS）
- `index.html`：composer foot 新增 `#btn-inspire`「✦ 灵感」；`styles.css` `.inspire-btn`（ghost，text-dim 达标 AA）。
- `app.js`：12 条本地静态行动提示随机起点轮换，点击填入 + `fitInput()` + 光标置尾；可编辑再发送。
- UX Score：UX 7.3 → **7.4**；Overall 7.8 → **7.9**。
### R14（2026-08-25）阶段收尾快照 ✅
- 高对比焦点环抽测（`audit-r14-focus.cjs`）：contrast/dark 琥珀 #ffcf7d on 黑、contrast/light #8a5a00 on 白，均 2px solid → PASS。
- **大回归：6 套件全绿**——validate-r5/r7/r10/r13 ALL PASS、audit-r9 MATRIX ALL PASS（14/14）、audit-r11 双宽 PASS。
- §3 矩阵回写：Empty State→领先、Responsive→同级达标（实测）、Accessibility→可能领先。
- UX Score：Overall **7.9** 维持（Perceived Quality 7.5→7.6，焦点/对比度体系闭环）。
- 阶段结论：Research→Audit→Benchmark→Diagnose→Design→Implement→Validate→Iterate 已走完两个完整循环；所有 P0/P1 清零，P2 主要项清零，进入 backlog 抛光阶段。

### R15（2026-08-25）进度条发现性 ✅ ALL PASS + 回归 4×ALL PASS
- `app.js`：新增 `tryShowRailHint()`——进度条首次可见且 ≥2 节点时浮现一次性提示「悬停预览 · 点击跳幕」（✕ 关闭或 8s 自消，`sixworlds.railhint-seen.v1` 置位）。**关键教训：显示类提示必须挂在状态切换的扼流点**（`applySidebar()`）而不只是渲染函数——渲染时元素可能还不可见。`styles.css` `.rail-hint`（含 sb-right 镜像）。
- 验证 `validate-r15.cjs`：收起→出现→关闭→重载不再现（5 项）。
- UX Score：UX 7.4 → **7.5**；Overall 7.9 → **8.0**。Discoverability 残余项（多选组合为可见标签按钮，无需提示）清零。
### R16（2026-08-25）backlog 抛光 ✅ 回归 6×ALL PASS
1. **选项卡静止态可辨识度**（P3）：`.choice` 边框 transparent → `var(--border)`——主要操作卡在 hover 前即可辨识；hover 琥珀描边不变。
2. **暗色 error 文本**（P3）：深色 `--danger` #d65a5a→#e06b6b（文本 4.26→5.4 AA）；按钮底色仍用 --danger-btn 不受影响；取舍记录：tb-close 悬停白字 3.2 为瞬态可接受。
3. **README 同步**：功能表追加 5 行（术语占位一致性 / 一次性轻提示 / AA 体系 / 灵感入口 / 空状态预防提示），R5–R15 用户可见变化全部入档。
- UX Score：UI 7.5 → **7.6**；Overall 8.0 维持。Backlog 抛光项清零。
### R17（2026-08-25）第三轮竞品巡检 + 视觉抽审 ✅
- **巡检**（fetch-url.ps1 重抓）：SillyTavern 定位与角色卡前置概念**无变化**；NovelAI 仍 V5 编辑器+dice+原价位**无变化**。§2 证据链与 §9 结论继续有效，基准无需调整。下次巡检节奏：月度或竞品大版本发布时。
- **视觉抽审**：`r7-01-if-hint.png` 人工复核通过——IF 提示条位置（选项头部上方）与层级正确；R16 选项卡静止边、R5 新世界线、R13 灵感按钮、动态占位均正确整合，无样式打架。
- UX Score：维持 **8.0**。产品进入稳定抛光期，后续轮次节奏：月度巡检 + 新想法先提案后实施。

### R17b（2026-08-25）深色整合态 + 窄窗 composer ✅
- `r17-dark-choices.png` 人工复核：IF 提示条、选项卡静止边、发送按钮**深字压琥珀**（--on-accent 生效）、灵感按钮、动态占位于深色主题全部正确整合。
- 窄窗 composer 实测：500px 下 foot 398 ≤ 容器 422，单行 27px 无溢出 → PASS（`audit-r17-visual.cjs`）。
- （R17b 收尾）浅色/深色/窄窗三条视觉基线齐备；验证资产累计：5 功能验证器 + 4 视觉/审计器。

### R18（2026-08-25）设置窗口启发式复审 ✅ 无新问题
- 复审截图 04–09（设置四页签，R1-3 走查资产，界面未变仍有效）。
- **文本模型页**：接口分组清晰；获取模型/测试与模型框相邻（就近原则 ✓）；密钥眼睛切换 ✓；可用模型清单有说明+手动添加兜底 ✓；页签顺序=首用任务顺序 ✓。
- **外观页**：配色/样式/布局分组合理；默认值全部标注（默认）✓；即时预览主窗口承担视觉反馈（页内无需色板）✓。
- 结论：设置窗无 P0–P2 问题；P3 观察项=保存按钮无脏态点（有未保存回滚机制兜底，不处理）。
- UX Score：Consistency 7.5 → **7.6**（设置 IA 实证）；Overall **8.0** 维持。

### R19（2026-08-25）错误态自动化覆盖 ✅ ALL PASS + 全量回归 7×ALL PASS
- 发现走查资产 22-error-state.png 为改动前旧图且非错误态 → 补上自动化：`validate-r19.cjs` 断言错误块 `.err` 渲染、⚠️/引擎标记剥离后的友好文本、末条「↻ 重试这一回合」按钮存在与文案（4 项 PASS，截图 r19-01）。
- 全量回归：6 功能验证器 + 对比度矩阵 **7×ALL PASS**。
- 验证资产终态：**6 功能验证器**（r5/r7/r10/r13/r15/r19）+ **4 审计器**（r8 对比度焦点 / r9 矩阵 / r11 窄窗 / r17 视觉）。所有核心状态（空态/选项/错误/提示/窄窗/深色）均有自动化守护。
### R20（2026-08-25）核心闭环端到端 ✅ ALL PASS（mock SSE 真实流式）
- `validate-r20.cjs`：空态点「开始游戏」→ 流式中「世界运转中」徽标 + 发送钮变「停止」→ 叙事+选项渲染 → 点选项推进第二回合。6 项 PASS，截图 r20-01/02。mock 调用日志证实恰好 2 次调用、无启动幽灵请求（不白烧 token）。
- **测试环境教训**：先两次 FAIL 是陈旧 mock-server 进程占用 4599 端口（新 mock 绑定失败静默死，旧 mock 计数器跨运行残留）——**启 mock 前必须按命令行清场**：`Get-CimInstance Win32_Process | ? CommandLine -match 'mock-server' | Stop-Process`。诊断方法：mock 端写调用日志（`$env:TEMP\mock-calls.log`）。
### R21（2026-08-25）错误流 + IF 分歧端到端 ✅ ALL PASS（7 项）
- `validate-r21.cjs`（mock 实流）：发送「触发错误」→ 真实 429 → 中文映射「请求过于频繁（429）：请稍等片刻再试」+ 重试钮 ✓；悬停第二条行动 → IF 分歧 → 确认 → 新线标题 `IF ·` 前缀 ✓、历史复刻到分歧点前（布耶纳村在、触发错误/429 不在）✓、选项按钮重现 ✓、原线保留 ✓。截图 r21-01/02。
- 环境教训②：陈旧 mock 跨三次运行存活（计数器残留 → 永远返回第二段回复）；**收尾也必须按命令行清场**，仅 Stop-Process $id 可能杀死的是绑定失败的新进程。
### R22（2026-08-25）中止生成 + 多选组合端到端 ✅ ALL PASS（7 项）
- `validate-r22.cjs`（mock 实流）：流式中发送钮变「停止」✓ → 点停止 → **半段文本保留** ✓、忙碌态清除回「发送」✓、截断时不出现选项 ✓；新线开局 → 「多选组合」→ 勾选 A+B → 工具条「已选 2 项：A + B」✓ → 组合发送 → 合并行动（含【A】【B】标记）✓ → 回合完成 ✓。截图 r22-01/02。
### R23（2026-08-25）搜索 e2e + 全量回归 12×ALL PASS
- `validate-r23.cjs`：全局搜索过滤（徽标「2 命中」、非命中隐藏）✓、Ctrl+F 会话内搜索（计数 1/1、mark 高亮、Esc 清除）✓。截图 r23-01/02。
- **套件化教训③**：断言**不得依赖 mock 调用次序**（计数器跨验证器共享）——r20/r21 改为接受任一段叙事地标后，12 套件单 mock 一次全绿。此规则与教训①（按命令行清场）②（收尾清场）并列写入运行手册。
- **全量回归终态（12/12 ALL PASS）**：10 功能验证器（r5/r7/r10/r13/r15/r19/r20/r21/r22/r23）+ 审计（r9 矩阵 14 组合 / r11 双宽窄窗）。
### R24（2026-08-25）一键回归基础设施 ✅ 12/12 green
- 新增 `scripts-dev/run-cdp-suite.ps1`：清场 → 起 mock → 起 electron(CDP) → 12 套件连跑 → 汇总退出码，三条运行手册规则全部内置。README 已收录。
- 首跑验证：**SUITE SUMMARY: 12/12 green**。此后每轮修改的回归成本 = 一条命令。
### R24b（2026-08-25）画廊/大图查看器 e2e ✅ ALL PASS（7 项）+ 套件 13/13 green
- `validate-r24.cjs`：画廊开启、卡片插图渲染、大图查看器 1/N 计数、←→ 循环切换、Esc 关闭（**Esc 级联同时关画廊**——测试据此适配，产品行为符合直觉）、画廊关闭。截图 r24-01/02。
- `run-cdp-suite.ps1` 纳入 r24：**SUITE SUMMARY: 13/13 green**。
### R26（2026-08-25，第 50 轮里程碑）文档准确性清理 + 回归 14/14 green
- §4 Gap 状态全部更新为已关闭（Discoverability/Feedback/Conversion）；§6 P1-1/P1-3/P2-1/P2-2/P2-3/P3 全部标记已修及对应轮次；§2-B2 更新为 403 实测结论。
- 里程碑回归：**SUITE SUMMARY: 14/14 green**。
- **50 轮总账**：P0/P1/P2/P3 问题清单全闭环；竞品两轮验证无差距；Overall 7.2 → **8.1**；产品改动 ×14 全部 e2e 实证；验证资产 12 功能验证器 + 4 审计器 + 一键 runner。

### R27（2026-08-25）真实首跑流程 e2e ✅ ALL PASS（8 项）+ 套件 15/15 green
- `validate-r26.cjs`（不预置 onboard 标记，完全首跑）：免责声明出现 ✓、未勾选同意禁用 ✓、勾选后启用 ✓、同意后教程自动打开 ✓、Esc 关闭 ✓、空状态出现 ✓、标记持久化 ✓、二次启动不再出现 ✓。截图 r26-01/02。
### R28（2026-08-25）会话管理 e2e ✅ ALL PASS（5 项）+ 套件 16/16 green
- `validate-r27.cjs`：双击重命名（input 出现 → Enter 生效）✓；删除确认闸（确认框出现 → 取消保留 → 再触发 → 确认删除）✓。**选择器教训**：危险操作确认按钮 `class=danger` 而非 `primary`（`ok.className = opts.danger ? 'danger' : 'primary'`，app.js:2112）。截图 r27-01。
### R29（2026-08-25）主题 UI 流 e2e ✅ ALL PASS（5 项）+ 套件 17/17 green
- `validate-r28.cjs`：主题弹层开启 ✓、林间色板点击即生效（data-palette=forest + --bg 实测变化）✓、明暗深色 ✓、重载持久化 ✓、复位 ✓。**交互事实记录**：色板/模式选择后弹层自动关闭，连续操作需重开（产品行为合理，测试据此适配）。截图 r28-01。
### R30（2026-08-25）用量面板 e2e ✅ ALL PASS（3 项）+ 套件 18/18 green
- `validate-r29.cjs`：回合后模型芯片显示 mock-chat ✓、点击展开用量面板 ✓、面板含输入/输出/tok 数字 ✓（mock 流 usage 真实计费）。截图 r29-01。
- （R30 收尾补记）套件纳入 r29 后 18/18 green；r29 用量断言曾硬编码 1426 失败 → 改次序无关（教训③再印证）。

### R31（2026-08-25）结构化叙事渲染 CDP 化 + 一处真实 a11y 修复 ✅ ALL PASS（6 项）+ 套件 19/19 green
- **真实修复**（styles.css）：`.option-line`（叙事内联弱化选项行，~12.5px）`--text-faint`→`--text-dim`——R8 审计选择器未覆盖该类，实为 2.62 不达 AA；提级后层级保留（仍弱于正文）且实测 107,103,95。
- `validate-r30.cjs`：场景行/决定块/状态卡/弱化选项行 四类结构件渲染 + 场景行琥珀色 + option-line 非旧 faint 色，6 项 PASS。
- `run-cdp-suite.ps1` 纳入 r30：**SUITE SUMMARY: 19/19 green**。功能验证器 ×17 + 审计 ×4。
### R32（2026-08-25）text-faint 系统清扫（R31 通则化）✅ 回归 19/19 green
- 全量审查 39 处 `--text-faint`：分类为装饰/结构标签（保留：图标钮、9-10px mono 微标签、徽标、placeholder、popover 标题）vs **必读/选择文本**（须过 AA）→ 8 处提级 `--text-dim`：`.empty p`（空态副标题）、`.session-label`（世界线）、`.chip`（内核/模型芯片）、`.model-empty`、`.gallery-empty`、画廊叙事摘要、`.swatch`（调色板名，选择文本）、`.models-pick-empty`。
- 规则沉淀：**faint 仅用于装饰性/结构性短标签；任何用户须读来行动的句子/名称一律 ≥text-dim**。
### R33（2026-08-25）键盘可操作性修复 ✅ ALL PASS（3 项）+ 套件 20/20 green
- **真实缺口**（app.js）：会话项与进度条节点均为 `<div>` + click，键盘用户完全无法切线/跳幕 → 补 `tabIndex=0` + `role=button` + Enter/Space 转发 `.click()`（不复制逻辑）。
- `validate-r31.cjs`：属性断言 + 聚焦按 Enter 真实切换到「键盘线二」+ 进度条节点可达，3 项 PASS。
- `run-cdp-suite.ps1` 纳入 r31：**SUITE SUMMARY: 20/20 green**。功能验证器 ×18 + 审计 ×4。
### R33b（2026-08-25）键盘可达补扫 ✅ 回归 20/20 green
- 全面审查 78 处 click 监听器：仅剩插图 `<img>`（叙事内 + 画廊卡）不可键盘打开大图 → 同模式补 `tabIndex/role/Enter·Space`（app.js ×2）。其余均为真 button 或补充性交互（toast 点掉、遮罩点击）。
- `validate-r24.cjs` 升级为键盘 Enter 开大图路径（含属性断言），套件 20/20 green。
### R33c（2026-08-25）焦点环补齐 ✅ 回归 20/20 green
- 全局 `:focus-visible` 规则（2px accent outline）原已覆盖 button/input/select/.choice/.session-item/.rail-node（且**预埋了后两者**——R33 补 tabindex 即生效）；仅插图 `img[role="button"]` 遗漏 → 补入选择器（styles.css:964）。
### R34（2026-08-25）屏幕阅读器 + 减少动态 ✅ ALL PASS（3 项）+ 套件 21/21 green
- `app.js` toast：wrap `aria-live=polite`，err 级 `role=alert`、其余 `role=status`——状态变更可被读屏通告。
- `styles.css`：`@media (prefers-reduced-motion: reduce)` 全量压动效/滚动为近瞬时（功能不变）。
- `validate-r32.cjs` 3 项 PASS；套件纳入：**SUITE SUMMARY: 21/21 green**。功能验证器 ×19 + 审计 ×4。
- （R34 收尾）UX Score：Accessibility 7.8 → **8.0**；Overall 8.2。

### R36（2026-08-25）⚠️ 验证体系捕获首个真实产品 BUG（P1）+ 时间分组/拖拽 e2e ✅ 23/23 green
- **BUG**：拖拽排序落点计算顺序错误——`mouseup` 先 `clearDropMarks()` 再查询 `.drop-before/.drop-after` 标记 → 标记恒为 null → **任何拖拽都把会话移到末尾**（app.js:311/315）。README 声称该功能可用且有旧测试，但旧测试未用真实鼠标路径覆盖。**修复**：先取标记再清理（一行顺序调换）。
- `validate-r34.cjs`：时间分组（今天>昨天>更早）✓；真实鼠标拖拽 B→A 上方：修复前列表成 "A|昨|古|**B(末尾)**"，修复后 "B|A|昨|古" 且 localStorage 持久化 ✓。
- 套件：**SUITE SUMMARY: 23/23 green**。功能验证器 ×21 + 审计 ×4。
- （R36 收尾）UX Score：Usability 7.4 → **7.5**；Overall 8.2。

### R37（2026-08-25）侧栏调宽 e2e ✅ ALL PASS（4 项）+ 套件 24/24 green
- `validate-r35.cjs`（真实鼠标路径，复验 R36 同类机制）：把手拖宽 200→317 ✓、宽度持久化 317 ✓、拖到最窄 snap 收起 ✓、双击把手恢复 ✓。**侧栏拖拽路径无 R36 同类时序缺陷**。
- （R37 收尾）套件纳入 r35：**SUITE SUMMARY: 24/24 green**；功能验证器 ×22。

### R39（2026-08-25）置顶切换 + 搜索导航 e2e ✅ ALL PASS（5 项）+ 套件 26/26 green
- `validate-r37.cjs`：置顶开/关（active 类 + cfg.pin 持久化）✓；搜索两处命中 1/2 → Enter 2/2 → Shift+Enter 1/2 ✓。
- （R39 收尾）套件：**SUITE SUMMARY: 26/26 green**；功能验证器 ×24 + 审计 ×4。

### R40（2026-08-26）维护节奏轮 ✅ 回归 26/26 green
- 全量回归确认 26/26 green（无改动）。尝试将运行手册写入会话记忆后端（OpenViking 不可达，未写入——手册本就在本文档 §8/R5/R20/R21/R30/R36 各处，冗余足够）。
### R41（2026-08-26）对标巡检：Codex 发布动态
- 抓取 github.com/openai/codex/releases：稳定版 **0.149.1**（2026-08-24），0.150.0 已进入 alpha.7（迭代节奏约周更）；发布页仅版本号与资产哈希（changelog 链接 JS 渲染未取到细节），**无可行动 UX 情报**，对标基准无需调整。
### R46 · Product-level Recommendation：空输入框按 ↑ 召回上一条已发送行动

- **证据**（2026-08-26 抓取 learn.chatgpt.com/docs/reference/commands.md）：ChatGPT 桌面官方快捷键表含「Restore previous composer prompt (When the composer is empty) **↑**」——对标产品把"召回刚发的内容再编辑"做成一等快捷键。另证：设置 ⌘+, / 快捷键表 ⌘+/ / 侧栏 ⌘+B / 聊天内搜索 ⌘+F 与我们全部对齐（parity 确认）；桌面版确有 Command Menu（⌘K），我们功能量级小仍不引入（维持原判，今有证据）。
- **为什么需要改**：文字 RPG 高频场景——玩家想"重发上一条行动但改几个字"（换一个措辞试探不同走向）。现状只能重打全文或用 REGEN（整回合重走，不能改词）。↑ 召回是壳层/shell 历史的通用习惯（Recognition↓、Efficiency↑）。
- **用户价值**：空输入框按 ↑ → 填入本世界线最近一条已发送行动（可编辑后再发送）；连续按 ↑ 可向更早前行动回溯（类 shell history，最多回到本线首条）；向下回到空。不覆盖已有草稿（输入非空时 ↑ 是正常光标行为，不拦截）。
- **方案（最小实现）**：input keydown 监听 ArrowUp：仅当输入框为空且光标在 0 位时拦截，维护一个每会话的召回索引（recallIdx），向上取 messages 里 role=user 的内容填入；Escape 或清空输入即复位索引。约 25 行，无数据/API 改动，可逆。
- **风险**：低——↑ 在空输入框无既有语义冲突；多行草稿用户可能误触（用"仅空输入+光标 0 位"门槛控制）；与灵感按钮并存（一个是静态模板、一个是本线历史，语义不同）。
- **是否值得**：值得。对标有直接证据的平价快捷键，P2 效率项，成本极低。

### R46 实施记录（✅ ALL PASS 7 项，`validate-r39.cjs` + 套件 28/28 green）
- `app.js` input keydown：空输入+非组合态 ↑ → 召回本线最近 user 行动（连按向上回溯至首条封顶，↓ 逐级返回直至清空，Esc/其它键复位索引，**有草稿不拦截**）。
- `index.html` 快捷键面板收录「召回上一条行动 ↑」（发现渠道）。
- 验证：最新/更早/封顶/返回/清空/草稿不拦截/复位重召回 7 项 PASS；套件 **28/28 green**。
- （R46 收尾）UX Score：Usability 7.5 → **7.6**；Overall 8.3。

### R47（2026-08-26）Ctrl+N 新建世界线（同一证据页第二项 parity）✅ ALL PASS（3 项）+ 套件 29/29 green
- 证据同 R46（commands.md：⌘+N New chat）。`app.js` 全局快捷键加 Ctrl+N → 等同 btn-new（busy 拦截 toast）；`index.html` 快捷键面板收录；`validate-r40.cjs`：新线激活/空状态/原线保留 3 项 PASS。套件 **29/29 green**。
### R48（2026-08-26）字号缩放快捷键（同一证据页第三项 parity）✅ ALL PASS（7 项）+ 套件 30/30 green
- 证据同 R46（commands.md：⌘+/-/0 font size）。`app.js` Ctrl+=/-/0 → small/standard/large 循环 + 0 复位（复用 applyReading/saveStore，toast 反馈）；快捷键面板收录；`validate-r41.cjs`：默认/放大/封顶/缩小/封底/复位/持久化 7 项 PASS。套件 **30/30 green**。
- commands.md 证据页共产出 3 个 parity 项（↑召回 / Ctrl+N / 字号缩放）；剩余项（recent-chat 数字键、command menu）评估为不适合当前功能量级，不引入。
- R48 视觉基线：`test-shots/audit/r48-01~03-zoom-{standard,large,small}.png` 复核通过（toast「字号：大」、16px 正文、布局完整缩放无错位）。
- UX Score：Overall **8.3** 维持。

### R43 · Product-level Recommendation：IF 线「母线回溯」面包屑（差异化功能闭环）

- **为什么需要改**：IF 分歧是本产品对竞品的差异化杀手功能（§5-2），但当前是**单向门**——开辟 IF 线后，用户想回原世界线只能在侧栏列表里找同名母线（时间分组+同名相似，母线可能已滚出视野）。Codex 对标证据（§2-C1）：checkpoint 的价值在于**回退路径显而易见**；分歧去得去、回得回，信任闭环才成立。
- **用户价值**：在 IF 线里随时一键回到母线；母线身份不再靠记忆/寻找（Recognition↓、Control↑）。
- **方案（最小实现）**：当前会话含 `ifFrom` 时，chat-header 标题旁显示一个小面包屑 chip「← 母线：{母线标题}」（复用 chip 样式 + 琥珀左边条提示血缘）；点击即切换到母线会话。母线已被删除时 chip 不显示（或显示 toast「母线已删除」——选不显示，更安静）。
- **技术影响**：app.js chat-header 渲染处 + 少量 CSS；会话对象已有 `ifFrom` 字段（branchFrom 创建时写入）；无数据/API 改动；可逆；约 20 行。
- **风险**：低——标题区空间（chip 需 ellipsis 截断）；非 IF 会话零影响。
- **是否值得**：值得。差异化功能的完整性缺口，P2（效率/认知成本），成本低。

### R43 实施记录（✅ ALL PASS 5 项，`validate-r38.cjs` + 套件 27/27 green）
- `app.js` updateTitle：`s.ifFrom` 且母线存在时标题旁渲染 `.mother-chip`「← 母线：{标题}」，点击按**标准切线流程**（草稿保存/选项态重置/ws.lastSessionId/render 三件套）回母线并 toast。
- `styles.css` `.mother-chip`：琥珀 glow 底 + mono 10px + ellipsis（220px 截断），hover 加强。
- 验证：chip 显示/文案/点击切换/母线无 chip/列表激活态，5 项 PASS；套件 **27/27 green**。
- README 已同步母线面包屑（IF 行）。
### R43c（2026-08-26）母线 chip 视觉基线 ✅
- 截图 `test-shots/audit/r43-01-mother-chip.png` 人工复核：标题「IF · 视觉复审线 · 1 回合」+ 琥珀「← 母线」chip 紧邻、层级正确；侧栏 IF 线与母线并存；IF 提示条/选项卡/动态占位无冲突。R43 视觉记录闭环（桌面+窄窗均有基线）。

### R43b（2026-08-26）母线 chip 窄窗边缘复核 ✅ PASS
- 500px 实测：chat-header 452px 无溢出，chip 可见且 ellipsis 生效（150px，「母线：视觉复审…」截断）——R43 响应式边缘无回归。
- 稳定性记录：曾出现单次套件 26/27（一个 mock 依赖验证器瞬时失败），连续两次复跑均 27/27 green → 判定为时序 flake 并监控；若同一点位复现再加宽等待。
- UX Score：UX 7.6 → **7.7**（差异化功能闭环）；Overall 8.2 → **8.3**。

### R52（2026-08-25）研究流：Codex CLI customization 文档评估
- 抓取 learn.chatgpt.com/docs/cli-customization.md。三项模式评估：①`/theme` 主题选择器（预览+自定义 .tmTheme）——我们的 7 调色板×3 明暗+即时预览已超越，**无行动**；②shell 补全——CLI 专属，**不适用**；③Ctrl+G 长文外部编辑器——终端编辑补偿模式；我们的 textarea 自动增高（fitInput）已是合格编辑器，且 Ctrl+G 已是画廊快捷键冲突，**明确不引入**。
- 结论：对标体系的 CLI 表层无可迁移模式；我们的 GUI 形态在对应维度均已同级或更好。

### R42（2026-08-26）竞品真实界面取证尝试（goal §4）
- play.aidungeon.com：纯 JS SPA 外壳（"Connecting to AI Dungeon"，无 SSR 内容）→ 无头抓取无法评估真实游玩界面，证据记为"需 JS 环境"。
- docs.sillytavern.app/usage/screenshots/：404（路径不存在）。
- 结论：竞品深层界面取证受工具限制（静态抓取），现有 §2 官方文档/首页证据链继续作为基准；不为此引入完整浏览器自动化（投入产出不成比例，竞品结论已稳定两轮）。

### R38（2026-08-25）REGEN 重生成 e2e ✅ ALL PASS（3 项）+ 套件 25/25 green
- `validate-r36.cjs`（mock 实流）：悬停世界回应出「重生成」✓、点击后消息数不变（无重复 user，4→4）✓、回合被替换重走 ✓。
- 套件：**SUITE SUMMARY: 25/25 green**。功能验证器 ×23 + 审计 ×4。

### R35（2026-08-25）设置往返 e2e（#1 转化路径）✅ ALL PASS（4 项）+ 套件 22/22 green
- `validate-r33.cjs`（独立设置窗 + mock）：Ctrl+, 开窗 ✓、填端点/密钥/模型 → 「测试」显示「✓ 连接成功，共 7 个模型，当前模型 mock-chat」✓、保存后主窗芯片即更新 ✓、重载持久化 ✓。**行为记录**：保存后设置窗自动关闭（测试句柄需弃用）。
- `run-cdp-suite.ps1` 纳入 r33：**SUITE SUMMARY: 22/22 green**。功能验证器 ×20 + 审计 ×4。

### R33d（2026-08-25）文本提级后视觉复审 ✅ 无回归
- `audit-r33-visual.cjs` 三态截图（浅色空态+琥珀提示 / 浅色选项+IF提示 / 深色选项）；人工复核 r33-02：内联选项行提级后可读且层级保留、世界线标签/芯片更存在感但不吵、IF 提示条/选项卡静止边/动态占位/灵感/深字琥珀发送全部正确整合。**文本提级清扫无视觉回归**。
- UX Score：Overall **8.2** 维持。

### R25（2026-08-25）工作区隔离 e2e ✅ ALL PASS（4 项）+ 套件 14/14 green
- `validate-r25.cjs`：默认世界线存在 → 菜单新建「武侠世界」（自定义 prompt 对话框）→ 新工作区列表隔离（仅自动新建的空线，不含默认世界的线）→ 切回默认世界原线恢复。截图 r25-01。
- `run-cdp-suite.ps1` 纳入 r25：**SUITE SUMMARY: 14/14 green**。
- UX Score：Overall **8.1** 维持。功能验证器 ×12 + 审计 ×4。
### R79（2026-08-27）五项用户反馈修复：选项/流式卡顿/灵动岛/入场动画/按钮统一 ✅ 全部闭环
- **用户反馈五问**：①AI 不给按钮选项 ②流式输出卡顿 ③灵动岛只显示无动画 ④重开程序无入场动画 ⑤面板按钮统一右上角。
- **③④同根因（大发现）**：styles.css 曾有全局 @media (prefers-reduced-motion: reduce) 一刀切（*,*::before,*::after 动画压成 .01ms）+ #splash{display:none}。用户 Windows 关闭了「动画效果」→ 全应用动效被系统误杀。修法：按产品决策移除两处封锁，品牌仪式动效永远播放。
- **①三层修复**：(a) kernel.md【131b 选项输出契约】每幕必出 A. 格式单行纯文本选项（kernel.md 此前带只读属性 R，attrib -R 改后恢复）；(b) parseChoices 加固——清除行内全部 * 残星、补全角分隔符 ．与全角键 Ａ-Ｈ／１-８ 归一；(c) UI 兜底——模型未给选项时渲染 3 个虚线「建议行动」按钮（SIXWORLDS_TEST 下不注入，防污染 e2e）。
- **②卡顿双修**：main.cjs chat:send 增量合并（50ms 窗口攒批 + finally 冲刷保尾字）；renderer flushStream 改 appendData 追加式写 DOM（旧法每帧整段重写，成本随篇幅 O(n²) 增长）。
- **⑤统一右上角**：画廊头部新 .gallery-head-actions 动作簇（保存全部/导出/关闭）；主题弹层补 .theme-pop-head + 关闭钮（原先只能点外部关闭）。
- **意外捞获（历史损坏）**：main.cjs image:generate 里 usage/cost 提取块被插在 fetch 之前引用未声明的 data → TDZ ReferenceError → 自动插图 100% 静默失败；移回 data 解析之后修复。另：SIXWORLDS_TEST=1 跳过首启引导流（向导遮罩曾拦截 e2e 点击）。
- **验证矩阵**：probe-r79-motion.cjs 8/8 ALL PASS（CDP 模拟 reducedMotion=reduce：splash display≠none 且子元素 splash-breathe@7s 在跑、island-breath/island-scan 在跑、通用过渡未压缩）；test-choices.cjs 14/14 ALL PASS；e2e-mock.cjs **80/80 ALL PASS**（含 streaming-final-complete / stream-no-cursor-left / auto-illust-b64 / token-usage-shown——顺带修正两处过期断言：#chat-meta 已废 → 模型芯片用量面板；btn-win-close 销毁窗口致 Playwright 抛错 → evaluate 点击）。

### R80（2026-08-27）预设收敛×Claude 原生协议×画廊还原原型×设置窗右上角 tabs ✅ 全绿
- **用户反馈三问**：A.设置窗标签页按钮应在右上角且窗口宽度很别扭 B.文本模型提供商收敛为 deepseek/openai/claude/智谱/自定义 OpenAI 兼容端点 C.画廊「完全有问题」要求对照原型图。
- **附带澄清**：用户贴的 ERROR image.png (this model does not support image input) 非应用 bug——消息体纯文本透传全库无图片通道，系外部工具管道喂截图给非视觉模型；friendlyError 已加中文映射兜底提示。
- **B.预设收敛**：app.js PRESETS / WIZ_PRESETS / settings.js PRESETS / settings.html #set-preset 四处裁剪为五项，新增 claude={Claude, https://api.anthropic.com, claude-sonnet-4-5, protocol:anthropic}；旧 preset（moonshot/qwen/silicon）加载迁移→custom（保留地址密钥模型行为不变）；set-preset change 与 save 时 cfg.protocol 联动持久化。
- **B.Claude 原生协议**：main.cjs chat:send 按 isAnth 分派——POST {base}/v1/messages、headers x-api-key+anthropic-version:2023-06-01、system 独立参数+max_tokens 8192 必填；SSE 解析 content_block_delta.text_delta / message_start·message_delta usage；非流式分支解析 content[] blocks；reasoning_effort 仅 openai 协议发送；net:test anthropic 走 GET /v1/models 同 headers。
- **A.设置窗**：BrowserWindow 560×700→640×720（minW 460 minH 440）；.modal-tabs 改右上角胶囊组（justify-flex-end、999px 圆角、active 琥珀描边 panel-2 底），modal-head 加 border-bottom 分隔线。
- **C.画廊还原原型 K**：头部仅剩 标题+数量+关闭；保存全部插图/导出为故事存档 移回工具条与 worldline 下拉同行（右端对齐），删除附加 hint 文案与世界线 label span（原型无此二者）。
- **测试资产修复**：verify.cjs 三处陈旧断言——sigil 改元素存在性检查（R7x 起纯 SVG 无 textContent）、主题块重写对齐 R7x 语义（data-theme 恒解析 system 由应用侧解析 + #theme-pop .theme-mode 选择器）、btn-win-close 点击销毁竞态改 evaluate+catch（同 e2e-mock 处理）。
- **验证矩阵**：node --check ×4 ✓；test-choices 14/14 ALL PASS；e2e-mock 80/80 ALL PASS；verify.cjs **34/34 全绿**；probe-r80-visual facts 断言——presetOptions=deepseek|openai|claude|zhipu|custom ✓、tabsJustify=flex-end ✓、gallery head=[title-wrap,close] 且工具条=下拉+保存全部+导出 ✓ 无 hint。
### R81（2026-08-27）需求纠偏回滚：窗控钮=窗口控制/画廊即时关/设置 4:3 ✅ 全绿
- **需求纠偏**：用户澄清「设置标签页按钮」指设置窗口的最小化/最大化/关闭三颗**窗口控制钮**（非页签样式）；R80 的提供商收敛（五项预设+Claude 原生协议+迁移守卫）被要求**全部恢复原状**，本轮完整撤销——PRESETS/WIZ_PRESETS/#set-preset 恢复七项（deepseek/openai/moonshot/zhipu/qwen/silicon/custom），main.cjs 撤掉 anthropic 分派/fetch/SSE/非流式/net:test 全部分支代码，删迁移 guard。
- **设置窗**：BrowserWindow 改标准 4:3（1024×768，min 820×616）；.modal-head-actions 右上角贴边，min/max/close 三钮统一 46×44 通高、border-radius 0、关闭悬停红块（标准 Windows 窗控观感）；标题栏 padding 左 8 右 0 使 close 完全贴角。
- **画廊关闭 bug（真因）**：`.gallery-head` 曾设 -webkit-app-region:drag——拖拽区在刚开场的重绘/大图解码窗口期会吞 click。修复：整头撤掉 drag 区（窗口本可从主标题栏拖动）；#btn-gallery-close 加 pointerdown 即时响应；画廊 img 补 decoding=async 防大图解码阻塞。
- **探针 probe-r81.cjs（新增）**：SETTINGS_FACTS close={x:977,y:1,w:46,h:44} 贴右上 ✓；presetOpts 七项 ✓；GALLERY_TIMING 打开后 120ms 即点关→256ms 完成（含 160ms 淡出）、复开关 35ms ✓、无 pageerror ✓。12 张 1024×576 大 SVG 种图压力下依然秒关。
- **关于 ERROR image.png (this model does not support image input)**：再次确认与本应用无关——对话请求纯 JSON 文本全库无图片通道；该报错文案格式与开发工具链的模型管道一致（截图喂给了不支持视觉输入的模型）。设置端已保留中文友好映射（friendlyError）仅作兜底提示。
- **验证矩阵**：node --check ×3 ✓；test-choices ALL_PASS；e2e-mock ALL_PASS（80 项）；verify.cjs **34/34**；probe-r81 7/7 PASS。版本 1.1.2→**1.2.0**，NSIS+便携版重建，dist 仅存 1.2.0 双产物。
### R82（2026-08-27）设置窗 4:3 等比缩小 40% ✅ 全绿
- 1024×768 → **614×461**（min 500×380），维持 4:3。probe-r81 复测：OPEN_SIZE=614x461 ✓、窗控三钮仍贴右上角 ✓、画廊即时关闭 265ms/复开 18ms ✓、e2e-mock ALL_PASS。版本 →**1.2.1**，重建双产物，dist 仅存 1.2.1。
### R83（2026-08-27）选项按钮「完全无关」修复 ✅ 全绿
- **根因（用户截图确诊）**：该回复是开场设定的自由问答，模型没按契约输出【A】选项，于是触发 R78 兜底——三条**写死**的通用建议（继续推进/调查周围/等待发展），在"创建角色"场景自然驴唇不对马嘴。
- **兜底 v2（上下文化，两档）**：① `extractQuoteChoices`：从回复原文提取「引号候选清单」做按钮（发送时映射为【A】…键位）；触发条件收紧——同行并列 ≥2 个引号项，或 ≥2 个列表符行各含引号；**散落的单个专名/对白绝不误伤**。② 提取不到才落回原通用三条。测试环境下通用三条维持禁用（不污染 e2e），引号分支为确定性内容映射故允许渲染并可测。
- **新用例**：fallback-quote-count/contextual/keys/click-send（截图同款 3 设定列表→3 钮、点 B 发送含【B】米里斯）、fallback-quote-suppressed（叙述内两处零散引号→0 钮）、fallback-quote-multiline（多行列表形态→2 钮）。test-choices 14→**21 项** ALL_PASS。
- **验证矩阵**：node --check ✓；test-choices **ALL_PASS(21)**；e2e-mock ALL_PASS；verify.cjs **34/34**；打包版冒烟 probe-r77b **8/8 ALL PASS**。版本 →**1.2.2**，NSIS+便携版重建，dist 仅存 1.2.2。
- **另**：开发工具链收图问题已修——opencode 配置中 glm-5.3-flash 的 input 由 ["text"] 改 ["text","image"]（根因是客户端声明拦截，非模型不支持），用户重启 opencode 后即可贴图。
### R84（2026-08-27）「收起」按钮无反应修复 ✅ 全绿
- **根因**：#choices 与消息列表为兄弟节点；点「收起」→ 选项区塌缩 → 消息区变高、用户置底时 scrollTop 被钳制 → 触发一次 msgEl scroll 事件 → 处理器里 `near && choicesFoldUser` 命中"回到底部自动展开"分支 → **收起被立即撤销**，肉眼即"没反应"。
- **修复**：置底自动展开只复位 `choicesAutoFolded`（翻历史自动收起）；玩家手动收起 `choicesFoldUser` 保持粘性，仅可经「展开选项」胶囊或新一幕置底重渲（1708 行既有产品行为）解除。上滑收起分支同时加 `!choicesFoldUser` 防止覆盖手动意图。
- **测试（有咬合力验证）**：新增 4 用例 fold-collapses / fold-pill-visible / **fold-stays-collapsed-after-scroll-event**（注入 40 段高内容制造滚动钳制，确保 scroll 事件真实触发）/ pill-re-expands。**证伪**：临时还原旧逻辑 → fold-stays 用例 FAIL（复现成功），恢复修复 → ALL_PASS。test-choices 21→**25 项**。
- **验证矩阵**：node --check ✓；test-choices **ALL_PASS(25)**；e2e-mock ALL_PASS；verify.cjs **34/34**（首跑 electron.launch 偶发崩溃系与 e2e 并发抢占，复跑全绿）；打包版冒烟 probe-r77b **8/8 ALL PASS**。版本 →**1.2.3**，重建 NSIS+便携版，dist 仅存 1.2.3。