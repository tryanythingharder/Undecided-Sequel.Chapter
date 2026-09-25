'use strict'
/* 六面世界 · 内核工作台（桌面作者工具）—— 不可变发布版本 / 文本差异 / 独立引擎沙盒试跑
 *
 * 定位（三件事，全部离线、零依赖、零网络）：
 *  1) 不可变内核发布版本：内容 sha256 为身份，版本号单调递增；旧版本文件只写一次（flag:'wx'），
 *     任何路径都不会覆盖既有版本；同一内容重复发布只返回既有版本（duplicate），不产生新版本。
 *  2) 版本文本差异：行级 LCS 差异（统计 + 分块 + 统一格式渲染），用于审阅两次发布之间改了什么。
 *  3) 独立引擎沙盒试跑：把「用户选择的内核版本」装进一个全新引擎目录，跑固定本地 mock 叙事 +
 *     STATE_PATCH 提交流程，产出可重现记录（对稳定字段取 sha256 摘要，同用例重复运行摘要一致）。
 *
 * 边界（硬约束，代码层面保证）：
 *  - 不调用任何模型 / 网络：本模块不含 fetch/http，真实试玩入口 runRealPlaytest() 在未获授权时
 *    一律返回 blocked，不发起任何请求。
 *  - 不改玩家世界线 / 工作区：沙盒引擎目录位于本模块自己的 dataRoot 子目录下（sandbox/<runId>），
 *    storyId 带 WB- 前缀，运行结束即删除；不读写 app 的 story-engine、workspaces、存档。
 *  - 记录明确标注 mode='offline-mock-simulation' 与 realPlaytest=false，避免被当成真实试玩结论。
 *
 * 接入（父代理只需包一层 IPC）：
 *   const WB = require('./engine/kernel-workbench')
 *   // 方式一（推荐）：register 一步拿「通道 → 处理函数」，直接挂到既有 safeHandle
 *   const wb = WB.register(path.join(app.getPath('userData'), 'kernel-workbench-data'))
 *   for (const [channel, handler] of Object.entries(wb.ipcHandlers)) safeHandle(channel, handler)
 *   // 方式二：只用主体，自己包通道
 *   const wb = WB.createWorkbench(dataRoot)   // 等价于 createKernelWorkbench({ dataRoot })
 *   ipcMain.handle('kernel-wb:publish', (_e, p) => wb.publish(p))  // 其余同名方法：list/read/diff/verify/cases/run/records/capabilities
 * preload.cjs 里对应暴露（渲染层 window.api 方法名 ← 通道名）：
 *   kernelWbCapabilities ← kernel-wb:capabilities     kernelWbPublish ← kernel-wb:publish
 *   kernelWbList         ← kernel-wb:list             kernelWbRead    ← kernel-wb:read
 *   kernelWbDiff         ← kernel-wb:diff             kernelWbVerify  ← kernel-wb:verify
 *   kernelWbCases        ← kernel-wb:cases            kernelWbRun     ← kernel-wb:run
 *   kernelWbRecords      ← kernel-wb:records          kernelWbRealStatus ← kernel-wb:real-status
 * 每个方法都返回纯 JSON（{ ok, ... }），不抛异常，便于直接回传渲染层。
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createEngine, ENGINE_VERSION, ENGINE_META } = require('./index')

const SCHEMA = 'sixworlds.kernel-workbench/1'
const RECORD_SCHEMA = 'sixworlds.kernel-workbench.record/1'
const MAX_KERNEL_BYTES = 1024 * 1024 // 与 main.cjs MAX_KERNEL_BYTES 对齐
const MAX_UNIFIED_CHARS = 200000
const CONTEXT_LINES = 2

const DISCLAIMER = '离线模拟：固定本地 mock 叙事 + STATE_PATCH 协议，在独立引擎沙盒中运行；不调用任何模型或网络，不是收费模型的真实试玩结果，也不改变你的世界线与工作区。'

const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
const shortHash = (hash) => String(hash).slice(0, 12)

/* 稳定序列化：对象键排序、数组保序 —— 摘要只对「可复现字段」计算 */
function canonicalJson(value) {
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(walk)
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k])
    return out
  }
  return JSON.stringify(walk(value))
}

/* refKey：把任意内核 ref（builtin:/user:/草稿名）压成稳定目录名 */
function refKeyOf(ref) {
  const raw = String(ref == null ? '' : ref).trim() || 'default'
  const base = raw.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'default'
  return base + '-' + sha256(raw).slice(0, 8)
}

/* ============================== 固定本地 mock 用例 ==============================
 * 全部为本地常量文本：无网络、无随机、无时间戳。用例覆盖 STATE_PATCH 主链路
 * （新账本 + 承诺/伏笔/因果闭环）、显式 NO_STATE_CHANGE、引用冲突全回滚、
 * 无协议标记的尾部裸 JSON 兜底识别四条路径。
 * expect 字段仅作说明与 UI 提示，断言在 scripts-dev/test-kernel-workbench.cjs 内。 */
