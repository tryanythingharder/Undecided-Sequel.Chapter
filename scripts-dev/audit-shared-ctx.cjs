'use strict'
// 一次性审计脚本：对 shared/ 每个模块，剥掉字符串/注释后，
// 找『使用了但既未声明也非 JS 内建/关键词』的裸调用标识符（绞杀者迁移漏注入候选）。
const fs = require('fs'), path = require('path')
const files = fs.readdirSync(path.join(__dirname, '..', 'shared')).filter(f => f.endsWith('.js'))
const KW = new Set(['function', 'if', 'else', 'return', 'while', 'for', 'of', 'in', 'new', 'typeof', 'catch', 'switch', 'case', 'break', 'continue', 'do', 'var', 'let', 'const', 'delete', 'void', 'throw', 'instanceof', 'this', 'super', 'yield', 'await', 'async', 'get', 'set', 'static', 'from', 'as'])
const GLOBALS = new Set(['document', 'window', 'localStorage', 'Math', 'JSON', 'Date', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Promise', 'Object', 'Array', 'String', 'Number', 'Boolean', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'require', 'module', 'exports', 'Error', 'TypeError', 'RegExp', 'Map', 'Set', 'fetch', 'navigator', 'location', 'history', 'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'MutationObserver', 'URL', 'Blob', 'FileReader', 'Image', 'Audio', 'HTMLElement', 'structuredClone', 'crypto', 'performance', 'AbortController', 'getComputedStyle', 'alert', 'Reflect', 'Proxy', 'Symbol', 'Infinity', 'NaN', 'undefined', 'globalThis'])

function strip(src) {
  let out = '', i = 0, n = src.length, mode = 'code'
  while (i < n) {
    const c = src[i], next = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 2; continue }
      if (c === '/' && next === '*') { mode = 'block'; i += 2; continue }
      if (c === "'") { mode = 's1'; out += ' '; i++; continue }
      if (c === '"') { mode = 's2'; out += ' '; i++; continue }
      if (c === '`') { mode = 'tpl'; out += ' '; i++; continue }
      out += c; i++; continue
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c } i++; continue }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = 'code'; i += 2; continue } i++; continue }
    if (mode === 's1' || mode === 's2') { if (c === '\\') { i += 2; continue } if ((mode === 's1' && c === "'") || (mode === 's2' && c === '"')) mode = 'code'; i++; continue }
    if (mode === 'tpl') {
      if (c === '\\') { i += 2; continue }
      if (c === '`') { mode = 'code'; i++; continue }
      if (c === '$' && next === '{') { // 模板插值：粗略跳到配对 }（不含嵌套字符串精确处理，够审计用）
        let depth = 1; i += 2
        while (i < n && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++ }
        continue
      }
      i++; continue
    }
  }
  return out
}

for (const f of files) {
  const body = strip(fs.readFileSync(path.join(__dirname, '..', 'shared', f), 'utf8'))
  const declared = new Set()
  for (const m of body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
  for (const m of body.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const piece of m[1].split(',')) {
      const x = (piece.split(':')[1] || piece).trim().split('=')[0].trim()
      if (x) declared.add(x)
    }
  }
  for (const m of body.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)) declared.add(m[1])
  for (const m of body.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\)\s*=>/g)) { declared.add(m[1]); if (m[2]) declared.add(m[2]) }
  for (const m of body.matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
    for (const p of m[1].split(',')) { const x = p.trim().split('=')[0].trim(); if (x) declared.add(x) }
  }
  for (const m of body.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) declared.add(m[1])
  const missing = new Set()
  for (const m of body.matchAll(/(?<![.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)) {
    const u = m[1]
    if (declared.has(u) || KW.has(u) || GLOBALS.has(u) || u === 'ctx') continue
    missing.add(u)
  }
  if (missing.size) console.log(f.padEnd(22) + '→ ' + [...missing].join(', '))
}
console.log('--- 审计完成 ---')
