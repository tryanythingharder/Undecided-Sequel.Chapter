'use strict'
/* 六面世界 · 进度包导入规划器（engine/progress-import.cjs）
 *
 * 纯函数：不读盘、不写盘、不改动传入对象（内部深拷贝 / 自行 JSON.parse）。
 * 职责边界：
 *   · validateBundle    —— 包结构与引擎文件防线：type/v、会话与工作区字段、路径白名单、
 *                          规范化去重、字节限额、JSON 正确性、story 结构 schema 兼容。
 *   · planProgress      —— 冲突决策（keep/replace/branch）+ 工作区隔离 + 引擎文件重写清单
 *                          + 合并后的 sessions/workspaces + 预览行 + 需清理的旧世界线 id。
 *   · planProgressBundle—— 两者串联（校验一次，规划一次）。
 * 实际落盘（原子写、回滚、广播、归档）仍由 main.cjs 负责——本模块只产出相对路径与内容。
 *
 * 关键安全语义（与需求逐条对应）：
 *   1. 会话冲突默认 keep（最安全：本机世界线与记忆一字不动）；无 choices 的旧式直连导入
 *      由调用方传 conflictDefault:'newer' 才会按 updatedAt 取新。
 *   2. 工作区 id 同名但内核绑定不同 → 为导入世界线建立独立工作区，绝不改动本机工作区对象；
 *      本机工作区带 kernelPath（本机自定义内核文件）时同样视为不可比较 → 独立工作区。
 *   3. branch 重写 story_id、文件路径与关联 id（含 snapshot/pending 内部），正文文本不动。
 *   4. 包内未声明 owner 的引擎文件一律跳过并报告——绝不覆盖任何现有世界线（含孤儿遗留文件）。
 *   5. 采纳导入但包内没有记忆正本时，输出 replacedIds 让调用方先清掉本机旧状态：
 *      不继承"本机未来的记忆"（旧快照/待补录/日志一并清）。
 *   6. keep 语义下不新增、不改动本机 workspaces（缺内核也一样）。
 *
 * 主进程调用契约（main.cjs progress:import）：
 *   const validated = validateBundle(bundle, { limits, preview: !!options.preview })
 *   const plan = planProgress({ validated, preview: !!options.preview,   // ← 建议透传；不透传时继承 validated.preview
 *     currentSessions, currentWorkspaces, current,
 *     choices: options.choices,
 *     conflictDefault: options.choices ? 'keep' : 'newer',   // 旧式直连导入（无 choices）保留历史"取新"语义
 *     localEngineOwners: scanLocalEngineOwners(engineDir), hasKernel })
 *   落盘 = 先按 plan.resetIds 清整条旧状态 → 再写 plan.writes → 写 sessions → 写 workspaces/current。
 */

// ---- 运行时最小依赖：桌面 Node 下用 node:crypto / Buffer；移动端 V8 沙箱（engine/** 会被拷进
//      assets，仅提供 fs/path/crypto 三个垫片）里没有 Buffer——用等价实现兜底，
//      保证本模块即便被静态打包/加载也不会在加载期抛错。
const nodeCrypto = require('node:crypto')

const copy = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)))
const freshId = (prefix) => prefix + '-' + (nodeCrypto && nodeCrypto.randomBytes
  ? nodeCrypto.randomBytes(12).toString('hex')
  : Math.random().toString(16).slice(2).padEnd(24, '0').slice(0, 24))
/* UTF-8 字节数：Buffer 可用时走原生，否则按码点手算（与 Buffer.byteLength 结果一致）。 */
const bytesOf = typeof Buffer !== 'undefined' && Buffer.byteLength
  ? (text) => Buffer.byteLength(String(text), 'utf8')
  : (text) => {
    const str = String(text)
    let bytes = 0
    for (let i = 0; i < str.length; i++) {
      const code = str.codePointAt(i)
      if (code > 0xffff) i++
      bytes += code < 0x80 ? 1 : (code < 0x800 ? 2 : (code < 0x10000 ? 3 : 4))
    }
    return bytes
  }
const LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxFiles: 5000,
  maxMessageBytes: 2 * 1024 * 1024,
  maxSessionsBytes: 64 * 1024 * 1024,
  maxMessagesPerSession: 5000,
  maxSessions: 200,
  maxPathLength: 512,
  maxTitleLength: 300,
  maxNameLength: 120
}