const CASES = [
  {
    id: 'basic-loop',
    title: '主线两步：建立状态 → 闭环承诺/伏笔/因果',
    description: '两幕：第一幕写入实体/决定/事实（含一条玩家不可知秘密）/事件/关系/认知/伏笔/因果；第二幕用 commitment_updates + threads.update + causal_updates 把它们闭环。',
    expect: ['PATCH_PRESENT', 'PATCH_PRESENT'],
    turns: [
      {
        playerInput: 'A. 跟随旅人前往北岭',
        raw: [
          '【离线模拟 · 固定样例｜第 1 幕｜青石村口】',
          '旅人祁把旧皮箱放在石阶上，向你打听北岭的路。你把祖传的青铜罗盘借给了他。',
          '夜里村里有人提起，北岭近来半夜总有铜铃响。',
          '',
          '【你需要决定】',
          'A. 跟随旅人前往北岭',
          'B. 留在村里等消息',
          'C. 追问罗盘的来历',
          '',
          '<<<STATE_PATCH>>>',
          '{"turn_summary":"把罗盘借给旅人并得知北岭异动",',
          ' "scene":{"game_time":"玄历 412.03.01 清晨","location":"青石村口","participants":["旅人祁","主角"],"ended":false},',
          ' "player_state":{"location":"青石村口","resources_add":{"信任":1}},',
          ' "entity_changes":[{"op":"upsert","name":"旅人祁","type":"character","summary":"背着旧皮箱的游方旅人","tags":["旅人"]},{"op":"upsert","name":"青石村","type":"location","summary":"山脚的小村"}],',
          ' "decisions":[{"raw_input":"A. 跟随旅人前往北岭","normalized_intent":"跟随旅人前往北岭","importance":40,"reversible":true,"source":"user_pick"}],',
          ' "commitments":[{"content":"护送旅人祁抵达北岭","kind":"promise","importance":60,"due_hint":"三日内"}],',
          ' "facts":[{"key":"beiling_bell","statement":"北岭近来夜里有铜铃之声","importance":30,"entity_names":["北岭"]},',
          '          {"key":"luopan_origin","statement":"青铜罗盘来自更北的旧王朝","secret_from_player":true,"importance":50}],',
          ' "events":[{"type":"dialogue","description":"旅人祁在村口向你问路","importance":30,"participant_names":["旅人祁"]}],',
          ' "relationships":[{"source_name":"主角","target_name":"旅人祁","relation_type":"friend","strength_delta":5,"description":"一次善意的借予"}],',
          ' "knowledge":[{"content":"北岭近来夜里有铜铃之声","how_learned":"told_by"}],',
          ' "threads":[{"op":"add","title":"北岭的铜铃","detail":"夜半铃声与旧王朝有关","importance":60}],',
          ' "causal":[{"cause":"借出祖传罗盘","effect":"旅人将因此欠你一份人情","importance":50}]}',
          '<<<END_PATCH>>>'
        ].join('\n')
      },
      {
        playerInput: 'A. 在古道入口追问铃铛的来历',
        raw: [
          '【离线模拟 · 固定样例｜第 2 幕｜北岭古道】',
          '罗盘在没有风的情况下自行转动，指针始终指向岭上的废墟。旅人祁在古道入口替你还了这份人情。',
          '',
          '【你需要决定】',
          'A. 在古道入口追问铃铛的来历',
          'B. 绕开废墟先扎营',
          '',
          '<<<STATE_PATCH>>>',
          '{"turn_summary":"抵达北岭古道，罗盘自行指向废墟，铃铛来历揭晓",',
          ' "scene":{"game_time":"玄历 412.03.02 夜","location":"北岭古道","participants":["旅人祁","主角"],"ended":false},',
          ' "player_state":{"resources_add":{"信任":2}},',
          ' "events":[{"type":"discovery","description":"罗盘在无风的情况下自行转动并指向废墟","importance":50,"participant_names":["旅人祁"]}],',
          ' "commitment_updates":[{"ref":"护送旅人祁抵达北岭","status":"FULFILLED","note":"已抵达北岭古道"}],',
          ' "threads":[{"op":"update","ref":"北岭的铜铃","status":"RESOLVED","detail":"铃声来自旧王朝留在废墟里的镇物"}],',
          ' "causal_updates":[{"ref":"借出祖传罗盘","status":"RESOLVED","note":"旅人在古道入口替你还了人情"}]}',
          '<<<END_PATCH>>>'
        ].join('\n')
      }
    ]
  },
  {
    id: 'no-state-change',
    title: '纯闲聊回合：显式 NO_STATE_CHANGE',
    description: '一幕寒暄，模型在末尾声明 <<<NO_STATE_CHANGE>>>：合法结束，不写结构化状态、不递增回合。',
    expect: ['NO_STATE_CHANGE'],
    turns: [
      {
        playerInput: '随便聊聊今天的天气',
        raw: [
          '【离线模拟 · 固定样例｜第 1 幕｜青石村口】',
          '你与村口晒太阳的老人闲聊了几句，天气不错，没有别的事发生。',
          '',
          '【你需要决定】',
          'A. 回家收拾行装',
          'B. 继续闲聊',
          '',
          '<<<NO_STATE_CHANGE>>>'
        ].join('\n')
      }
    ]
  },
  {
    id: 'conflict-rollback',
    title: '引用冲突：整回合回滚，不留半提交',
    description: '第一幕建立承诺；第二幕先 upsert 一个实体，再用不存在的承诺引用触发 PATCH_CONFLICT —— 整回合回滚，实体与回合号都必须不落账。',
    expect: ['PATCH_PRESENT', 'PATCH_CONFLICT'],
    turns: [
      {
        playerInput: 'A. 答应替村长看管祠堂',
        raw: [
          '【离线模拟 · 固定样例｜第 1 幕｜青石村祠堂】',
          '村长把祠堂钥匙交到你手上，叮嘱三日内务必回来一趟。',
          '',
          '【你需要决定】',
          'A. 答应替村长看管祠堂',
          'B. 推辞',
          '',
          '<<<STATE_PATCH>>>',
          '{"turn_summary":"答应替村长看管祠堂",',
          ' "scene":{"game_time":"玄历 412.03.01 傍晚","location":"青石村祠堂","participants":["村长","主角"]},',
          ' "entity_changes":[{"op":"upsert","name":"村长","type":"character","summary":"青石村的长者"}],',
          ' "commitments":[{"content":"三日内回祠堂复命","kind":"promise","importance":50}],',
          ' "events":[{"type":"action","description":"接下祠堂钥匙","importance":30,"participant_names":["村长"]}]}',
          '<<<END_PATCH>>>'
        ].join('\n')
      },
      {
        playerInput: 'A. 立刻回祠堂复命',
        raw: [
          '【离线模拟 · 固定样例｜第 2 幕｜北岭古道】',
          '你想起村长的嘱托，转身往回走。',
          '',
          '【你需要决定】',
          'A. 立刻回祠堂复命',
          'B. 先去看看废墟',
          '',
          '<<<STATE_PATCH>>>',
          '{"turn_summary":"折返祠堂",',
          ' "scene":{"game_time":"玄历 412.03.02 晨","location":"回村的岔路"},',
          ' "entity_changes":[{"op":"upsert","name":"不该出现的角色","type":"character"}],',
          ' "commitment_updates":[{"ref":"根本不存在的承诺编号 CMT-999999","status":"FULFILLED","note":"故意制造引用冲突"}]}',
          '<<<END_PATCH>>>'
        ].join('\n')
      }
    ]
  },
  {
    id: 'unmarked-tail-json',
    title: '协议容错：无标记的尾部裸 JSON',
    description: '模型忘记写 <<<STATE_PATCH>>> 标记，只在回复末尾贴了状态形状的裸 JSON：引擎兜底识别并记 PATCH_UNMARKED 警告。',
    expect: ['PATCH_PRESENT'],
    turns: [
      {
        playerInput: 'B. 先记下罗盘的纹路',
        raw: [
          '【离线模拟 · 固定样例｜第 1 幕｜青石村口】',
          '你掏出炭笔，把罗盘背面的纹路拓在布片上。',
          '',
          '【你需要决定】',
          'A. 继续拓印',
          'B. 收起布片',
          '',
          '{"turn_summary":"拓下罗盘背面的纹路",',
          ' "scene":{"game_time":"玄历 412.03.01 正午","location":"青石村口"},',
          ' "facts":[{"key":"luopan_pattern","statement":"罗盘背面刻着六边纹路","importance":20}],',
          ' "events":[{"type":"action","description":"用炭笔拓下罗盘纹路","importance":20}]}'
        ].join('\n')
      }
    ]
  }
]

