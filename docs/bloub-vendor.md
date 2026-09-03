# bloub 机器人（内嵌资产说明）

## 这是什么

「世界之灵」小机器人：一个会呼吸、眨眼、思考的 SVG 化身，出现在原型工作台的两个位置——

- **空会话引导区**：76px 待机机器人，播放收敛的待机循环（呼吸 / 思考 / 眨眼 / 惊讶 / 通知），视线跟随鼠标（休息脸状态下接管）；
- **忙碌灵动岛**：生成叙事期间 22px 的 `thinking` 姿态机器人（打字机三点脉动），回合结束随岛收纳。

身体填充取 `--text`、眼「洞」取 `--canvas`（画布底色），逐帧重读 CSS 变量——明暗主题与调色板切换即时生效，无需重建实例。

## 文件

| 文件 | 角色 |
| --- | --- |
| `shared/bloub.js` | 引擎（一次性转译的上游 `src/bot` + `src/ui/gaze`，IIFE，全局 `window.Bloub`，约 20KB） |
| `shared/bloub-mount.js` | 挂载层（`window.BloubMount.mount(el, opts)`：SVG 组装、rAF 驱动、视线跟随、主题变量、自清理） |
| `docs/bloub-LICENSE` | 上游 MIT 许可证原文 |

挂载层特性：

- **免簿记生命周期**：每帧检测 `svg.isConnected`，宿主被外部全量重绘移除时自动停帧销毁（`renderMessages` 重建引导区时零泄漏）；
- **多实例安全**：mask / gradient id 携带随机后缀；
- **降级保护**：引擎缺失或异常时，引导区回退静态印章、忙碌岛回退 CSS 呼吸圆点，不阻断功能。

## 上游与许可

- 引擎来源：<https://github.com/jeremy-prt/bloub>（v0.3.0，MIT License，© 2026 Jérémy Perret）
- 上游是 x.ai（Grok）头像的 SVG 复刻：**代码 MIT；机器人造型设计的版权归 x.ai**。六面世界仅将其作为内部界面点缀（生成状态指示与引导页陪伴），不将其作为设计资产对外分发。本项目与 x.ai 无关联、未获其背书。
- 引擎特性：`sample(t)` 是时间的纯函数（framework-free / clock-free），同一状态序列重放逐字节一致——`scripts-dev/test-bloub.cjs` 用 3000 帧双轮重放锁定了这一性质。

## 裁剪说明（相对上游）

仅一处数学等价裁剪：**eyefit 眼睛避让求解器与 skins 自定义形状库未纳入**。eyefit 只为非圆形的自定义形状求眼睛偏移；本项目固定使用默认圆形（`cercle`），其求解表输出恒为 `{x:0, y:0}`（圆的两种轮廓相同，margin 即标称值，首轮即出）。`shared/bloub.js` 中以零常量内联替代，见文件头注释。若未来需要形状自定义器，需从上游重新纳入 `eyefit.ts` + `skins.ts`。

## 重新生成 shared/bloub.js

上游更新不自动同步。需要跟进时：

```bash
git clone --depth 1 https://github.com/jeremy-prt/bloub
# 1) 拷贝 src/bot/{math,repere,profiles,decor,face,cycles,shape,expressions,states,engine}.ts
#    与 src/ui/gaze.ts 到独立目录（剔除 *.test.ts、skins.ts、eyefit.ts）
# 2) engine.ts：把 `import { decalageDesYeux } from './eyefit'` 替换为零常量（见文件头注释）
# 3) 桶导出 BotEngine / STATE_BY_ID / STATE_IDS / defaultCycle / blockAt / offsetOf /
#    totalDuration / lookTarget / TURN_TIME
npx esbuild <入口.ts> --bundle --format=iife --global-name=Bloub \
  --charset=utf8 --legal-comments=none --minify --outfile=shared/bloub.js
# 4) 保留原文件头注释（出处 + 裁剪说明 + 再生成命令），跑 node scripts-dev/test-bloub.cjs 校验
```

## 测试

- `scripts-dev/test-bloub.cjs`（单元层）：15 状态合法性、3000 帧确定性、眨眼活性、挂载层契约；
- `scripts-dev/test-bloub-e2e.cjs`（桌面层）：真实 Electron 渲染下挂载 / 逐帧动画 / 视线跟随 / 主题翻转 / 忙碌岛 thinking 姿态 / 自清理 / 重挂载。

## 桌宠本地小模型（世界之灵的离线大脑）

bloub 造型本身不含对话能力；本仓库在主进程接入 node-llama-cpp 常驻推理（`main.cjs` 的 PetModel 段）：

- **模型**：预置一个约 400MB 的小模型（GGUF q4_0），经 hf-mirror 镜像下载到 `userData/pet-model/`，
  一键接入按钮 → 二次确认（只提示大小不提示型号，产品需求）→ 下载进度 → 自动加载常驻；
