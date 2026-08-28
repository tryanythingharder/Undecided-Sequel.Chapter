# 「六面世界」主观视觉走查报告

> **实施状态（本轮已落地）**：立即做 4 项 + 下迭代 6 项共 10 项全部实现——① 选项卡片化 ② 弹层统一进出场（popin/popout + 模态离场淡出）③ 阴影收敛 12/32 ④ hover 归并 .12s ⑤ chat-meta 并入用量面板 ⑥ choices-head 字号 ⑦ multi-bar 实线 ⑧ 间距对齐 26px ⑨ 调色板联动字体/密度默认值 ⑩ 状态点去琥珀化。详见 README 功能表。

> 维度：动效节奏 / 留白呼吸感 / 层级与视觉重量 / 质感一致性 / 氛围建议。
> 严重程度：高（应立即修）/ 中（本次迭代内）/ 低（可缓）。位置均为 `renderer/styles.css` 行号，另有 HTML 结构位置单独标注。

---

## 一、动效节奏

### 1.1（中）hover 反馈时长散点：.1s / .12s / .15s 混用
- 位置：`.model-opt:717`、`.rail-node:1026`、`.gallery-card:825`、`.composer-box:557`、`.msg-tools:326`、`.msg-time:330`
- 为什么不对：全站绝大多数纯 color/background hover 是 `.12s`，但同为列表项的 `.model-opt` 用 `.1s`（与 `.ws-menu-item`/`.session-item` 同类却不同速）；`.rail-node` 同一元素 `transform .1s` + `background .12s` 内部打架。手指/视线来回扫时，几个同构组件的反馈速度参差，显得"没调过"。
- 修法：
```css
.model-opt { transition: background .12s, color .12s; }
.rail-node { transition: transform .12s, background .12s; }
/* .composer-box / .gallery-card 含 focus 光环与 translateY 抬升，保留 .15s 可接受 */
```

### 1.2（高）「有头无尾」：进场有动画、离场瞬断
- 位置：`.modal:622/625`、`.gallery:787/790`、`.confirm:897`、`.search-bar:924/926`、`.scroll-bottom:981/984`、`.choices:508`、`.model-pop:1259/1261`、`.theme-pop:1283/1285`、`.rail-pop:1042/1044`；以及裸出现的 `.ws-menu:166-172`、`.model-dropdown:694-702`
- 为什么不对：进场 fade/modalin 精心做了，关闭却靠 `[hidden]{display:none}` 直接消失；`.ws-menu` 与 `.model-dropdown` 连进场都没有，硬生生弹出来。收场是最能暴露"工程感"的地方。
- 修法（统一进/出成对，JS 关闭前挂 `.leaving`，`animationend` 后再置 `hidden`）：
```css
.ws-menu, .model-dropdown, .model-pop, .theme-pop, .rail-pop { animation: popin .14s ease-out; }
.leaving { animation: popout .12s ease-in forwards !important; }
@keyframes popin  { from { opacity: 0; transform: translateY(-4px); } }
@keyframes popout { to   { opacity: 0; transform: translateY(-4px); } }
```
- 备注：`.choices` 收起属内容折叠，宜改 `max-height` 过渡而非 `display:none`；`.choices-expand:1235` 出现时同样补 `popin`。

### 1.3（中）弹层时长七档未收敛
- 位置：fade .12/.14/.15/.16/.18/.2/.3s 并存（`.confirm-mask:891`、`.model-pop:1259`、`.modal-mask:611`、`.confirm:897`、`.modal:622`、`.choices:508`、`.empty:472`）
- 建议：弹层（popover）统一 `.14s`、遮罩统一 `.15s`、居中模态统一 `.18s`；`.empty .3s` 作为首屏叙事可保留更长。

---

## 二、留白呼吸感

### 2.1（中）26px 横向线贯穿，但头部未与 720px 阅读栏对齐
- 位置：`.chat-header:290`、`.messages:312`、`.choices:505`、`.composer:550`、`.search-bar:922`
- 为什么不对：五个容器的 26px 内边距一致（好），但正文栏 `max-width:720px` 居中，`.chat-header` 却是通栏、标题贴左右边缘——头部的左缘与正文左缘不落在同一条竖线上，视线上缘"飘"。
- 修法：
```css
.chat-header > * { max-width: calc(var(--read-w) + 52px); margin: 0 auto; width: 100%; }
```

