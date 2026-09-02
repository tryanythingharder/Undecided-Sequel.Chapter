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