- **后端**：node-llama-cpp v3.x，Windows 上带 Vulkan（无独显/无 CUDA 的机器自动落 CPU 后端）；
  ESM-only（顶层 await），主进程 CJS 里必须 `await import('node-llama-cpp')` 动态加载；
- **会话**：常驻 `LlamaChatSession`（`model.createContext()` → `context.getSequence()`，v3 构造签名
  需要单 options 对象，`systemPrompt` 字段名勿写成 `systemMessage`），KV 缓存跨回合复用，0.5B 二答约 1s；
- **路由**：应用类问题由 `shared/bloub-pet.js` 的规则库精准回答（0.5B 对应用事实易幻觉），
  规则未命中的闲聊才走 `pet:chat` 流式（50ms 攒批 `pet:chat-delta`，渲染层打字机匀速放出）；
- **人设**：运行时正本在 `shared/pet-model-prompt.cjs`（人设 + 应用事实清单 + 「不确定就说不知道」），
  `bloub-pet.js` 里的 `PET_SYSTEM_PROMPT` 是展示副本；
- **打包**：electron-builder 需把 `node_modules/node-llama-cpp` 与 `@node-llama-cpp/win-x64{,-vulkan}`
  同时收进 `files` 并 `asarUnpack`（native `.node` 不能在 asar 内 dlopen）；CUDA / arm64 / 其他平台
  后端显式排除，安装包从 393MB 瘦回 165MB；
- **测试接缝**：`SIXWORLDS_PET_FAKE=1` + `SIXWORLDS_PET_MODEL_URL=<本地慢速源>` 走真实下载管线 +
  假推理（脚本化流式回复），CI 里完整覆盖按钮 → 确认 → 进度 → 就绪 → 问答路由，全程不真下 400MB。

## 双大脑路由与回复清洗（v1.4.1）

桌宠对话的「聪明程度」由三层路由决定（`shared/bloub-pet.js` → `main.cjs` `pet:chat`）：

1. **规则库**（渲染层）：应用类问题（快捷键/主题/未落账等 12 组关键词）精准命中，模型幻觉零容忍区；
2. **云端大脑**（主进程 `petCloudChat`）：用户在设置里配置的 OpenAI 兼容模型——更聪明、知识在线、
   注入当前时间上下文。流式 SSE 走 pet 自己的 `pet:chat-delta` 通道，绝不碰故事生成管线
   `chat:delta`；失败自动回落本地（用户无感）。密钥由 app.js 内存注入
   `BloubPet.setCloudBrain(cfg)`，不落 localStorage、不进渲染持久化；
3. **本地小模型**（0.5B）：离线兜底，断网/无配置也能聊。

回复出口统一过 `shared/pet-reply.cjs` 清洗管线：剥幻觉 UI 舞台指示（`[点击后显示一个插画]` 类方括号
片段）、markdown 语法渣（**加粗**/# 标题/列表符）、重复标点收束、超长保留开头整句（≤220 字）。
打字机流式的尾帧以清洗后全文为权威兜底。

视线跟随的归一化基准在挂载层（`bloub-mount.js` `aim()`）：上游按「窗口半宽」归一会让贴边桌宠
全屏指针都饱和在一侧（眼睛钉死）；本仓库改为以桌宠为中心的短半径饱和（±600/±500px），
指针在真实活动范围内线性摆动。e2e 以「指针左/右/贴脸三位置的眼睛平移分量差」断言（35px+），
不再只查 transform 属性存在。

## 智能体能力（v1.4.2）

桌宠从「会聊天」升级为「会做事」。四个技能全部走同一条管线：

- **意图路由**（`bloub-pet.js` `detectAgentIntent`）：自然语言命中智能体动词（推荐选择/托管 N 轮/
  哪幕配图/优化生图提示词）时不闲聊，直接执行；未命中才走双大脑闲聊。轮数上限 5。
- **结构化决策**（`main.cjs` `pet:agent`）：任务化系统提示词要求严格 JSON；出口做三层容错——
  剥 markdown 围栏、截取首 `{` 到末 `}`、按任务校验（推荐键必须属于给定选项、illust idx 不越界、
  prompt 不过短），非法即拒绝而不是猜。判断只交给云端模型（0.5B 推不动剧情质量）。
- **执行能力面**（app.js `BloubPet.bindAgent`，纯新增注入）：读当前选项 / 代点选项（复用既有
  `send('【键】描述')` 路径，完整走状态引擎）/ 读剧情尾 / 幕候选 / 触发 `generateIllust`
  （可带智能体优化过的英文提示词）。智能体碰不到密钥与会话存储。
- 托管循环逐轮「推荐→代选→等这一轮生成完→下一轮」，每轮在气泡里汇报选择与理由；
  「停止托管」按钮 / Esc 随时中断。配图技能在生图端点未配置时守卫提示，不盲发请求。

e2e 里托管是真跑的：mock 剧情带【A】【B】选项，FAKE 接缝只替代「判断」环节，代选后的
整轮生成、状态引擎、选项重渲染都走真实路径。