### 2.2（中）choices 与 composer 间距偏紧、列宽与正文差 26px
- 位置：`.choices:505`（底 10px）+ `.composer:550`（顶 8px）= 18px；`.choices:507`/`.composer-box:552` 宽 772px vs 正文 720px
- 为什么不对：选项是"当前可行动作"，和输入框挤成 18px，弱于消息间 22px 的呼吸；同时选项/输入框比正文左右各宽 26px，三栏左边线错位。
- 修法：
```css
.choices { padding-bottom: 16px; }
.composer { padding-top: 10px; }   /* 合计 26px，与 messages 纵向节奏对齐 */
```

### 2.3（中）choices-head 过挤、字号过小
- 位置：`.choices-head:1224`、`.choices-title:1225`（9.5px）、`.multi-toggle:1226`（10px/3px 10px）
- 为什么不对：9.5px 标题 + 两个 3px 高的胶囊钮，密度远超侧栏 session-label（10px）；标题比按钮还小，主次倒置。
- 修法：
```css
.choices-title { font-size: 10.5px; }
.multi-toggle, .choices-fold { font-size: 10.5px; padding: 4px 12px; }
```

### 2.4（低）composer-foot 一行过载
- 位置：`.composer-foot:566`、`.foot-select:1270`（10px/3px 4px）
- 为什么不对：hint + 两个 select + 发送钮挤一行，10px 字号 select 触达区太小。建议窄屏时把 hint 与 foot-select 换行（`.composer-foot{flex-wrap:wrap}`），或把两个 select 并入一个「模型 · 思考」chip 弹层。

---

## 三、层级与视觉重量

### 3.1（高）选项按钮是全屏视觉重量最轻的元素，却是核心交互
- 位置：`.choice:510-518`（透明底、text-dim、13px）
- 为什么不对：发送键是实心琥珀、composer-box 有边框、连 multi-bar 都比选项醒目；选项作为推进剧情的主入口却是"飘着的文字"，首次用户容易以为不可点。
- 修法：
```css
.choice { background: var(--panel); border: 1px solid transparent; }
.choice:hover { border-color: var(--accent-dim); background: var(--panel-2); }
.choice.picked { border-color: var(--accent-dim); background: var(--accent-glow); }
```

### 3.2（中）chat-head-right 四个元素同挤一角，嘈杂
- 位置：`.chat-head-right:294`、`.chat-meta:295`、`.model-chip:1244`、`.chat-status:297`
- 为什么不对：chip、meta 都是 10px 淡色 mono，加上脉动状态点，三块灰字在右上角互相稀释。建议：`chat-meta` 并入 `model-pop` 面板（本来就是元数据），头部只留 chip + status；或 `chat-meta{opacity:.7;max-width:180px}` 降权。
- 修法：
```css
.chat-head-right { gap: 8px; }
.chat-meta { opacity: .7; max-width: 180px; } /* 更进一步：移入 .model-pop */
```

### 3.3（中）choices 纵向栈无主次
- 位置：`.choice:510-518`
- 为什么不对：所有选项同权（text-dim），没有「推荐/默认」与其余的分层。可给首个/推荐项加左侧琥珀条（复用 `.session-item.active::before` 手法）作为视觉锚点。

### 3.4（低）设置窗 h3 比 label 字号小
- 位置：`.set-group h3:666`（10px） vs `.set-group label:673`（11.5px）
- 为什么不对：标题靠 mono+大写+字距+下划线撑起层级，勉强成立，但字号反小于标签。建议 h3 提到 11px 或 label 降到 11px，让尺寸与角色一致。

---

## 四、质感一致性

### 4.1（中）阴影体系：同类下拉分两档、rail-pop alpha 异类
- 位置：`.ws-menu:170`(8/24) vs `.model-dropdown:699`/`.model-pop:1257`/`.theme-pop:1282`(12/32)；`.rail-pop:1040`(12/32/.4) vs 其余 .35
- 为什么不对：同为"按钮下弹出的菜单"，ws-menu 与 model-pop 用了不同档；rail-pop 阴影比兄弟深一档。建议收敛为三档：小浮钮 4/16、菜单/弹层 12/32、遮罩模态 24/60；lightbox 12/48 保留。
- 修法：
```css
.ws-menu { box-shadow: 0 12px 32px rgba(0,0,0,.35); }
.rail-pop { box-shadow: 0 12px 32px rgba(0,0,0,.35); }
```

