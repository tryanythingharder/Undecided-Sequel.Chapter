'use strict'
/* 完整存档（Archive Store）—— 归档、恢复、导出、导入
 *
 * 归档白名单与真实 userData 布局逐一核对（2026-09-21 实测 APPDATA/六面世界）：
 *   session-data/images      —— 消息插图 + 漫画分幕图（externalizeSessions 统一外置，即「作品」图）
 *   story-engine/stories     —— 世界线正本（九大账本 / 实体 / 玩家状态 = 记忆）
 *   story-engine/snapshots   —— 状态快照
 *   story-engine/pendings    —— 待补录回合（Pending Commit）
 *   story-engine/logs        —— 回合诊断日志
 *   kernels                  —— 用户自定义内核（内置内核随应用分发，无需归档）
 *   holo-cards               —— 角色闪卡（作品面板的独立收藏层，每卡一目录）
 * 明确不归档（故不在白名单内，DENY 再兜底一层）：
 *   secrets.json / embedder.json —— 密钥与（历史遗留明文）密钥配置，绝不能进归档
 *   sessions.db / sessions.json  —— 会话正文由 manifest.sessions 承载；恢复后由主进程重写 JSON 镜像
 *   story-engine/memory.db       —— 派生语义索引（SQLite），可从正本重建，且恢复时须重建
 *   story-engine/tmp             —— 原子写临时目录
 *   pet-model/*.gguf             —— 本地模型权重（数百 MB，非用户资料）
 *   desktop-context.json / window-state.json / ui-scheme.json —— 界面偏好（工作区/当前线已随 manifest 归档）
 *
 * 加固要点：
 *  - 路径：拒绝反斜杠、NUL、冒号（Windows ADS）、绝对路径、空/./.. 段、尾随点或空格、保留设备名、
 *    白名单外目录、DENY 名单；解析结果必须落在基准目录内。
 *  - 符号链接/目录联接：归档内、数据目录链路上一律拒绝（防止归档越界读取或恢复时穿链删除）。
 *  - 大小：累计 512MB、单文件 512MB、文件数、世界线数、消息数、工作区数均有硬闸。
 *  - 角色校验：manifest 形状（type/v/id/label/kind/createdAt/current/workspaces/files）与
 *    消息 role 白名单（user/assistant/system/tool）逐条校验，id 必须与目录名一致。
 *  - 恢复：先校验目标 → 再写「恢复前自动存档」（自动档保留 10 份，且本份目标绝不被清理误删）→
 *    应用文件 → 提交；任一步失败则回滚到自动存档，失败不留半恢复状态。
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')

const ROOTS = ['session-data/images', 'story-engine/stories', 'story-engine/snapshots', 'story-engine/pendings', 'story-engine/logs', 'kernels', 'holo-cards']
const DENY = ['secrets.json', 'embedder.json', 'sessions.db', 'sessions.json', 'memory.db', 'desktop-context.json', 'window-state.json', 'ui-scheme.json', '.env']
const MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool']
const MAX_BYTES = 512 * 1024 * 1024
const MAX_FILES = 30000
const MAX_SESSIONS = 200
const MAX_MESSAGES = 50000
const MAX_WORKSPACES = 200
const KEEP_AUTOMATIC = 10
const ID = /^ARC-[a-z0-9-]+$/
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const clone = (value) => JSON.parse(JSON.stringify(value))
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex')

function createArchiveStore(dataRoot) {
  const root = path.resolve(dataRoot)
  const archiveRoot = path.join(root, 'archives')
  fs.mkdirSync(archiveRoot, { recursive: true })

  /* 相对路径校验：格式 → 白名单 → DENY。返回分段（供链路检查复用）。 */
  function safeRelative(relative) {
    if (typeof relative !== 'string' || !relative) throw new Error('非法存档路径')
    if (relative.includes(String.fromCharCode(92)) || relative.includes(String.fromCharCode(0)) || relative.includes(':')) throw new Error('非法存档路径')
    if (path.posix.isAbsolute(relative)) throw new Error('非法存档路径')
    const parts = relative.split('/')
    for (const part of parts) {
      if (!part || part === '.' || part === '..') throw new Error('非法存档路径')
      // Windows 会静默裁剪尾随空格/点，留下「同名不同路径」的别名（写入/读取指向同一文件）
      if (part !== part.trim() || /[ .]$/.test(part)) throw new Error('非法存档路径')
      if (RESERVED.test(part)) throw new Error('非法存档路径')
    }
    if (!ROOTS.some((dir) => relative.startsWith(dir + '/'))) throw new Error('存档包含不支持的数据目录')
    if (parts.some((part) => DENY.includes(part.toLowerCase()))) throw new Error('存档不得包含密钥或配置文件')
    return parts
  }
  function target(base, relative) {
    safeRelative(relative)
    const baseResolved = path.resolve(base)
    const file = path.resolve(baseResolved, relative)
    if (file === baseResolved || !file.startsWith(baseResolved + path.sep)) throw new Error('存档路径越界')
    return file
  }
  /* 目录（或联接）本身不得是符号链接 */
  function assertRealDirectory(dir, label) {
    const st = fs.lstatSync(dir)
    if (st.isSymbolicLink()) throw new Error((label || '数据目录') + '不能是符号链接')
    if (!st.isDirectory()) throw new Error((label || '数据目录') + '不是目录')
  }
  /* 相对路径的每一级祖先（含 base）都不得是符号链接/目录联接：
   * 否则 rmSync 会穿链删除链外数据、copyFileSync 会把归档内容写到链外。 */
  function assertNoSymlinkTrail(base, relative, label) {
    const baseResolved = path.resolve(base)
    if (fs.existsSync(baseResolved)) assertRealDirectory(baseResolved, label)
    const parts = relative.split('/')
    let cur = baseResolved
    for (let i = 0; i < parts.length - 1; i++) {
      cur = path.join(cur, parts[i])
      if (!fs.existsSync(cur)) return // 尚不存在：由 mkdirSync 新建，安全
      assertRealDirectory(cur, label)
    }
  }
  function directory(id) {
    if (!ID.test(String(id))) throw new Error('无效存档编号')
    const dir = path.join(archiveRoot, id)
    if (!fs.existsSync(dir)) throw new Error('无效存档编号：存档不存在')
    assertRealDirectory(dir, '存档目录')
    return dir
  }
  /* 新建存档用的目录名（不得与既有存档冲突） */
  function freshDirectory() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = 'ARC-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex')
      if (!fs.existsSync(path.join(archiveRoot, id)) && !fs.existsSync(path.join(archiveRoot, id + '.tmp'))) return { id, dir: path.join(archiveRoot, id) }
    }
    throw new Error('无法分配存档编号')
  }
  /* 目录改名不是原子操作：Windows 上杀软/索引器短暂占用会 EPERM。重试数次后降级为整树复制，
   * 保证「先写暂存目录、再整体提交」的语义不被外部干扰破坏。 */
  function commitStage(stage, dir) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { fs.renameSync(stage, dir); return } catch (error) {
        if (attempt === 4 && error && (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES')) break
        if (attempt === 4) throw error
        const until = Date.now() + 40 * (attempt + 1)
        while (Date.now() < until) { /* 短暂等待句柄释放 */ }
      }
    }
    fs.cpSync(stage, dir, { recursive: true })
    fs.rmSync(stage, { recursive: true, force: true })
  }
  /* 归档目录内不得存在任何符号链接/目录联接：否则校验、导出、恢复会沿链读到链外数据。 */
  function assertArchiveHasNoLinks(dir, relative) {
    for (const entry of fs.readdirSync(path.join(dir, relative || ''), { withFileTypes: true })) {
      const rel = relative ? relative + '/' + entry.name : entry.name
      if (entry.isSymbolicLink()) throw new Error('存档不能包含符号链接')
      if (entry.isDirectory()) assertArchiveHasNoLinks(dir, rel)
    }
  }
  function filesUnder(base) {
    const out = []
    function walk(relative) {
      const dir = path.join(base, relative)
      if (!fs.existsSync(dir)) return
      assertRealDirectory(dir, '数据目录')
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('存档目录不能包含符号链接')
        const rel = relative + '/' + entry.name
        if (entry.isDirectory()) walk(rel)
        else if (entry.isFile()) {
          if (out.length >= MAX_FILES) throw new Error('存档条目过多')
          out.push(rel)
        }
      }
    }
    ROOTS.forEach((dir) => { safeRelative(dir + '/x'); assertNoSymlinkTrail(base, dir, '数据目录'); walk(dir) })
    return out
  }
  /* manifest 校验：形状 / 角色 / 数量 / 大小 / 文件清单。expectId 存在时须与目录名一致。 */
  function validateDocument(doc, expectId) {
    if (!doc || doc.type !== 'sixworlds-archive' || doc.v !== 1) throw new Error('存档格式不正确')
    if (typeof doc.id !== 'string' || !ID.test(doc.id)) throw new Error('存档编号不正确')
    if (expectId && doc.id !== expectId) throw new Error('存档编号与目录不一致')
    if (!Array.isArray(doc.sessions) || !Array.isArray(doc.workspaces) || !Array.isArray(doc.files)) throw new Error('存档格式不正确')
    if (typeof doc.label !== 'string' || doc.label.length > 120) throw new Error('存档标签不正确')
    if (typeof doc.kind !== 'string' || !doc.kind || doc.kind.length > 40) throw new Error('存档类型不正确')
    if (!Number.isSafeInteger(doc.createdAt) || doc.createdAt <= 0) throw new Error('存档时间不正确')
    if (doc.current == null || typeof doc.current !== 'object' || Array.isArray(doc.current)) throw new Error('存档当前状态不正确')
    if (doc.sessions.length > MAX_SESSIONS) throw new Error('存档世界线过多')
    if (doc.workspaces.length > MAX_WORKSPACES) throw new Error('存档工作区过多')
    if (doc.files.length > MAX_FILES) throw new Error('存档条目过多')
    const ids = new Set()
    for (const session of doc.sessions) {
      if (!session || typeof session.id !== 'string' || !session.id || session.id.length > 120 || ids.has(session.id) || !Array.isArray(session.messages)) throw new Error('存档世界线数据不正确')
      if (session.messages.length > MAX_MESSAGES) throw new Error('存档世界线消息过多')
      ids.add(session.id)
      for (const message of session.messages) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('存档消息数据不正确')
        if (message.role !== undefined && (typeof message.role !== 'string' || !MESSAGE_ROLES.includes(message.role))) throw new Error('存档消息角色不正确')
      }
    }
    for (const workspace of doc.workspaces) {
      if (!workspace || typeof workspace.id !== 'string' || !workspace.id || typeof workspace.name !== 'string') throw new Error('存档工作区数据不正确')
    }
    const seen = new Set()
    let bytes = 0
    for (const file of doc.files) {
      target(root, file.path)
      if (seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_BYTES || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('存档文件清单不正确')
      seen.add(file.path)
      bytes += file.bytes
      if (bytes > MAX_BYTES) throw new Error('存档超过 512MB 上限')
    }
    return doc
  }
  function inspect(id) {
    const dir = directory(id)
    return validateDocument(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), id)
  }
  function list() {
    return fs.readdirSync(archiveRoot).filter((id) => ID.test(id)).flatMap((id) => {
      try {
        const d = inspect(id)
        return [{ id, label: d.label, kind: d.kind, createdAt: d.createdAt, sessions: d.sessions.length, messages: d.sessions.reduce((n, s) => n + s.messages.length, 0), bytes: d.files.reduce((n, f) => n + f.bytes, 0) }]
      } catch { return [] }
    }).sort((a, b) => b.createdAt - a.createdAt)
  }
  function remove(id) { fs.rmSync(directory(id), { recursive: true, force: true }) }
  /* 自动档保留 10 份；keepId（正在被恢复的目标）计入额度但永不参与淘汰——
   * 否则「先建回滚档再恢复」会让自动档变 11 份、而按时间淘汰恰好先删掉目标。 */
  function pruneAutomatic(keepId) {
    const automatic = list().filter((item) => item.kind !== 'manual')
    const others = automatic.filter((item) => item.id !== keepId)
    const allowance = Math.max(0, KEEP_AUTOMATIC - (automatic.length - others.length))
    for (const old of others.slice(allowance)) remove(old.id)
  }
  function create({ sessions, workspaces = [], current = {}, label = '手动存档', kind = 'manual', keepId = null } = {}) {
    const { id, dir } = freshDirectory()
    const stage = dir + '.tmp'
    fs.rmSync(stage, { recursive: true, force: true }) // 清理上次崩溃残留的暂存目录
    fs.mkdirSync(stage, { recursive: true })
    try {
      const manifest = { type: 'sixworlds-archive', v: 1, id, label: String(label).slice(0, 120), kind: String(kind || 'manual').slice(0, 40), createdAt: Date.now(), sessions: clone(sessions), workspaces: clone(workspaces), current: clone(current), files: [] }
      let total = Buffer.byteLength(JSON.stringify(manifest))
      for (const relative of filesUnder(root)) {
        const source = target(root, relative)
        const stat = fs.lstatSync(source)
        if (stat.isSymbolicLink()) throw new Error('存档不能包含符号链接')
        if (!stat.isFile()) continue
        total += stat.size
        if (stat.size > MAX_BYTES || total > MAX_BYTES) throw new Error('存档超过 512MB 上限，请先导出并整理旧作品')
        const data = fs.readFileSync(source)
        const to = target(stage, relative)
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.writeFileSync(to, data)
        manifest.files.push({ path: relative, bytes: stat.size, sha256: digest(data) })
      }
      validateDocument(manifest, id)
      fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest))
      commitStage(stage, dir)
      pruneAutomatic(keepId)
      return list().find((item) => item.id === id)
    } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error }
  }
  function verify(id) {
    const dir = directory(id)
    const doc = inspect(id)
    assertArchiveHasNoLinks(dir, '')
    for (const entry of doc.files) {
      assertNoSymlinkTrail(dir, entry.path, '存档目录')
      const file = target(dir, entry.path)
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('存档文件不能是符号链接')
      const data = fs.readFileSync(file)
      if (data.length !== entry.bytes || digest(data) !== entry.sha256) throw new Error('存档文件已损坏：' + entry.path)
    }
    return doc
  }
  function applyFiles(id) {
    const doc = verify(id)
    for (const relative of ROOTS) {
      const live = path.join(root, relative)
      safeRelative(relative + '/x')
      assertNoSymlinkTrail(root, relative, '数据目录') // 拒绝穿链删除：链外数据不归本应用管
      if (fs.existsSync(live)) fs.rmSync(live, { recursive: true, force: true })
    }
    for (const entry of doc.files) {
      const destination = target(root, entry.path)
      assertNoSymlinkTrail(root, entry.path, '数据目录')
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(target(directory(id), entry.path), destination)
    }
    return clone(doc)
  }
  function restore(id, current, commit, reset) {
    const doc = inspect(id) // 目标先校验：编号合法、清单可读（失败即中止，不碰现状）
    const rollback = create({ ...(current || {}), label: '恢复前自动存档', kind: 'before-restore', keepId: id })
    try {
      reset()
      const applied = applyFiles(id)
      commit(applied)
      return { doc: applied, rollbackId: rollback.id }
    } catch (error) {
      reset()
      try { commit(applyFiles(rollback.id)) } catch (rollbackError) { throw new Error('恢复失败，自动备份已保留：' + rollback.id + '；' + rollbackError.message) }
      throw error
    }
  }
  function exportFile(id, destination) {
    if (typeof destination !== 'string' || !destination) throw new Error('导出目标不正确')
    const doc = verify(id)
    const contents = {}
    for (const file of doc.files) contents[file.path] = fs.readFileSync(target(directory(id), file.path)).toString('base64')
    const data = zlib.gzipSync(Buffer.from(JSON.stringify({ ...doc, contents })))
    fs.writeFileSync(destination, data)
  }
  function importFile(source) {
    if (fs.statSync(source).size > MAX_BYTES) throw new Error('存档文件过大')
    const doc = validateDocument(JSON.parse(zlib.gunzipSync(fs.readFileSync(source), { maxOutputLength: MAX_BYTES * 1.5 }).toString('utf8')))
    if (!doc.contents || typeof doc.contents !== 'object') throw new Error('存档缺少文件')
    const { id, dir } = freshDirectory()
    const stage = dir + '.tmp'
    fs.rmSync(stage, { recursive: true, force: true })
    fs.mkdirSync(stage, { recursive: true })
    try {
      for (const entry of doc.files) {
        if (typeof doc.contents[entry.path] !== 'string') throw new Error('存档缺少文件')
        const data = Buffer.from(doc.contents[entry.path], 'base64')
        if (data.length > MAX_BYTES || data.length !== entry.bytes || digest(data) !== entry.sha256) throw new Error('存档校验失败')
        const to = target(stage, entry.path)
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.writeFileSync(to, data)
      }
      delete doc.contents
      Object.assign(doc, { id, kind: 'manual', label: '导入 · ' + doc.label, createdAt: Date.now() })
      validateDocument(doc, id)
      fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(doc))
      commitStage(stage, dir)
      return list().find((item) => item.id === id)
    } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error }
  }
  return { create, list, inspect, restore, remove, exportFile, importFile }
}
module.exports = { createArchiveStore }