/* ============================== 文本差异（行级 LCS） ============================== */
function splitLines(text) {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n')
}

/* LCS 差异操作序列：{ t: 'eq' | 'del' | 'add', line } */
function lcsOps(a, b) {
  // 掐头去尾：公共前后缀不参与 DP（真实内核版本差异通常很局部）
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const midA = a.slice(start, endA), midB = b.slice(start, endB)
  const ops = []
  for (let i = 0; i < start; i++) ops.push({ t: 'eq', line: a[i] })
  if (midA.length * midB.length > 4000000) {
    // 超大差异：退化为「全删 + 全增」，不建 DP 表（避免内存爆掉）
    for (const line of midA) ops.push({ t: 'del', line })
    for (const line of midB) ops.push({ t: 'add', line })
  } else {
    const n = midA.length, m = midB.length
    const dp = new Uint32Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] = midA[i] === midB[j]
          ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)])
      }
    }
    let i = 0, j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push({ t: 'eq', line: midA[i] }); i++; j++ }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) { ops.push({ t: 'del', line: midA[i] }); i++ }
      else { ops.push({ t: 'add', line: midB[j] }); j++ }
    }
    while (i < n) ops.push({ t: 'del', line: midA[i++] })
    while (j < m) ops.push({ t: 'add', line: midB[j++] })
  }
  for (let k = endA; k < a.length; k++) ops.push({ t: 'eq', line: a[k] })
  return ops
}

