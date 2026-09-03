/*
 * 六面世界 · 桌宠回复清洗与上下文（shared/pet-reply.cjs，主进程 require + 单测直测）
 *
 * 0.5B 本地模型常吐不适合气泡展示的残渣（实测样本：「[点击后显示一个插画]」这类幻觉 UI
 * 舞台指示、markdown 语法渣、重复标点、两三百字流水账）。清洗统一放在主进程出口，
 * 打字机流式的尾帧以清洗后的全文权威兜底，渲染层无需关心。
 */
'use strict'

/** 清洗模型原始输出 → 适合桌宠气泡的短净文本 */
function sanitizePetReply(raw) {
  var t = String(raw || '').replace(/\r/g, '')
  // 1) 幻觉 UI/舞台指示：方括号短片段整段剔除（[点击后显示一个插画] / [画面：…]）
  t = t.replace(/\[[^\]\n]{0,80}\]/g, ' ')
  // 2) markdown 语法渣：**加粗**、*斜体*、标题符、列表符
  t = t.replace(/\*\*([^*\n]{1,60})\*\*/g, '$1')
  t = t.replace(/(^|[\s（(])\*([^*\n]{1,60})\*/g, '$1$2')
  t = t.replace(/^#{1,6}\s*/gm, '')
  t = t.replace(/^\s*[-•]\s+/gm, '')
  // 3) 标点与空白规整（先去行首尾空白，再收多余换行——删括号段会留下孤立空行）
  t = t.replace(/([。！？!?~])[。！？!?~]+/g, '$1')
  t = t.replace(/[ \t]{2,}/g, ' ')
  t = t.replace(/[ \t]+$/gm, '')
  t = t.replace(/^[ \t]+/gm, '')
  t = t.replace(/\n{3,}/g, '\n\n')
  t = t.trim()
  // 4) 超长收束：桌宠两三句为宜，>220 字保留前几句整句（~200 字内）
  if (t.length > 220) {
    var parts = t.match(/[^。！？!?~]*[。！？!?~]?/g) || [t]
    var out = ''
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue
      if (out.length + parts[i].length > 200 || i >= 5) break
      out += parts[i]
    }
    t = out.trim() || t.slice(0, 200)
  }
  return t
}

/** 时间感知上下文（模型没有实时钟，注入当前时间让「今天几号」类问题能答） */
function timeContextLine() {
  var d = new Date()
  var week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  var p = function (n) { return String(n).padStart(2, '0') }
  return '（现在是 ' + d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() +
    '日 ' + p(d.getHours()) + ':' + p(d.getMinutes()) + '，星期' + week + '）'
}

module.exports = { sanitizePetReply: sanitizePetReply, timeContextLine: timeContextLine }
