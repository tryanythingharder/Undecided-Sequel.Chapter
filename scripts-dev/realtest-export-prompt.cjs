// 把真实模型产出的精修规划 + 用户画风前缀 + 管线后缀拼成「应用实际发送」的逐字提示词
const fs = require('fs')
const path = require('path')
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test-shots', 'refined-plan.json'), 'utf8'))

// 与 shared/illust-panel.js ILLUST_STYLES['ln-original'] 逐字一致（用户配置的画风）
const STYLE = 'Japanese light novel illustration, faithfully styled after the original Mushoku Tensei: Jobless Reincarnation novel illustrations by Shirotaka: clean refined lineart with delicate watercolor-like coloring, soft luminous lighting, gentle color gradients, subtle paper texture, expressive finely-drawn faces, meticulous medieval-fantasy costumes and magic details, warm slightly nostalgic palette, dreamy fantasy atmosphere, composed like a light-novel frontispiece, single key scene, high quality, no text, no watermark, no logo'

// 与 shared/holo-card.js generateCard 的拼装逻辑逐字一致
const subj = STYLE + '. ' + plan.subjectPrompt + ', full body, standing pose, plain white background, solid white background, no text, no watermark'
const bg = STYLE + '. ' + plan.backgroundPrompt + ', no people, no characters, no text, no watermark'

const out =
  '=============================================\n' +
  ' 六面世界 · 精修立绘提示词（角色：玩家角色 · ' + plan.subtitle + ' · ' + plan.rarity + '）\n' +
  ' 以下为应用实际发送给生图 API 的逐字版本\n' +
  '=============================================\n\n' +
  '[1] 主体立绘 · 最终版（尺寸 1024x1024，quality: high）\n' + subj + '\n\n' +
  '[2] 卡面背景 · 最终版（尺寸 1024x1536，quality: high）\n' + bg + '\n\n' +
  '---------------------------------------------\n' +
  '（规划师原始输出——不带画风前缀与约束后缀，想换画风/自己改细节从这版动手）\n\n' +
  '[1] 主体立绘 · 原始版\n' + plan.subjectPrompt + '\n\n' +
  '[2] 卡面背景 · 原始版\n' + plan.backgroundPrompt + '\n\n' +
  '---------------------------------------------\n' +
  '卡面文案：称号 ' + plan.subtitle + ' ｜ 招式 ' + plan.technique + ' ｜ tagline ' + plan.tagline + '\n' +
  '设计思路：' + plan.why + '\n'

fs.writeFileSync(path.join(__dirname, '..', 'test-shots', 'refined-prompts.txt'), out)
console.log(out)
