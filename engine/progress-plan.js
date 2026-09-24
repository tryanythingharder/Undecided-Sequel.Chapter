'use strict'
const crypto = require('node:crypto')
const ID = /^[A-Za-z0-9_-]{1,120}$/
const copy = (value) => JSON.parse(JSON.stringify(value))
const fresh = (prefix) => prefix + '-' + crypto.randomBytes(12).toString('hex')
const lists = ['decisions', 'commitments', 'knowledge', 'facts', 'events', 'causal', 'relationships', 'threads', 'entities', 'sessions']
function fileOwner(relative) {
  const parts = relative.split('/')
  if (parts[0] === 'stories' && parts.length === 2) return parts[1].replace(/(?:\.meta)?\.json$/, '')
  if (parts[0] === 'pendings' && parts.length === 2) return parts[1].split('.')[0]
  if (['snapshots', 'logs'].includes(parts[0]) && parts.length === 3) return parts[1]
  throw new Error('引擎文件目录层级不正确')
}
function checkStory(story, owner) {
  if (!story || story.story_id !== owner || story.schema_version !== 1 || !story.counters || !Number.isSafeInteger(story.counters.turn) || story.counters.turn < 0 || !story.kernel || !story.player || !story.scene || lists.some((key) => !Array.isArray(story[key]))) throw new Error('进度包记忆结构不正确：' + owner)
}
function rewriteOwner(value, owner, replacement) {
  if (!value || typeof value !== 'object') return
  for (const key of Object.keys(value)) {
    if (key === 'story_id') {
      if (value[key] !== owner) throw new Error('进度包含跨世界线记忆')
      value[key] = replacement
    } else rewriteOwner(value[key], owner, replacement)
  }
}
// Pure planner: never mutates either input; main process validates path/byte limits first.
function planProgress({ sessions, workspaces, files, currentSessions, currentWorkspaces = [], choices = {}, hasKernel = () => false, hasLocalMemory = () => false, maxSessions = 200 }) {
  const incoming = copy(sessions), local = copy(currentSessions), spaces = copy(currentWorkspaces)
  const incomingSpaces = new Map(), spaceMap = new Map(), sessionMap = new Map(), decisions = new Map(), warnings = []
  for (const ws of workspaces) {
    if (!ws || !ID.test(ws.id) || typeof ws.name !== 'string' || !ws.name.trim() || incomingSpaces.has(ws.id)) throw new Error('进度包工作区数据不正确或重复')
    incomingSpaces.set(ws.id, ws)
  }
  const usedIds = new Set(local.map((s) => s.id))
  for (const s of incoming) {
    if (!s.ws || !incomingSpaces.has(s.ws)) throw new Error('世界线缺少对应工作区：' + s.id)
    const old = local.find((x) => x.id === s.id)
    const selected = choices[s.id]
    if (selected != null && !['keep', 'replace', 'branch'].includes(selected)) throw new Error('导入处理方式不正确')
    const decision = old ? (selected || (Number(old.updatedAt || 0) > Number(s.updatedAt || 0) ? 'keep' : 'replace')) : 'add'
    decisions.set(s.id, decision)
    let id = s.id
    if (decision === 'branch') { do { id = fresh('s') } while (usedIds.has(id)) }
    usedIds.add(id); sessionMap.set(s.id, id)
  }
  const rows = [], writes = [], resetIds = []
  const accepted = new Set(incoming.filter((s) => decisions.get(s.id) !== 'keep').map((s) => s.id))
  for (const ws of workspaces) {
    if (!incoming.some((s) => s.ws === ws.id && accepted.has(s.id))) continue
    const old = spaces.find((w) => w.id === ws.id)
    const conflict = old && (old.name !== ws.name || (old.kernelId || '') !== (ws.kernelId || '') || !!old.kernelPath || !!ws.kernelPath)
    let id = old && !conflict ? old.id : ws.id
    if (conflict) { do { id = fresh('ws') } while (spaces.some((w) => w.id === id)); warnings.push('工作区「' + ws.name + '」存在差异，导入到独立工作区') }
    spaceMap.set(ws.id, id)
    if (!old || conflict) spaces.push({ id, name: (conflict ? '导入 · ' : '') + ws.name.slice(0, 120), createdAt: Number(ws.createdAt) || Date.now(), kernelId: typeof ws.kernelId === 'string' && hasKernel(ws.kernelId) ? ws.kernelId : undefined, lastSessionId: sessionMap.get(ws.lastSessionId) })
  }
  const canonical = new Map()
  for (const [rel, text] of Object.entries(files)) {
    const normalized = rel.replace(/\\/g, '/')
    if (canonical.has(normalized.toLowerCase())) throw new Error('进度包引擎文件路径重复')
    const owner = fileOwner(normalized)
    if (!ID.test(owner)) throw new Error('引擎文件所属世界线非法')
    canonical.set(normalized.toLowerCase(), { rel: normalized, owner, text })
  }
  for (const entry of canonical.values()) {
    if (!sessionMap.has(entry.owner)) { warnings.push('已忽略无世界线归属的引擎文件：' + entry.rel); continue }
    if (!accepted.has(entry.owner)) continue
    const parsed = JSON.parse(entry.text), parts = entry.rel.split('/')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('进度包引擎文件格式不正确')
    const isMeta = parts[0] === 'stories' && parts[1].endsWith('.meta.json')
    if (!isMeta && parsed.story_id !== entry.owner) throw new Error('引擎文件与世界线归属不一致')
    if (parts[0] === 'stories' && !isMeta) checkStory(parsed, entry.owner)
    if (isMeta && parsed.story_id !== entry.owner) throw new Error('世界线元数据归属不一致')
    if (parts[0] === 'snapshots') { checkStory(parsed.state, entry.owner); if (parts[2] !== parsed.snapshot_id + '.json') throw new Error('快照编号与文件名不一致') }
    if (parts[0] === 'pendings' && parts[1] !== entry.owner + '.' + parsed.pending_id + '.json') throw new Error('待补录编号与文件名不一致')
    const replacement = sessionMap.get(entry.owner)
    rewriteOwner(parsed, entry.owner, replacement)
    parts[1] = ['stories', 'pendings'].includes(parts[0]) ? replacement + parts[1].slice(entry.owner.length) : replacement
    writes.push({ relative: parts.join('/'), content: JSON.stringify(parsed), owner: replacement })
  }
  for (const s of incoming) {
    const source = s.id, old = local.find((x) => x.id === source), decision = decisions.get(source)
    const ws = incomingSpaces.get(s.ws)
    const storyFile = canonical.get(('stories/' + source + '.json').toLowerCase())
    let pinned = false
    try { pinned = !!JSON.parse(storyFile?.text).kernel?.text } catch {}
    rows.push({ id: source, title: s.title, conflict: !!old, messages: s.messages.length, localMessages: old?.messages?.length || 0, incomingAt: s.updatedAt, localAt: old?.updatedAt, kernelId: ws.kernelId || '', missingKernel: !pinned && (!ws.kernelId || !hasKernel(ws.kernelId)), missingMemory: !storyFile, workspaceConflict: spaces.some((w) => w.id === spaceMap.get(s.ws) && w.id !== s.ws) })
    if (decision === 'keep') continue
    s.id = sessionMap.get(source); s.ws = spaceMap.get(s.ws)
    if (decision === 'branch') { s.ifFrom = source; s.title = '导入分支 · ' + (s.title || '未命名') }
    else if (s.ifFrom && sessionMap.has(s.ifFrom)) s.ifFrom = sessionMap.get(s.ifFrom)
    if (storyFile) resetIds.push(s.id)
    if (!storyFile) {
      if (writes.some((entry) => entry.owner === s.id)) throw new Error('引擎附属文件缺少世界记忆正本')
      if (decision === 'replace' && hasLocalMemory(source)) throw new Error('「' + (s.title || source) + '」仅含聊天，不能覆盖已有记忆；请选择保留本机或另开分支')
      warnings.push('「' + (s.title || s.id) + '」仅含聊天，将从空记忆继续')
    }
    for (const m of s.messages) {
      for (const key of ['engineSnapshot', 'engineSnapshotId', 'engineBeforeSnapshotId']) if (m[key] && !writes.some((entry) => entry.relative === 'snapshots/' + s.id + '/' + m[key] + '.json')) delete m[key]
      if (m.pending && !writes.some((entry) => entry.relative === 'pendings/' + s.id + '.' + m.pending + '.json')) delete m.pending
      delete m.committing; delete m.illustPending
      if (!storyFile) { delete m.engineTurn; delete m.enginePendingId }
    }
    const index = local.findIndex((x) => x.id === s.id)
    if (index >= 0) local[index] = s; else local.push(s)
  }
  if (local.length > maxSessions) throw new Error('导入后世界线数量超过上限（' + maxSessions + '），请先整理旧世界线')
  return { sessions: local.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)), workspaces: spaces, writes, resetIds, rows, warnings: [...new Set(warnings)] }
}
module.exports = { planProgress, fileOwner }