### 4.2（中）虚线语义混用：multi-bar 不该用虚线
- 位置：`.new-chat:145`、`.illust-pending:455`（占位/新建，语义正确）；`.multi-bar:541`（活动态，误用）；`.choices-expand:1236`（可接受）
- 为什么不对：虚线在全站 = "空/待填充"，但 multi-bar 是已激活的多选工具栏，用虚线反而像"未就绪"，与它的 accent-glow 底冲突。
- 修法：
```css
.multi-bar { border: 1px solid var(--accent-dim); } /* 活动态用实线 */
```

### 4.3（低）琥珀 accent 一屏约 5-6 处，尚克制但可再收
- 位置：`.chat-status:299`、`.send:569`、`.scene-line:351`、`.ask-line:360`、`.session-item.active::before:252`、`.choice .ck:524`
- 为什么不对：结构用琥珀没问题，但"脉动状态点"与"发送键"同色同权，会抢发送键的主动作位。建议状态点改中性/ok 色，把纯琥珀留给 action + 当前项。

---

## 五、氛围建议

### 5.1（低）正文行高读感良好
- `.msg-body:343` 1.85（14.5px）对 CJK 舒适，`.msg.user` 1.7、`.status-panel` 1.7 分层合理，维持即可。

### 5.2（下迭代）让 7 套调色板联动字体/密度默认值
- 位置：`html[data-palette="paper"]:1091` 等；字体/密度由 `data-font`/`data-density` 独立驱动
- 为什么不对：调色板只换了颜色，没有把"人设"做完——paper 适合衬线、forest 适合宽松、contrast 适合紧凑。
- 建议：仅在**首次选择**该调色板时写入默认字体/密度（不覆盖用户后续手动选择）：
  - paper → `data-font="serif"`；forest → `data-density="relaxed"`；contrast → `data-density="compact"`；codex 保持 mono 点缀。

---

## 优秀刻意设计 · 点名保护清单

- **26px 横向对齐线**：messages/composer/chat-header/search-bar 五处统一，是整套留白的骨架（`.chat-header:290` 等）。
- **toast 进出成对**：`.toast:870` + `.toast.leaving:881` 是全站唯一有完整离场的弹层，应作为"离场标准"推广到所有弹层。
- **lightbox 三段动效**：fadein/fadeout + 图片 zoomin（`:404/:407/:412`），节奏克制。
- **choice hover 左移微交互**：`.choice:516` 的 `padding-left .12s` 位移反馈，是"可点"的轻提示，升级成卡片后务必保留。
- **session-item.active 左侧 2px 琥珀线**：`.session-item.active::before:252`，低噪高识别，可复用到选项推荐项。
- **消息悬停工具条 opacity 揭示**：`.msg-tools:326`/`.msg-time:330`，不打扰、按需出现。
- **focus-visible 焦点环**：`:957` 鼠标点击不显示、Tab 才出现，无障碍做得干净。
- **7 套调色板 danger/ok/overlay 同步收口**：每套 palette 都成对重声明，跨主题一致性高。
- **圆角/密度/字体 data-attribute 驱动体系**：`:1187-1207` 一处覆盖全局，改风格不散落硬编码。

---

## 三档总结表

| 档位 | 事项 |
| --- | --- |
| **建议立即做** | ① 选项按钮加卡片底/边框（3.1，核心交互权重）② 弹层补统一离场 + ws-menu/model-dropdown 补进场（1.2，感受最明显）③ 阴影收敛到 12/32（4.1）④ hover 时长 .1s→.12s 归并（1.1） |
| **建议下迭代做** | ① chat-head-right 去噪、meta 并入 chip 弹层（3.2）② choices-head 字号/间距（2.3）③ multi-bar 改实线（4.2）④ choices↔composer 间距对齐（2.2）⑤ 调色板联动字体/密度默认值（5.2）⑥ 状态点去琥珀化（4.3） |
| **可以不做** | ① composer-foot 换行（2.4，窄屏低频）② 设置窗 h3/label 字号微调（3.4）③ choices 纵向加推荐锚点（3.3，可选锦上添花） |