// 写入的 story 必须与 engine/schema.js 同版本：桌面端从 schema 取（单一真源），
// 取不到时退回 1（移动端 V8 沙箱内本模块也可能被加载；schema.js:102 升级时需同步此兜底值）。
let ENGINE_VERSION = 1
try { ENGINE_VERSION = require('./schema').ENGINE_VERSION } catch { /* 沙箱兜底：见上 */ }

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/
const SAFE_SEG_RE = /^[A-Za-z0-9_.-]{1,180}$/
const ALLOWED_ROOTS = new Set(['stories', 'snapshots', 'pendings', 'logs'])
const META_SUFFIX = '.meta.json'
// 旧版导出会把派生索引一并打进包（按 utf8 读已损坏、可由正本重建）：跳过，不阻断导入
const LEGACY_DERIVED_RE = /^memory\.db(-wal|-shm)?$/
// 写入的 story 必须兼容 engine/schema.js 的骨架（createStory 产出的键）
const STORY_LISTS = ['decisions', 'commitments', 'knowledge', 'facts', 'events', 'causal', 'relationships', 'threads', 'entities', 'sessions']
const CHOICES = ['keep', 'replace', 'branch']

// ---- 路径白名单：只允许 stories/<id>.json、stories/<id>.meta.json、
//      snapshots/<owner>/<file>.json、logs/<owner>/<file>.json、pendings/<owner>.<pendingId>.json ----
function validateRelativePath(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > LIMITS.maxPathLength || rel.includes('\u0000')) throw new Error('进度包路径为空或过长')
  const norm = rel.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) throw new Error('不允许绝对路径')
  const parts = norm.split('/')
  if (parts.length < 2 || parts.length > 3) throw new Error('引擎文件目录层级不正确')
  if (parts.some((p) => !p || p === '.' || p === '..' || !SAFE_SEG_RE.test(p))) throw new Error('引擎文件路径包含非法片段')
  const root = parts[0]
  if (!ALLOWED_ROOTS.has(root)) throw new Error('不支持的引擎文件目录')
  const name = parts[parts.length - 1]
  if (!name.endsWith('.json')) throw new Error('不支持的引擎文件类型')
  let owner = '', kind = '', pendingId = ''
  if (root === 'stories') {
    if (parts.length !== 2) throw new Error('引擎文件目录层级不正确')
    if (name.endsWith(META_SUFFIX)) { owner = name.slice(0, -META_SUFFIX.length); kind = 'meta' }
    else { owner = name.slice(0, -5); kind = 'story' }
  } else if (root === 'pendings') {
    if (parts.length !== 2) throw new Error('引擎文件目录层级不正确')
    const stem = name.slice(0, -5)
    const dot = stem.indexOf('.')
    if (dot <= 0) throw new Error('待补录文件名不正确')
    owner = stem.slice(0, dot); pendingId = stem.slice(dot + 1); kind = 'pending'
    if (!SAFE_SEG_RE.test(pendingId) || pendingId === '.' || pendingId === '..') throw new Error('待补录文件名不正确')
  } else {
    if (parts.length !== 3) throw new Error('引擎文件目录层级不正确')
    owner = parts[1]; kind = root === 'snapshots' ? 'snapshot' : 'log'
  }
  if (!ID_RE.test(owner)) throw new Error('引擎文件所属世界线非法')
  return { rel: norm, root, owner, kind, name, parts, pendingId }
}

function fileOwner(rel) { return validateRelativePath(rel).owner }

// ---- 递归归属校验 / 重写：任何 story_id 字段必须指向本文件所属世界线（跨线记忆直接拒绝）----
function scanOwnership(value, owner) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { for (const item of value) scanOwnership(item, owner); return }
  for (const key of Object.keys(value)) {
    if (key === 'story_id') { if (value[key] !== owner) throw new Error('进度包含跨世界线记忆（' + String(value[key]) + ' ≠ ' + owner + '）') }
    else scanOwnership(value[key], owner)
  }
}
/* 只改归属 id 与关联 session_id，绝不触碰 narrative/正文文本（本函数只识别这两个键名）。 */
function rewriteOwnership(value, owner, target, mapSessionId) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { for (const item of value) rewriteOwnership(item, owner, target, mapSessionId); return }
  for (const key of Object.keys(value)) {
    if (key === 'story_id') {
      if (value[key] !== owner) throw new Error('进度包含跨世界线记忆（' + String(value[key]) + ' ≠ ' + owner + '）')
      value[key] = target
    } else if (key === 'session_id' && typeof value[key] === 'string' && value[key] && mapSessionId) {
      value[key] = mapSessionId(value[key])
    } else rewriteOwnership(value[key], owner, target, mapSessionId)
  }
}

