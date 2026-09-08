'use strict'
// 审计 v2：逐模块比对「注入形态」vs「使用形态」
//   注入侧：app.js（双方案）createXxx({ ... }) 里每个 ctx 属性的表达式形态
//     - getter：name: () => xxx
//     - setter：name: (v) => {...}
//     - ref：name（短引用，取 app.js 作用域绑定）
//   使用侧：shared 模块内该名字的使用形态
//     - called：name( 调用 → 期望函数
//     - value：name.xxx / ===name / [name] 等 → 期望值
// 报告两侧形态冲突的组合（workspace C1 同款）。
const fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..')

function strip(src) {
  let out = '', i = 0, n = src.length, mode = 'code'
  while (i < n) {
    const c = src[i], next = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'l'; i += 2; continue }
      if (c === '/' && next === '*') { mode = 'b'; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { mode = 's'; out += ' '; i++; continue }
      out += c; i++; continue
    }
    if (mode === 'l') { if (c === '\n') { mode = 'code'; out += c } i++; continue }
    if (mode === 'b') { if (c === '*' && next === '/') { mode = 'code'; i += 2; continue } i++; continue }
    if (mode === 's') { if (c === '\\') { i += 2; continue } if (c === "'" || c === '"' || c === '`') mode = 'code'; i++; continue }
  }
  return out
}

// 从注入块文本解析属性 → 形态
function parseInjection(block) {
  const shape = {}
  // 逐属性：粗分割逗号（不含嵌套 {} 的假设对本案够用；含嵌套的手工核对）
  for (const m of block.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*:\s*(?=([^,{}]|\{[^{}]*\})*$)/gm)) null // noop 占位
  const re = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*:\s*/g
  const names = []
  for (const m of block.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*:\s*/g)) names.push({ name: m[1], idx: m.index + m[0].length })
  // 短引用（无冒号）
  for (const m of block.matchAll(/(?:\{|,)\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g)) {
    if (!shape[m[1]]) shape[m[1]] = 'ref:' + m[1]
  }
  for (let i = 0; i < names.length; i++) {
    const start = names[i].idx
    const end = i + 1 < names.length ? block.lastIndexOf(',', names[i + 1].idx) : block.length
    const expr = block.slice(start, end).trim()
    let kind = 'value'
    if (/^\(\)\s*=>/.test(expr)) kind = 'getter'
    else if (/^\((\w|v|_)(\s*,\s*\w+)*\)\s*=>/.test(expr) || /^\w+\s*=>/.test(expr)) kind = 'setter'
    else if (/^function/.test(expr)) kind = 'fn'
    else if (/^[A-Za-z_$][\w$]*$/.test(expr)) kind = 'ref:' + expr
    shape[names[i].name] = kind
  }
  return shape
}

// 从模块源码取 ctx 名单与使用形态（重命名解构 workspaces: getWorkspaces → 属性名 workspaces，使用走别名）
function parseModuleUsage(src, fname) {
  const stripped = strip(src)
  const props = [] // { prop, alias }
  for (const m of stripped.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*ctx/g)) {
    for (const piece of m[1].split(',')) {
      const parts = piece.split(':')
      const prop = parts[0].trim().split('=')[0].trim()
      const local = (parts[1] || parts[0]).trim().split('=')[0].trim()
      if (prop && local) props.push({ prop, alias: local })
    }
  }
  for (const m of stripped.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*ctx\.([A-Za-z_$][\w$]*)/g)) props.push({ prop: m[2], alias: m[1] })
  const usage = {}
  for (const { prop, alias } of props) {
    const called = new RegExp('(?<![.\\w$])' + alias + '\\s*\\(').test(stripped)
    const dotted = new RegExp('(?<![.\\w$])' + alias + '\\.[A-Za-z_$]').test(stripped)
    const valueUse = new RegExp('(?<![.\\w$])' + alias + '(?!\\s*\\()(?![.\\w$])').test(stripped)
    usage[prop] = { called, dotted, valueUse, alias }
  }
  if (process.env.AUDIT_DEBUG && process.env.AUDIT_DEBUG === fname) {
    console.log('[debug]', fname, 'props:', JSON.stringify(props))
  }
  return { names: props.map(p => p.prop), usage }
}

const appClassic = strip(fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8'))
const appProto = strip(fs.readFileSync(path.join(root, 'renderer-proto', 'app.js'), 'utf8'))
const sharedDir = path.join(root, 'shared')
let findings = 0

for (const f of fs.readdirSync(sharedDir).filter(x => x.endsWith('.js'))) {
  const raw = fs.readFileSync(path.join(sharedDir, f), 'utf8')
  const stripped = strip(raw)
  const fm = stripped.match(/create[A-Za-z_$][\w$]*\s*\(\s*ctx\s*\)/)
  if (!fm) continue
  const factory = fm[0].replace(/\s+/g, ' ')
  const { names, usage } = parseModuleUsage(raw, f)
  if (!names.length) continue
  // 找两侧注入块
  const blocks = []
  for (const [side, app] of [['classic', appClassic], ['proto', appProto]]) {
    const im = app.match(new RegExp('create[A-Za-z_$][\\w$]*\\(\\{(?=[^)]*' + factory.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')'))
    // 简化：按工厂名找 create 调用
    const factoryName = factory.match(/create[A-Za-z_$][\w$]*/)[0]
    const cm = app.match(new RegExp(factoryName + '\\s*\\(\\{'))
    if (!cm) continue
    // 取配对大括号
    let i = cm.index + cm[0].length - 1, depth = 0, j = i
    for (; j < app.length; j++) {
      if (app[j] === '{') depth++
      else if (app[j] === '}') { depth--; if (!depth) break }
    }
    blocks.push([side, app.slice(i, j + 1)])
  }
  for (const [side, block] of blocks) {
    const shape = parseInjection(block)
    for (const name of names) {
      const s = shape[name]
      if (!s) { console.log('[缺注入] ' + f + ' @' + side + ': ' + name + '（模块解构了但 ctx 未传——除非有默认值/可选）'); findings++; continue }
      const u = usage[name]
      if (s === 'getter' && u.called) continue          // getter 被调用 ✓
      if (s === 'getter' && !u.called && u.dotted) { console.log('[形态冲突] ' + f + ' @' + side + ': ' + name + ' 注入为 getter 但模块按值/取属性使用'); findings++ }
      if ((s.startsWith('ref:') || s === 'value' || s === 'fn') && u.called) {
        // 注入为引用/值但模块当函数调用——若是 app.js 里的函数声明则合法；ref 指向函数也合法。仅 ref 指向非函数时是 bug，静态无法判定，标记人工核对
        if (s === 'value') { console.log('[核对] ' + f + ' @' + side + ': ' + name + ' 注入为字面值但模块当函数调用'); findings++ }
      }
    }
  }
}
console.log('--- 审计 v2 完成，发现 ' + findings + ' 项 ---')