/* 差异分块（带上下文行），块内保留原始行序 */
function buildHunks(ops, context) {
  const marks = ops.map((op) => op.t !== 'eq')
  const hunks = []
  let i = 0
  while (i < ops.length) {
    if (!marks[i]) { i++; continue }
    let from = Math.max(0, i - context)
    let to = i
    while (to < ops.length) {
      if (marks[to]) { to++; continue }
      // 连续相同行不足 2*context 时并入本块
      let k = to
      while (k < ops.length && !marks[k]) k++
      if (k < ops.length && k - to <= context * 2) { to = k; continue }
      break
    }
    to = Math.min(ops.length, to + context)
    const lines = ops.slice(from, to)
    let aStart = 1, bStart = 1
    for (let k = 0; k < from; k++) {
      if (ops[k].t !== 'add') aStart++
      if (ops[k].t !== 'del') bStart++
    }
    hunks.push({
      aStart, bStart,
      aCount: lines.filter((l) => l.t !== 'add').length,
      bCount: lines.filter((l) => l.t !== 'del').length,
      lines: lines.map((l) => ({ type: l.t === 'eq' ? 'equal' : (l.t === 'del' ? 'del' : 'add'), text: l.line }))
    })
    i = to
  }
  return hunks
}

function diffText(aText, bText) {
  const a = splitLines(aText), b = splitLines(bText)
  const ops = lcsOps(a, b)
  const stats = { aLines: a.length, bLines: b.length, added: 0, removed: 0, same: 0 }
  for (const op of ops) {
    if (op.t === 'add') stats.added++
    else if (op.t === 'del') stats.removed++
    else stats.same++
  }
  const hunks = buildHunks(ops, CONTEXT_LINES)
  const out = ['--- 旧版本', '+++ 新版本']
  if (!stats.added && !stats.removed) out.push('（两份文本逐行相同）')
  for (const h of hunks) {
    out.push('@@ -' + h.aStart + ',' + h.aCount + ' +' + h.bStart + ',' + h.bCount + ' @@')
    for (const line of h.lines) out.push((line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ') + line.text)
  }
  let unified = out.join('\n')
  let truncated = false
  if (unified.length > MAX_UNIFIED_CHARS) { unified = unified.slice(0, MAX_UNIFIED_CHARS) + '\n…（差异过大，已截断）'; truncated = true }
  return { stats, hunks, unified, truncated, identical: !stats.added && !stats.removed }
}

/* ============================== 工作台主体 ============================== */
function createKernelWorkbench(options) {
  const opts = options || {}
  const dataRoot = path.resolve(String(opts.dataRoot || path.join(process.cwd(), 'output', 'kernel-workbench-data')))
  const root = path.join(dataRoot, 'kernel-workbench')
  const releasesDir = path.join(root, 'releases')
  const recordsDir = path.join(root, 'records')
  const sandboxRoot = path.join(root, 'sandbox')
  const indexPath = path.join(root, 'index.json')
  /* 记录留存上限（每个内核版本目录）：防止作者反复试跑把磁盘写满；超出按时间裁掉最旧的 */
  const maxRecordsPerVersion = Number(opts.maxRecordsPerVersion) > 0 ? Number(opts.maxRecordsPerVersion) : 40

  function ensureDirs() {
    for (const d of [root, releasesDir, recordsDir, sandboxRoot]) fs.mkdirSync(d, { recursive: true })
  }

  function atomicWrite(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
    fs.writeFileSync(tmp, data, 'utf8')
    try { fs.renameSync(tmp, file) } catch (e) {
      try { fs.rmSync(file, { force: true }) } catch { /* 忽略 */ }
      try { fs.renameSync(tmp, file) } catch (e2) { try { fs.rmSync(tmp, { force: true }) } catch { /* 忽略 */ }; throw e2 }
    }
  }

  function readIndex() {
    ensureDirs()
    try {
      const v = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      if (v && typeof v === 'object' && v.kernels && typeof v.kernels === 'object') return v
    } catch { /* 首次或损坏：重建空索引 */ }
    return { schema: SCHEMA, kernels: {} }
  }
  function writeIndex(idx) { atomicWrite(indexPath, JSON.stringify(idx, null, 2)) }

  function releasePath(refKey, version) { return path.join(releasesDir, refKey, String(version) + '.json') }
  function readReleaseFile(refKey, version) {
    const file = releasePath(refKey, version)
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!rec || typeof rec !== 'object' || typeof rec.text !== 'string') throw new Error('版本文件损坏：' + version)
    return { rec, file }
  }

  /* ---- 1) 发布不可变版本 ---- */
  function publish(payload) {
    try {
      const p = payload || {}
      const ref = String(p.ref == null ? '' : p.ref).trim() || 'draft'
      const name = String(p.name == null ? '' : p.name).trim()
      const note = String(p.note == null ? '' : p.note).trim().slice(0, 400)
      const text = String(p.text == null ? '' : p.text)
      if (!text.trim()) return { ok: false, error: '内核内容为空，不能发布' }
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > MAX_KERNEL_BYTES) return { ok: false, error: '内核过大（上限 1MB）' }

      const refKey = refKeyOf(ref)
      const hash = sha256(text)
      const idx = readIndex()
      const entry = idx.kernels[refKey] || (idx.kernels[refKey] = { ref, name: name || ref, versions: [] })

      const dup = entry.versions.find((v) => v.hash === hash)
      if (dup) {
        // 内容未变：不新增版本、不改动任何既有文件（不可变性的核心语义）
        if (name && entry.name !== name) { entry.name = name; writeIndex(idx) }
        return { ok: true, duplicate: true, ref, refKey, version: dup.version, hash, shortHash: dup.shortHash, release: dup }
      }

      const version = 'v' + (entry.versions.length + 1)
      const meta = {
        schema: SCHEMA,
        ref,
        refKey,
        name: name || entry.name || ref,
        version,
        hash,
        shortHash: shortHash(hash),
        bytes,
        chars: text.length,
        createdAt: Date.now(),
        note,
        text
      }
      // 只写一次：flag 'wx' 保证既有版本文件绝不被覆盖
      fs.mkdirSync(path.dirname(releasePath(refKey, version)), { recursive: true })
      fs.writeFileSync(releasePath(refKey, version), JSON.stringify(meta, null, 2), { flag: 'wx', encoding: 'utf8' })

      const summary = {
        version, hash, shortHash: meta.shortHash, bytes, chars: meta.chars,
        createdAt: meta.createdAt, note
      }
      entry.versions.push(summary)
      if (name) entry.name = name
      writeIndex(idx)
      return { ok: true, duplicate: false, ref, refKey, version, hash, shortHash: meta.shortHash, release: summary }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  /* ---- 2) 版本列表 / 读取 / 差异 ---- */
  function list(payload) {
    try {
      const ref = String((payload && payload.ref) || '').trim()
      if (!ref) return { ok: false, error: '缺少内核 ref' }
      const refKey = refKeyOf(ref)
      const idx = readIndex()
      const entry = idx.kernels[refKey]
      const versions = entry ? entry.versions.slice() : []
      return {
        ok: true,
        ref, refKey,
        name: entry ? entry.name : '',
        releases: versions,
        latest: versions.length ? versions[versions.length - 1].version : null,
        immutable: true
      }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }

  function read(payload) {
    try {
      const p = payload || {}
      const ref = String(p.ref || '').trim()
      if (!ref) return { ok: false, error: '缺少内核 ref' }
      const refKey = refKeyOf(ref)
      const idx = readIndex()
      const entry = idx.kernels[refKey]
      if (!entry || !entry.versions.length) return { ok: false, error: '该内核还没有已发布版本' }
      const version = String(p.version || entry.versions[entry.versions.length - 1].version)
      if (!entry.versions.some((v) => v.version === version)) return { ok: false, error: '版本不存在：' + version }
      const { rec } = readReleaseFile(refKey, version)
      return { ok: true, meta: Object.assign({}, rec, { text: undefined }), text: rec.text }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }

  function diff(payload) {
    try {
      const p = payload || {}
      const ref = String(p.ref || '').trim()
      if (!ref) return { ok: false, error: '缺少内核 ref' }
      const refKey = refKeyOf(ref)
      const idx = readIndex()
      const entry = idx.kernels[refKey]
      if (!entry || entry.versions.length < 1) return { ok: false, error: '该内核还没有已发布版本' }
      const versions = entry.versions.map((v) => v.version)
      let from = String(p.from || '')
      let to = String(p.to || '')
      if (!from && !to) {
        if (versions.length < 2) return { ok: false, error: '只有一个版本，暂无可对比的差异' }
        from = versions[versions.length - 2]
        to = versions[versions.length - 1]
      } else {
        if (!from) from = versions[Math.max(0, versions.indexOf(to) - 1)]
        if (!to) to = versions[Math.max(0, versions.indexOf(from) + 1)]
      }
      if (!versions.includes(from) || !versions.includes(to)) return { ok: false, error: '版本不存在：' + (versions.includes(from) ? to : from) }
      const a = readReleaseFile(refKey, from).rec
      const b = readReleaseFile(refKey, to).rec
      const d = diffText(a.text, b.text)
      return {
        ok: true, ref, refKey,
        from: { version: from, hash: a.hash, shortHash: a.shortHash, createdAt: a.createdAt },
        to: { version: to, hash: b.hash, shortHash: b.shortHash, createdAt: b.createdAt },
        stats: d.stats, hunks: d.hunks, unified: d.unified, truncated: d.truncated, identical: d.identical
      }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }

  /* ---- 完整性校验：重算每个版本文件的内容哈希，与索引比对（防手改/防覆盖） ---- */
  function verify(payload) {
    try {
      const ref = String((payload && payload.ref) || '').trim()
      if (!ref) return { ok: false, error: '缺少内核 ref' }
      const refKey = refKeyOf(ref)
      const idx = readIndex()
      const entry = idx.kernels[refKey]
      if (!entry) return { ok: true, intact: true, checked: 0, issues: [] }
      const issues = []
      for (const v of entry.versions) {
        try {
          const { rec, file } = readReleaseFile(refKey, v.version)
          const actual = sha256(rec.text)
          if (actual !== rec.hash) issues.push({ version: v.version, code: 'FILE_TAMPERED', message: '版本文件内容与自身哈希不符' })
          if (actual !== v.hash) issues.push({ version: v.version, code: 'INDEX_MISMATCH', message: '版本文件内容与索引哈希不符' })
          if (rec.version !== v.version) issues.push({ version: v.version, code: 'VERSION_MISMATCH', message: '版本文件与索引版本号不符' })
          void file
        } catch (e) { issues.push({ version: v.version, code: 'FILE_MISSING', message: String((e && e.message) || e) }) }
      }
      return { ok: true, intact: issues.length === 0, checked: entry.versions.length, issues }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }

  /* ---- 3) 固定用例清单 ---- */
  function cases() {
    return {
      ok: true,
      network: 'none',
      mode: 'offline-mock-simulation',
      disclaimer: DISCLAIMER,
      cases: CASES.map((c) => ({
        id: c.id, title: c.title, description: c.description,
        turns: c.turns.length, expect: c.expect.slice()
      }))
    }
  }

  /* ---- 4) 沙盒试跑 ---- */
  function runCase(payload) {
    const p = payload || {}
    let engine = null
    let sandboxDir = ''
    try {
      const ref = String(p.ref || '').trim()
      if (!ref) return { ok: false, error: '缺少内核 ref' }
      const caseId = String(p.caseId || '').trim()
      const testCase = CASES.find((c) => c.id === caseId)
      if (!testCase) return { ok: false, error: '未知用例：' + caseId }

      const refKey = refKeyOf(ref)
      const idx = readIndex()
      const entry = idx.kernels[refKey]
      if (!entry || !entry.versions.length) return { ok: false, error: '请先发布该内核的一个版本，再运行试跑' }
      const version = String(p.version || entry.versions[entry.versions.length - 1].version)
      if (!entry.versions.some((v) => v.version === version)) return { ok: false, error: '版本不存在：' + version }
      const { rec: release } = readReleaseFile(refKey, version)

      /* 沙盒目录：本次运行独占，位于本模块自己的 dataRoot 下，绝不触碰 app 的 story-engine */
      sandboxDir = path.join(sandboxRoot, 'run-' + caseId.replace(/[^A-Za-z0-9_-]/g, '-') + '-' + release.shortHash + '-' + Date.now().toString(36) + '-' + process.pid)
      fs.mkdirSync(sandboxDir, { recursive: true })

      engine = createEngine(sandboxDir)
      const storyId = 'WB-' + caseId.replace(/[^A-Za-z0-9]/g, '-') + '-' + release.shortHash
      const sessionId = 'SES-WB-1'
      const ens = engine.ensureStory({ storyId, title: '内核试跑 · ' + testCase.title, kernelId: 'workbench:' + ref + '@' + version, kernelText: release.text })
      const kernelBinding = ens.kernel_version

      const turns = []
      for (let i = 0; i < testCase.turns.length; i++) {
        const t = testCase.turns[i]
        const cx = engine.buildContext(storyId, { playerInput: t.playerInput, accessLevel: 'PLAYER' })
        const res = engine.commitFromRaw(t.raw, {
          storyId, sessionId,
          playerInput: t.playerInput,
          intent: t.playerInput.slice(0, 200),
          model: 'offline-mock-fixture',
          rawOutput: t.raw,
          retrievedIds: (cx && cx.retrieved && cx.retrieved.retrieved_ids) || [],
          contextSize: cx && cx.block ? cx.block.length : 0
        })
        const story = engine.getStory(storyId)
        const ov = engine.overview(storyId)
        const block = (cx && cx.block) || ''
        turns.push({
          index: i + 1,
          playerInput: t.playerInput,
          narrative: res.narrative || '',
          patch_status: res.patch_status || null,
          committed: !!res.committed,
          applied: res.applied || {},
          warnings: (res.warnings || []).map((w) => w.code),
          errors: (res.errors || []).map((e) => e.code),
          context_chars: block.length,
          context_hash: block ? 'sha256:' + shortHash(sha256(block)) : '',
          context_block: block,
          retrieved_ids: ((cx && cx.retrieved && cx.retrieved.retrieved_ids) || []).slice().sort(),
          kernel_binding: story ? story.kernel.version : '',
          overview_counts: (ov && ov.counts) || {}
        })
      }

      const summary = {
        turns: turns.length,
        committed: turns.filter((t) => t.committed).length,
        conflicts: turns.filter((t) => t.patch_status === 'PATCH_CONFLICT').length,
        noStateChange: turns.filter((t) => t.patch_status === 'NO_STATE_CHANGE').length,
        missing: turns.filter((t) => t.patch_status === 'PATCH_MISSING').length,
        engine_turn: (engine.overview(storyId) || { engine_turn: 0 }).engine_turn
      }

      /* 摘要只覆盖可复现字段：环境（node 版本/时间）与沙盒路径不进摘要 */
      const payloadForDigest = {
        case: { id: testCase.id, turns: testCase.turns.length },
        kernel: { ref, version, hash: release.hash, shortHash: release.shortHash },
        engine: { version: ENGINE_VERSION, protocol: ENGINE_META.statePatchProtocol },
        turns,
        summary
      }
      const digest = 'sha256:' + sha256(canonicalJson(payloadForDigest))

      const record = {
        schema: RECORD_SCHEMA,
        mode: 'offline-mock-simulation',
        realPlaytest: false,
        network: 'none',
        disclaimer: DISCLAIMER,
        case: { id: testCase.id, title: testCase.title, turns: testCase.turns.length, expect: testCase.expect.slice() },
        kernel: { ref, refKey, name: release.name, version, hash: release.hash, shortHash: release.shortHash },
        engine: { version: ENGINE_VERSION, statePatchProtocol: ENGINE_META.statePatchProtocol },
        /* 运行环境与时间：明确排除在 digest 之外（可重现摘要只覆盖内容字段） */
        environment: { node: process.version, platform: process.platform, arch: process.arch, createdAt: Date.now() },
        turns,
        summary,
        digest
      }

      const recordFile = path.join(recordsDir, refKey, version, caseId + '-' + digest.slice(7, 19) + '.json')
      atomicWrite(recordFile, JSON.stringify(record, null, 2))
      pruneRecords(path.dirname(recordFile))

      return {
        ok: true,
        digest,
        recordPath: recordFile,
        relativeRecordPath: path.relative(dataRoot, recordFile).split(path.sep).join('/'),
        record,
        /* 沙盒目录在 return 之后（finally 里）即被删除；keepSandbox 时才保留 */
        sandbox: { dir: path.relative(dataRoot, sandboxDir).split(path.sep).join('/'), kept: !!p.keepSandbox, removedAfterRun: !p.keepSandbox },
        kernel_binding: kernelBinding,
        reproducible: true
      }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    } finally {
      /* 沙盒生命周期：无论成功失败都关闭引擎并删除目录（keepSandbox 仅测试/排障用） */
      try { if (engine) engine.close() } catch { /* 忽略 */ }
      const keep = !!(payload && payload.keepSandbox)
      if (sandboxDir && !keep) {
        try { fs.rmSync(sandboxDir, { recursive: true, force: true }) } catch { /* 忽略：残留只占空间 */ }
      }
    }
  }

  function pruneRecords(dir) {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      if (files.length <= maxRecordsPerVersion) return
      const stat = files.map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.m - b.m)
      for (const item of stat.slice(0, files.length - maxRecordsPerVersion)) {
        try { fs.rmSync(path.join(dir, item.f), { force: true }) } catch { /* 忽略 */ }
      }
    } catch { /* 忽略 */ }
  }

  function records(payload) {
    try {
      const p = payload || {}
      const ref = String(p.ref || '').trim()
      if (!ref) return { ok: false, error: '缺少内核 ref' }
      const refKey = refKeyOf(ref)
      const idx = readIndex()
      const entry = idx.kernels[refKey]
      const versions = p.version ? [String(p.version)] : (entry ? entry.versions.map((v) => v.version) : [])
      const out = []
      for (const version of versions) {
        const dir = path.join(recordsDir, refKey, version)
        let files = []
        try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { files = [] }
        for (const f of files) {
          try {
            const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
            out.push({
              file: path.relative(dataRoot, path.join(dir, f)).split(path.sep).join('/'),
              caseId: rec.case && rec.case.id,
              version,
              digest: rec.digest,
              mode: rec.mode,
              realPlaytest: rec.realPlaytest,
              summary: rec.summary,
              createdAt: (rec.environment && rec.environment.createdAt) || null
            })
          } catch { /* 单文件损坏忽略 */ }
        }
      }
      return { ok: true, records: out, mode: 'offline-mock-simulation', disclaimer: DISCLAIMER }
    } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
  }

  /* ---- 真实模型试玩：未获调用授权前一律阻断，不发起任何请求 ---- */
  function realPlaytestStatus() {
    return {
      available: false,
      requiresAuthorization: true,
      network: 'none',
      reason: '真实模型试玩会调用付费端点，必须由使用者在设置中显式授权后单独接入；本工作台不代为发起。'
    }
  }
  function runRealPlaytest() {
    return { ok: false, blocked: true, error: '未获调用授权，已阻止真实模型试玩（本工作台不发起任何网络请求）。', status: realPlaytestStatus() }
  }

  function capabilities() {
    return {
      ok: true,
      mode: 'offline-mock-simulation',
      offlineMock: true,
      realPlaytest: false,
      realPlaytestStatus: realPlaytestStatus(),
      network: 'none',
      dataRoot,
      root,
      cases: CASES.length,
      maxKernelBytes: MAX_KERNEL_BYTES,
      disclaimer: DISCLAIMER
    }
  }

  return {
    dataRoot, root, releasesDir, recordsDir, sandboxRoot,
    publish, list, read, diff, verify, cases, runCase, records,
    realPlaytestStatus, runRealPlaytest, capabilities,
    diffText, refKeyOf, DISCLAIMER, CASES
  }
}

/* 父代理 IPC 接入用的一层薄封装：方法名与渲染层 window.api 一一对应 */
function createKernelWorkbenchHandlers(dataRoot, options) {
  const wb = createKernelWorkbench(Object.assign({}, options || {}, { dataRoot }))
  const channels = {
    kernelWbCapabilities: 'kernel-wb:capabilities',
    kernelWbPublish: 'kernel-wb:publish',
    kernelWbList: 'kernel-wb:list',
    kernelWbRead: 'kernel-wb:read',
    kernelWbDiff: 'kernel-wb:diff',
    kernelWbVerify: 'kernel-wb:verify',
    kernelWbCases: 'kernel-wb:cases',
    kernelWbRun: 'kernel-wb:run',
    kernelWbRecords: 'kernel-wb:records',
    kernelWbRealStatus: 'kernel-wb:real-status'
  }
  const methods = {
    capabilities: () => wb.capabilities(),
    publish: (p) => wb.publish(p),
    list: (p) => wb.list(p),
    read: (p) => wb.read(p),
    diff: (p) => wb.diff(p),
    verify: (p) => wb.verify(p),
    cases: () => wb.cases(),
    run: (p) => wb.runCase(p),
    records: (p) => wb.records(p),
    realPlaytestStatus: () => wb.realPlaytestStatus(),
    runRealPlaytest: () => wb.runRealPlaytest()
  }
  /* 通道 → 处理函数：父代理可 for (const [channel, fn] of Object.entries(wb.ipcHandlers)) safeHandle(channel, fn) */
  const ipcHandlers = {}
  for (const [name, channel] of Object.entries(channels)) {
    const method = name.slice('kernelWb'.length)
    const key = method.charAt(0).toLowerCase() + method.slice(1)
    const fn = methods[key === 'realStatus' ? 'realPlaytestStatus' : key]
    ipcHandlers[channel] = (_evt, payload) => fn(payload)
  }
  return Object.assign({ wb, channels, ipcHandlers }, methods)
}

module.exports = {
  createKernelWorkbench,
  createKernelWorkbenchHandlers,
  /* 命名别名：父代理按「register/createWorkbench(dataRoot)」接入时可直接用 */
  register: createKernelWorkbenchHandlers,
  createWorkbench: createKernelWorkbench,
  diffText,
  refKeyOf,
  canonicalJson,
  sha256,
  CASES,
  DISCLAIMER,
  SCHEMA,
  RECORD_SCHEMA,
  MAX_KERNEL_BYTES
}