// ---- story 结构 schema 兼容（engine/schema.js createStory 骨架）----
function storyShapeProblem(story) {
  if (!story || typeof story !== 'object' || Array.isArray(story)) return '不是对象'
  if (story.schema_version !== ENGINE_VERSION) return 'schema_version=' + story.schema_version
  if (!story.counters || typeof story.counters !== 'object' || !Number.isSafeInteger(story.counters.turn) || story.counters.turn < 0) return 'counters.turn'
  if (!story.kernel || typeof story.kernel !== 'object' || typeof story.kernel.id !== 'string') return 'kernel'
  // 内嵌内核（开局时锁定的内核正文）：可以缺席，但若存在必须是文本——它是导入线不回退全局内核的依据
  if (story.kernel.text != null && typeof story.kernel.text !== 'string') return 'kernel.text'
  if (!story.player || typeof story.player !== 'object') return 'player'
  if (!story.scene || typeof story.scene !== 'object') return 'scene'
  for (const key of STORY_LISTS) if (!Array.isArray(story[key])) return key + ' 不是数组'
  return null
}

/* 单文件校验。归属类问题（文件名/内容 id 不一致、跨世界线记忆）一律硬拒绝——
 * 那是包损坏或伪造的信号；结构类问题（story 骨架不兼容 schema）返回原因字符串，
 * 由调用方按 strict 策略处理：默认跳过该文件并报告（不写盘、不当记忆），strict 下拒绝整包。 */
function inspectEntry(info, parsed) {
  const own = (why) => { throw new Error('引擎文件与世界线归属不一致（' + why + '）：' + info.rel) }
  if (info.kind === 'story') {
    if (parsed.story_id !== info.owner) own('story_id=' + String(parsed.story_id))
    scanOwnership(parsed, info.owner)
    const problem = storyShapeProblem(parsed)
    return problem ? '记忆结构不正确：' + problem : null
  }
  if (info.kind === 'meta') {
    if (parsed.story_id !== info.owner) own('story_id=' + String(parsed.story_id))
    scanOwnership(parsed, info.owner)
    return null
  }
  if (info.kind === 'snapshot') {
    if (parsed.story_id !== info.owner) own('story_id=' + String(parsed.story_id))
    if (parsed.snapshot_id + '.json' !== info.name) throw new Error('快照编号与文件名不一致：' + info.rel)
    scanOwnership(parsed, info.owner)
    const problem = storyShapeProblem(parsed.state)
    return problem ? '快照状态结构不正确：' + problem : null
  }
  if (info.kind === 'pending') {
    if (parsed.story_id !== info.owner) own('story_id=' + String(parsed.story_id))
    if (info.owner + '.' + parsed.pending_id + '.json' !== info.name) throw new Error('待补录编号与文件名不一致：' + info.rel)
    if (parsed.session_id != null && typeof parsed.session_id !== 'string') throw new Error('待补录记录格式不正确：' + info.rel)
    scanOwnership(parsed, info.owner)
    return null
  }
  // logs：诊断日志，只校验顶层归属（内部 parsed_state_patch 是模型原文，不参与归属判定）
  if (parsed.story_id != null && parsed.story_id !== info.owner) own('story_id=' + String(parsed.story_id))
  return null
}

/* 引擎文件清单 → 规范化条目（路径白名单 + 重复规范化 + 大小 + JSON + 归属/结构校验）。
 * limits 为 null 时只做归属与结构校验（调用方已自行完成限额防线）。 */
function buildEntries(files, warnings, limits, strict) {
  const entries = [], skipped = [], seen = new Set()
  if (files == null) return { entries, skipped }
  if (typeof files !== 'object' || Array.isArray(files)) throw new Error('进度包引擎数据不正确')
  let total = 0
  for (const key of Object.keys(files)) {
    const content = files[key]
    if (typeof content !== 'string') throw new Error('进度包中的引擎文件内容必须是文本')
    if (LEGACY_DERIVED_RE.test(key.split('/').pop() || '')) { warnings.push('已跳过旧包派生文件：' + key); continue }
    const bytes = bytesOf(content)
    if (limits && bytes > limits.maxFileBytes) throw new Error('进度包中的引擎文件过大：' + key)
    const info = validateRelativePath(key)
    const lower = info.rel.toLowerCase()
    if (seen.has(lower)) throw new Error('进度包引擎文件路径重复：' + info.rel)
    seen.add(lower)
    total += bytes
    if (limits && total > limits.maxTotalBytes) throw new Error('进度包中的引擎数据总量过大')
    let parsed
    try { parsed = JSON.parse(content) } catch { throw new Error('引擎文件不是合法 JSON：' + info.rel) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('引擎文件结构不正确：' + info.rel)
    const problem = inspectEntry(info, parsed)
    if (problem) {
      if (strict) throw new Error('进度包记忆结构不正确：' + info.rel + '（' + problem + '）')
      skipped.push({ relative: info.rel, owner: info.owner, reason: problem })
      warnings.push('已跳过结构不兼容的引擎文件（不会写入，也不会当作记忆）：' + info.rel + '（' + problem + '）')
      continue
    }
    entries.push({ relative: info.rel, owner: info.owner, kind: info.kind, name: info.name, text: content, parsed, bytes })
  }
  if (limits && entries.length > limits.maxFiles) throw new Error('进度包中的引擎文件数量过多')
  return { entries, skipped }
}

function parseWorkspaces(input) {
  if (input == null) return []
  if (!Array.isArray(input)) throw new Error('进度包工作区数据不正确')
  const out = [], seen = new Set()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('进度包工作区数据不正确')
    const id = typeof raw.id === 'string' ? raw.id : ''
    if (!ID_RE.test(id)) throw new Error('进度包工作区 id 非法')
    if (seen.has(id)) throw new Error('进度包工作区数据重复：' + id)
    seen.add(id)
    const name = String(raw.name == null ? '' : raw.name).trim()
    if (!name) throw new Error('进度包工作区缺少名称')
    const ws = { id, name: name.slice(0, LIMITS.maxNameLength), createdAt: Number(raw.createdAt) || 0 }
    if (typeof raw.kernelId === 'string' && raw.kernelId.trim()) ws.kernelId = raw.kernelId.trim().slice(0, 200)
    if (typeof raw.lastSessionId === 'string' && ID_RE.test(raw.lastSessionId)) ws.lastSessionId = raw.lastSessionId
    // kernelPath 是本机绝对路径：绝不随包导入（导入它只会指向别的机器上的文件）
    out.push(ws)
  }
  return out
}

