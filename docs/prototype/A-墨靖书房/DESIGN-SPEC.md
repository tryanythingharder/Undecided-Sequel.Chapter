# DESIGN SPEC · A 墨靖书房（线装书架构 v2）

版式根基：一部**线装书**。书脊在右（仿古籍从右向左翻），鱼尾界栏分节，朱批居于右缘，落账是盖下的朱砂印。全页只有一处允许高饱和——朱砂；其余交给宣纸、墨与群青的秩序。

## 色彩 Token（命名色）

| Token | 宣纸昼 | 靛夜 | 用途 |
|---|---|---|---|
| `--paper` | `#F2F1EB` | `#14161D` | 案面底 |
| `--page` | `#FAF9F4` | `#1A1E29` | 书页（浮起面） |
| `--ink` | `#26292F` | `#D9DEE8` | 正文墨 |
| `--indigo` | `#2F4C7E` | `#8CA6D8` | 群青：主操作/选中/靛线 |
| `--cinnabar` | `#B8402E` | `#D65540` | 朱砂：印记/落账（克制使用） |
| `--moss` | `#4F7455` | `#82A687` | 苔青：成功 |

对比度实测：正文 昼 12.88:1 / 夜 13.39:1（WCAG AAA 级）。

## 字体角色

- 楷体（`Kaiti SC/KaiTi/STKaiti` 栈）——叙事正文：手稿气质，两字缩进 + inter-ideograph 对齐
- 系统黑体——界面元素
- 等宽（`Cascadia Code/Consolas`）——账目数字、卷号

## 版式构件（独有）

- **书脊书签舌**：`writing-mode: vertical-rl`，右侧 64px 常驻；每舌带装订孔（binding-eye 伪元素）；IF 线特殊标记
- **鱼尾界栏**：宋版书「鱼尾」符号（clip-path polygon）+ 场景文本 + 延伸细线，分隔每幕场景行
- **朱批**：`.zhu-note` 右对齐、朱砂竖排「批」签头、悬停浮现操作（抄录/另开一线/配图）
- **便笺选项**：`--tilt` 随机微倾的笺纸（nth-child 变换）
- **落印**：`.beat-seal` 朱砂印 keyframe `seal-in`（scale 2→0.94→1 + 旋转），文案「印已入账 · N 笔」
- **纸纹**：内联 SVG feTurbulence data-URI 生成纸颗粒（离线无请求）

## 动效令牌

`--dur-1..4 = 130/200/260/460ms`；`--ease-std cubic-bezier(.2,0,0,1)`；落印专用 `--ease-seal cubic-bezier(.34,1.35,.42,1)`（过冲回弹）。
启动四段编排：`scroll-unfurl`（卷轴展开）→ `drop-fall`（墨滴坠落晕开）→ `seal-stamp`（六印浮现）→ `scan-sweep`（扫描线定版）。

## 桌宠

墨滴「世界之灵」：SVG 径向渐变墨滴 + 面部 + 高光。状态机：ink-breathe（呼吸）→ think（思考气泡）→ sleep（入睡 Zzz）→ pulse（落账时脉冲）→ shake（被戳晃动）。

## AI-tell 规避（frontend-design skill 原则映射）

- ✗ 无 cream+terracotta 组合（宣纸偏灰 `#F2F1EB` 而非奶油色，朱砂 `#B8402E` 非赤陶）
- ✗ 无 ALL-CAPS 英文眉标（中文语境用竖排汉字签头「批」）
- ✗ 无等宽字体做数据标签的 SaaS 感（等宽只用于卷号账目）
- ✗ 无「→」按钮（选项是笺纸，箭头是汉字语境的「[选]」式符号）
- ✓ 每页一个标志性瞬间：落印动画是全页唯一的高饱和时刻
- ✓ 动效克制：除落印/呼吸外全部 ≤260ms 功能性过渡

## 无障碍

- 正文对比度 12.88–13.39:1；交互态全部可达键盘；焦点环群青 2px
- `prefers-reduced-motion` 全局尊重 + 主题册手动动效开关
- aria-label 覆盖书脊/册页/砚台；toast 区 aria-live="polite"
