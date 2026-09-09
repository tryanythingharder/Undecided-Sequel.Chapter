/* ======== 六面世界 · 选项解析（经典 / 原型工作台 双方案共享，纯函数） ========
 * 双 UI 方案冻结策略下，选项解析在两侧 app.js 是逐字相同的复制体——此为双方案收敛
 * （绞杀者迁移）第一刀：choices。容错规则：①【A】全角括号 ②A./A、/A) 行内字母标记
 * ③1./1、行首数字 ④①②③圈号 ⑤行首列表符号与加粗前缀先剥离；R78 全角字母归一。
 * 测试保护：test-choices.cjs（UI 全链路）+ e2e-mock.cjs 选项断言。
 * 挂载：<script src="../shared/choices.js"></script>（先于 app.js，全局 window.ChoiceParser）
 */
(function () {
  'use strict'

// ①【A】xxx（全角括号） ②A. / A、 / A)（行内字母标记） ③1. / 1、（行首数字） ④①②③（圈号）
  // ⑤行首列表符号 - * • 与加粗 ** 前缀先剥离再匹配
  function parseChoices(text) {
    const out = []
    const seen = new Set()
    const push = (key, label) => {
      let l = (label || '').trim()
      // 剥离尾部残留的选项标记（如 "label A."）——必须带标点才剥，避免误伤正常结尾字母（如 "CANON-H"）
      l = l.replace(/\s*[A-H0-9]\s*[\.、\)]\s*$/, '')
      // 剥离残留的加粗星号（如 "**A.** label" 匹配后标签带 "**" 前缀）
      l = l.replace(/^\*\*\s*/, '').replace(/\s*\*\*$/, '').replace(/^\*\*/, '')
      l = l.trim()
      if (!l) return
      // 去重按 key+文案：叙事里出现多个【你需要决定】块（多组 A/B/C）时，
      // 只有完全相同的选项才会被合并——按钮不会再整组消失
      const dedupe = key + '|' + l
      if (seen.has(dedupe)) return
      seen.add(dedupe)
      out.push({ key, label: l })
    }
  
    let m
    // R78 容错：全角字母 Ａ-Ｈ → 半角（部分端点输出全角编号）；未知符号原样返回
    const normKey = (k) => {
      const c = k.charCodeAt(0)
      return (c >= 0xFF21 && c <= 0xFF28) ? String.fromCharCode(c - 0xFEE0) : k.toUpperCase()
    }
    const re1 = /【([A-HＡ-Ｈ])】([^【\n]*)/g
    while ((m = re1.exec(text))) { push(normKey(m[1]), m[2].replace(/\*/g, '')) }
  
    const lines = String(text).split('\n')
    const circ = '①②③④⑤⑥⑦⑧'
    for (const line of lines) {
      // R78：行首列表符剥离后清除全部残星号（此前只剥两端，`**A.** 文案` 这类解析失败导致无按钮）；
      // 分隔符补入全角句点 ．
      const clean = line.replace(/^\s*(?:[-*•·]\s*)+/, '').replace(/\*/g, '').trim()
      const re2 = /(?:^|\s)([A-HＡ-Ｈ])\s*[\.、\):：．]\s*/g
      const marks = []
      while ((m = re2.exec(clean))) {
        marks.push({ key: m[1], start: m.index + m[0].length })
      }
      if (marks.length === 0) {
        // 行首数字标记：1. / 1、 / 1) / 1:（仅行首，避免误吞正文数字）
        const nm = clean.match(/^([1-8１-８])\s*[\.、\):：．]\s*/)
        if (nm) {
          const digit = (nm[1].charCodeAt(0) >= 0xFF11) ? String.fromCharCode(nm[1].charCodeAt(0) - 0xFEE0) : nm[1]
          push(String.fromCharCode(64 + Number(digit)), clean.slice(nm[0].length)); continue
        }
        // 行首圈号：①②③…
        const cm = clean.match(/^([①-⑧])\s*/)
        if (cm) { push(String.fromCharCode(64 + circ.indexOf(cm[1]) + 1), clean.slice(cm[0].length)); continue }
      }
      for (let i = 0; i < marks.length; i++) {
        const label = i + 1 < marks.length ? clean.slice(marks[i].start, marks[i + 1].start).trim() : clean.slice(marks[i].start).trim()
        push(normKey(marks[i].key), label)
      }
    }
    out.sort((a, b) => a.key.localeCompare(b.key))
    return out
  }
  
  // ---- 兜底建议 v2（R83）：从原文提取「引号候选清单」——模型没按契约输出选项，
  // 但常以列表形式给出候选项（创建角色时的世界线设定、路线举例等）。
  // 规则：①同行内 ≥2 个「…」项即认作一组 ②否则需 ≥2 个列表行各含引号；
  // 散落在叙述里的单个专名引用绝不触发，防止把对白/书名误判成选项。
  function extractQuoteChoices(text) {
    const lines = String(text || '').split('\n')
    let inlineRun = 0 // 至少一行内并列 ≥2 个引号项（截图案例即此形态）
    let listRows = 0  // 以列表符开头的引号行数
    const flat = []
    for (const raw of lines) {
      const line = raw.trim()
      const items = (line.match(/「([^「」\n]{4,60})」/g) || []).map((s) => s.slice(1, -1).trim()).filter(Boolean)
      if (!items.length) continue
      flat.push(...items)
      if (items.length >= 2) inlineRun++
      if (/^[-*•·]/.test(line)) listRows++
    }
    if (flat.length < 2) return []
    if (!(inlineRun > 0 || listRows >= 2)) return []
    const seen = new Set()
    const out = []
    for (const it of flat) {
      if (!seen.has(it)) { seen.add(it); out.push(it) }
      if (out.length >= 6) break
    }
    return out
  }
  
  window.ChoiceParser = { parseChoices, extractQuoteChoices }
})()