function parseSessions(input, options) {
  const opts = options || {}
  const limits = opts.limits || LIMITS
  const warnings = opts.warnings || []
  if (input == null) return []
  if (!Array.isArray(input)) throw new Error('进度包世界线数据不正确')
  if (input.length > limits.maxSessions && !opts.preview) throw new Error('进度包世界线数量超过上限（' + limits.maxSessions + '）')
  const out = [], seen = new Set()
  let total = 0
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('进度包会话数据不完整')
    const s = copy(raw)
    const id = typeof s.id === 'string' ? s.id : ''
    if (!ID_RE.test(id) || seen.has(id)) throw new Error('进度包世界线 id 非法或重复')
    seen.add(id)
    if (!Array.isArray(s.messages)) throw new Error('进度包会话数据不完整')
    if (s.messages.length > limits.maxMessagesPerSession) throw new Error('单条世界线消息过多')
    for (const m of s.messages) {
      if (!m || typeof m !== 'object' || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw new Error('进度包消息格式不正确')
      if (bytesOf(m.content) > limits.maxMessageBytes) throw new Error('进度包单条消息过大')
      // 导出侧本就剥离插图；导入透传会把任意 data URL 塞进渲染层 img.src
      delete m.illust
      delete m.illustAsset
    }
    s.id = id
    s.title = typeof s.title === 'string' ? s.title.slice(0, limits.maxTitleLength) : ''
    s.ws = typeof s.ws === 'string' ? s.ws : ''
    s.createdAt = Number(s.createdAt) || Number(s.updatedAt) || 0
    s.updatedAt = Number(s.updatedAt) || s.createdAt
    total += bytesOf(JSON.stringify(s))
    if (total > limits.maxSessionsBytes) throw new Error('进度包世界线数据总量过大')
    out.push(s)
  }
  return out
}

/* 包级校验：形状 / 限额 / 路径 / JSON / 归属 / schema。预览态（preview）只对"世界线数量超限"放行，
 * 让用户先看到预览行并选择保留本机（其余防线不放宽）；结构不兼容的引擎文件默认跳过并报告
 * （strict:true 时整包拒绝——给父进程按需选择严格口径）。 */
function validateBundle(bundle, options) {
  const opts = options || {}
  const limits = Object.assign({}, LIMITS, opts.limits || {})
  const warnings = []
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('不是有效的进度包')
  if (bundle.type !== 'sixworlds-progress') throw new Error('不是有效的进度包（type 不符）')
  if (bundle.v !== 1) throw new Error('进度包版本不支持（v=' + bundle.v + '，需要 v1）')
  const workspaces = parseWorkspaces(bundle.workspaces)
  const sessions = parseSessions(bundle.sessions, { limits, preview: !!opts.preview, warnings })
  const files = (bundle.engine && bundle.engine.files) || {}
  const built = buildEntries(files, warnings, limits, !!opts.strict)
  return {
    type: 'sixworlds-progress', v: 1, exportedAt: Number(bundle.exportedAt) || 0, world: bundle.world || null,
    preview: !!opts.preview, workspaces, sessions, files, entries: built.entries, skippedFiles: built.skipped, warnings
  }
}

/* 归属重写后的相对路径：stories/<owner><后缀>、pendings/<owner>.<pendingId>.json、
 * snapshots|logs/<owner>/<file>.json —— 只换归属段，文件名的其余部分原样保留。 */
function remapRelative(entry, target) {
  const parts = entry.relative.split('/')
  if (entry.kind === 'story' || entry.kind === 'meta') parts[1] = target + entry.name.slice(entry.owner.length)
  else if (entry.kind === 'pending') parts[1] = target + entry.name.slice(entry.owner.length)
  else parts[1] = target
  return parts.join('/')
}

/* 规划器。输入（扁平或嵌套 options 均可）：
 *   bundle | sessions/workspaces/files   —— 进度包（优先 bundle；扁平形式供已自行校验的调用方）
 *   currentSessions / currentWorkspaces  —— 本机现状
 *   choices                              —— { 世界线 id: keep|replace|branch }
 *   options: preview / strict / conflictDefault('keep'|'newer') / legacy(旧式直连导入=true 时
 *            等价 conflictDefault:'newer') / hasKernel(id) / maxSessions /
 *            localEngineOwners(本机已有引擎文件的世界线 id) / sessionIdMap(chat session id → 新 id，
 *            支持对象映射或函数) / newId(prefix)（测试注入确定性 id）/ now / limits /
 *            validated（validateBundle 的产物，避免重复校验）
 * 输出：sessions / workspaces / writes(=engineWrites: [{relative, content, owner, kind, source}]) /
 *       replacedIds / resetIds / rows(预览行) / warnings / skipped([{relative, owner, reason}]) /
 *       overLimit / stats
 */
function planProgress(input) {
  if (!input || typeof input !== 'object') throw new Error('导入规划参数不正确')
  const o = Object.assign({}, input.options || {}, input)
  const warnings = []
  const limits = Object.assign({}, LIMITS, o.limits || {})
  // 预览态：显式传入优先；调用方忘了透传时继承 validateBundle 的 preview（否则超限预览会误抛）
  const preview = o.preview == null ? !!(o.validated && o.validated.preview) : !!o.preview
  // 默认 keep（安全）。legacy:true 是 conflictDefault:'newer' 的别名——仅供无 choices 的旧式直连导入，
  // 让父进程显式选择"按 updatedAt 取新"；不给任何开关时一律 keep。
  const conflictDefault = (o.conflictDefault === 'newer' || (o.legacy === true && o.conflictDefault == null)) ? 'newer' : 'keep'
  const choices = (o.choices && typeof o.choices === 'object' && !Array.isArray(o.choices)) ? o.choices : {}
  const hasKernel = typeof o.hasKernel === 'function' ? o.hasKernel : () => false
  const makeId = typeof o.newId === 'function' ? o.newId : freshId
  const now = Number.isFinite(o.now) ? o.now : Date.now()
  const sessionIdMap = typeof o.sessionIdMap === 'function' ? o.sessionIdMap
    : (o.sessionIdMap && typeof o.sessionIdMap === 'object' ? (id) => (typeof o.sessionIdMap[id] === 'string' && o.sessionIdMap[id] ? o.sessionIdMap[id] : id) : (id) => id)
  const maxSessions = Number.isSafeInteger(o.maxSessions) && o.maxSessions > 0 ? o.maxSessions : limits.maxSessions

  let validated = null
  if (o.validated && Array.isArray(o.validated.sessions)) validated = o.validated
  else if (o.bundle) validated = validateBundle(o.bundle, { limits, preview, strict: !!o.strict })
  if (validated) for (const w of validated.warnings) warnings.push(w)

  const incoming = validated ? copy(validated.sessions) : parseSessions(o.sessions, { limits, preview, warnings })
  const incomingSpaces = validated ? copy(validated.workspaces) : parseWorkspaces(o.workspaces)
  const built = validated ? { entries: validated.entries || [], skipped: validated.skippedFiles || [] } : buildEntries(o.files, warnings, null, !!o.strict)
  const entries = built.entries
  const local = copy(Array.isArray(o.currentSessions) ? o.currentSessions : [])
  const spaces = copy(Array.isArray(o.currentWorkspaces) ? o.currentWorkspaces : [])

  // ---- 1. 冲突决策：默认 keep（安全）；无 choices 的旧式直连导入由调用方传 'newer' ----
  const localById = new Map(local.filter((s) => s && typeof s.id === 'string').map((s) => [s.id, s]))
  const usedSessionIds = new Set(localById.keys())
  const decisions = new Map(), sessionMap = new Map()
  for (const s of incoming) {
    const old = localById.get(s.id)
    const choice = choices[s.id]
    if (choice != null && !CHOICES.includes(choice)) throw new Error('导入处理方式不正确')
    /* 用户显式选择优先于默认推断（预览面板只对冲突行给选项，但显式 keep 也用于"这条线不导入"）：
     * 无选择时——本机没有该线 → add；有冲突 → keep（安全默认）/ conflictDefault:'newer' 时按 updatedAt。 */
    const decision = choice != null ? choice
      : (!old ? 'add' : (conflictDefault === 'newer' && Number(s.updatedAt || 0) > Number(old.updatedAt || 0) ? 'replace' : 'keep'))
    decisions.set(s.id, decision)
    let target = s.id
    if (decision === 'branch') { do { target = makeId('s') } while (usedSessionIds.has(target)) }
    usedSessionIds.add(target)
    sessionMap.set(s.id, target)
  }
  const accepted = new Set(incoming.filter((s) => decisions.get(s.id) !== 'keep').map((s) => s.id))
  // 归属缺失的旧包：只有一个工作区时自动归入；否则不猜——应用阶段硬拒绝，预览阶段只标记（让用户先看行）
  const fallbackWs = incomingSpaces.length === 1 ? incomingSpaces[0].id : ''
  for (const s of incoming) if (!s.ws && fallbackWs && accepted.has(s.id)) { s.ws = fallbackWs; warnings.push('世界线「' + (s.title || s.id) + '」缺少工作区归属，已并入唯一工作区') }
  const needsWorkspace = new Set(incoming.filter((s) => accepted.has(s.id) && !s.ws).map((s) => s.id))
  if (needsWorkspace.size && !preview) throw new Error('进度包世界线缺少工作区归属：' + [...needsWorkspace].join('、'))

  // ---- 2. 工作区：同名同内核并入本机；内核不同 → 导入线独立工作区（本机工作区一字不改）----
  const spaceMap = new Map()
  const usedSpaceIds = new Set(spaces.filter((w) => w && typeof w.id === 'string').map((w) => w.id))
  const incomingSpaceIds = new Set(incomingSpaces.map((w) => w.id))
  for (const ws of incomingSpaces) {
    if (!incoming.some((s) => accepted.has(s.id) && s.ws === ws.id)) continue // 全部保留本机 → 不碰本机工作区
    const old = spaces.find((w) => w && w.id === ws.id)
    // 本机带 kernelPath（本机自定义内核）无法比较 → 视为差异；两边都声明内核且不同 → 差异
    const kernelDiff = !!(old && (old.kernelPath || (old.kernelId && ws.kernelId && old.kernelId !== ws.kernelId)))
    if (old && !kernelDiff) {
      if (String(old.name || '') !== ws.name) warnings.push('工作区「' + ws.name + '」与本机同名工作区名称不同，已并入本机工作区')
      spaceMap.set(ws.id, ws.id)
      continue
    }
    let id = ws.id
    if (old && kernelDiff) {
      do { id = makeId('ws') } while (usedSpaceIds.has(id))
      warnings.push('工作区「' + ws.name + '」的内核与本机同名工作区不同，已为导入世界线建立独立工作区（本机工作区不变）')
    } else if (usedSpaceIds.has(id)) {
      do { id = makeId('ws') } while (usedSpaceIds.has(id))
    }
    usedSpaceIds.add(id)
    spaceMap.set(ws.id, id)
    const entry = { id, name: (old && kernelDiff ? '导入 · ' : '') + ws.name, createdAt: Number(ws.createdAt) || now }
    if (ws.kernelId) {
      if (hasKernel(ws.kernelId)) entry.kernelId = ws.kernelId
      else warnings.push('缺少内核 ' + ws.kernelId + '：导入世界线将以当前全局内核继续（世界线自身仍用开局时绑定的内核）')
    }
    const last = ws.lastSessionId ? sessionMap.get(ws.lastSessionId) : null
    if (last && accepted.has(ws.lastSessionId)) entry.lastSessionId = last
    spaces.push(entry)
  }
  // 包内未声明的世界线工作区：并入本机同名工作区，否则按原编号建立（保留移动端分组）
  for (const s of incoming) {
    if (!accepted.has(s.id) || spaceMap.has(s.ws)) continue
    if (needsWorkspace.has(s.id)) continue // 归属缺失：预览只标记，应用阶段已在上方硬拒绝
    if (!s.ws || !ID_RE.test(s.ws)) throw new Error('进度包世界线工作区归属非法：' + (s.title || s.id))
    const old = spaces.find((w) => w && w.id === s.ws)
    if (old) { spaceMap.set(s.ws, s.ws); warnings.push('进度包未声明工作区 ' + s.ws + '，已并入本机同名工作区'); continue }
    if (!incomingSpaceIds.has(s.ws)) {
      usedSpaceIds.add(s.ws)
      spaceMap.set(s.ws, s.ws)
      spaces.push({ id: s.ws, name: '导入的世界', createdAt: now })
      warnings.push('进度包未声明工作区 ' + s.ws + '，已按原编号建立')
    }
  }

  // ---- 3. 引擎文件：未声明 owner 一律跳过；branch 重写归属 id 与路径 ----
  const storyByOwner = new Map()
  for (const e of entries) if (e.kind === 'story') storyByOwner.set(e.owner, e)
  const writes = [], skipped = [], writeIndex = new Set()
  const brokenOwners = new Set()
  for (const bad of built.skipped) { skipped.push({ relative: bad.relative, owner: bad.owner, reason: 'structure' }); if (bad.relative.split('/')[0] === 'stories' && !bad.relative.endsWith(META_SUFFIX)) brokenOwners.add(bad.owner) }
  const localEngineOwners = new Set([...localById.keys(), ...(Array.isArray(o.localEngineOwners) ? o.localEngineOwners.filter((x) => typeof x === 'string') : [])])
  // 兼容旧调用面的 hasLocalMemory(id) 谓词（本机是否已有该线的引擎状态）
  if (typeof o.hasLocalMemory === 'function') for (const e of entries) if (o.hasLocalMemory(e.owner)) localEngineOwners.add(e.owner)
  for (const e of entries) {
    const decision = decisions.get(e.owner)
    if (!decision) {
      /* 未声明世界线（包内没有对应会话）：
       *  · 本机已有该线（会话或引擎文件）→ 绝不写入，只跳过并报告（不覆盖任何现有世界线）；
       *  · 本机没有该线 → 同样默认跳过（不凭空造出无会话的孤儿记忆）；
       *    调用方显式 adoptUndeclared:true 时才作为独立世界线写入并报告。 */
      const overwrite = localEngineOwners.has(e.owner)
      if (!(o.adoptUndeclared === true && !overwrite)) {
        skipped.push({ relative: e.relative, owner: e.owner, reason: overwrite ? 'undeclared-overwrite' : 'undeclared' })
        warnings.push((overwrite ? '已跳过未声明的世界线记忆文件（本机已有该世界线，绝不覆盖）：' : '已忽略未声明的世界线记忆文件（不写入，也不当作记忆）：') + e.relative)
        continue
      }
      warnings.push('已按独立世界线写入未声明的记忆文件（无对应会话）：' + e.relative)
      writes.push({ relative: e.relative, content: e.text, owner: e.owner, kind: e.kind, source: e.relative })
      writeIndex.add(e.relative.toLowerCase())
      continue
    }
    // 正本结构不兼容被跳过 → 其快照/待补录/日志同样不写（附属文件不能脱离正本存在）
    if (brokenOwners.has(e.owner)) { skipped.push({ relative: e.relative, owner: e.owner, reason: 'story-incompatible' }); warnings.push('已跳过结构不兼容世界线的附属文件：' + e.relative); continue }
    if (decision === 'keep') continue // 保留本机：本机同名世界线的记忆一字不动
    const target = sessionMap.get(e.owner)
    if (!target) continue
    let relative = e.relative, content = e.text
    if (target !== e.owner) {
      const parsed = JSON.parse(e.text) // 自有副本：只改归属 id，正文文本原样
      rewriteOwnership(parsed, e.owner, target, sessionIdMap)
      relative = remapRelative(e, target)
      content = JSON.stringify(parsed)
    }
    writes.push({ relative, content, owner: target, kind: e.kind, source: e.relative })
    writeIndex.add(relative.toLowerCase())
  }
  const writtenStoryOwners = new Set(writes.filter((w) => w.kind === 'story').map((w) => w.owner))
  for (const w of writes) if (w.kind !== 'story' && !writtenStoryOwners.has(w.owner)) throw new Error('引擎附属文件缺少世界记忆正本：' + w.relative)

  // ---- 4. 合并会话 + 预览行 + 待清理旧状态 ----
  const replacedIds = [], resetIds = [], rows = []
  for (const s of incoming) {
    const source = s.id, decision = decisions.get(source), old = localById.get(source)
    const ws = incomingSpaces.find((w) => w.id === s.ws)
    const storyEntry = storyByOwner.get(source)
    const pinned = !!(storyEntry && storyEntry.parsed && storyEntry.parsed.kernel && typeof storyEntry.parsed.kernel.text === 'string' && storyEntry.parsed.kernel.text.trim())
    const kernelId = (ws && ws.kernelId) || (storyEntry && storyEntry.parsed && storyEntry.parsed.kernel && typeof storyEntry.parsed.kernel.id === 'string' ? storyEntry.parsed.kernel.id : '')
    const targetWs = spaceMap.get(s.ws) || s.ws
    rows.push({
      id: source, title: s.title, conflict: !!old, decision,
      targetId: decision === 'keep' ? null : sessionMap.get(source), targetWs,
      messages: s.messages.length, localMessages: old && Array.isArray(old.messages) ? old.messages.length : 0,
      incomingAt: Number(s.updatedAt) || 0, localAt: old ? Number(old.updatedAt) || 0 : undefined,
      kernelId: kernelId || '', missingKernel: !pinned && !!kernelId && !hasKernel(kernelId),
      missingMemory: !storyEntry, workspaceConflict: targetWs !== s.ws, missingWorkspace: needsWorkspace.has(source)
    })
    if (decision === 'keep') continue
    if (needsWorkspace.has(source)) continue // 归属未定：只出现在预览行，应用阶段已硬拒绝
    const targetId = sessionMap.get(source)
    /* 就地写入（replace/add）：本机若已有同名世界线状态（会话或孤儿引擎文件），必须整线清掉——
     * 否则包内没有记忆正本时会静默继承本机"未来的记忆"（旧快照/待补录/日志）。
     * branch 不清理：它写的是全新 id，本机原线必须一字不动。 */
    if (targetId === source && localEngineOwners.has(source)) { replacedIds.push(source); resetIds.push(source) }
    s.id = targetId
    s.ws = targetWs
    if (decision === 'branch') { s.ifFrom = source; s.title = '导入分支 · ' + (s.title || '未命名') }
    else if (typeof s.ifFrom === 'string' && sessionMap.has(s.ifFrom) && decisions.get(s.ifFrom) !== 'keep') s.ifFrom = sessionMap.get(s.ifFrom)
    if (!storyEntry) warnings.push('「' + (s.title || s.id) + '」仅含聊天，将从空记忆继续')
    for (const m of s.messages) {
      // 被清掉的旧快照/待补录不可再被引用（否则渲染层回溯会指向不存在的记忆）
      for (const key of ['engineSnapshot', 'engineSnapshotId', 'engineBeforeSnapshotId']) {
        if (typeof m[key] === 'string' && !writeIndex.has(('snapshots/' + s.id + '/' + m[key] + '.json').toLowerCase())) delete m[key]
      }
      if (typeof m.pending === 'string' && !writeIndex.has(('pendings/' + s.id + '.' + m.pending + '.json').toLowerCase())) delete m.pending
      if (typeof m.enginePendingId === 'string' && !writeIndex.has(('pendings/' + s.id + '.' + m.enginePendingId + '.json').toLowerCase())) delete m.enginePendingId
      // 进行中标记是本机运行态，导入后必然失效（否则界面挂出永远转不完的补录/配图）
      delete m.committing
      delete m.illustPending
      if (!storyEntry) { delete m.engineTurn; if (m.pending === true) delete m.pending }
    }
    const index = local.findIndex((x) => x && x.id === s.id)
    if (index >= 0) local[index] = s; else local.push(s)
  }

  const sessions = local.slice().sort((a, b) => Number((b && b.updatedAt) || 0) - Number((a && a.updatedAt) || 0))
  let overLimit = null
  if (sessions.length > maxSessions) {
    overLimit = { count: sessions.length, limit: maxSessions, overflow: sessions.length - maxSessions }
    if (!preview) throw new Error('导入后世界线数量超过上限（' + maxSessions + '），请先整理旧世界线')
    warnings.push('导入后世界线数量将超过上限（' + sessions.length + '/' + maxSessions + '）：请对部分世界线选择「保留本机」或先整理旧世界线')
  }
  /* current 是提交后的唯一选择结果：优先沿用本机当前项；若本机当前已不存在，
   * 选择同工作区的首条世界线，再回退到全局首条。这样主进程、渲染层和重启后的
   * desktop-context.json 不会各自推导出不同的当前工作区。 */
  const requestedCurrent = o.current && typeof o.current === 'object' ? o.current : {}
  let currentWsId = typeof requestedCurrent.currentWsId === 'string' && spaces.some((w) => w.id === requestedCurrent.currentWsId)
    ? requestedCurrent.currentWsId : (spaces[0] && spaces[0].id) || null
  let currentSessionId = typeof requestedCurrent.currentSessionId === 'string' && sessions.some((s) => s.id === requestedCurrent.currentSessionId && (!currentWsId || s.ws === currentWsId))
    ? requestedCurrent.currentSessionId : null
  if (!currentSessionId && currentWsId) currentSessionId = (sessions.find((s) => s.ws === currentWsId) || {}).id || null
  if (!currentSessionId && sessions[0]) {
    currentSessionId = sessions[0].id
    currentWsId = sessions[0].ws || currentWsId
  }
  const current = { currentWsId, currentSessionId }
  const stats = { incoming: incoming.length, accepted: accepted.size, kept: decisions.size - accepted.size, files: writes.length, skipped: skipped.length, replaced: replacedIds.length }
  return {
    sessions, workspaces: spaces, current,
    writes, engineWrites: writes,
    replacedIds, resetIds,
    rows, warnings: [...new Set(warnings)], skipped, overLimit, stats
  }
}

function planProgressBundle(bundle, ctx) {
  const c = ctx || {}
  const validated = validateBundle(bundle, { limits: c.limits, preview: c.preview, strict: c.strict })
  return planProgress(Object.assign({}, c, { validated }))
}

module.exports = { LIMITS, validateBundle, planProgress, planProgressBundle, validateRelativePath, fileOwner, inspectEntry }
