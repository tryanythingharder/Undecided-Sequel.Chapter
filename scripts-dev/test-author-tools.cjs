'use strict'
/* 作者工具（内核不可变版本 / 版本差异 / 独立沙盒试玩 / 可重现测试记录 / 精选内核）单元测试
 * 产物统一落在 workspace/output/author-tools-test（不使用 os.tmpdir）。
 * 覆盖：不可变性、差异算法、沙盒隔离、离线回合不发起模型请求、测试记录与复跑一致性、
 *       正文完整性（不截断）、内核 id 撞名隔离、密钥拒绝、版本/记录裁剪、路径边界、
 *       内核库元数据/预览、结构用例与模型质量验收的口径标注。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createAuthorTools, parseKernelMeta, diffText, SUITE_SCRIPT } = require('../engine/author-tools.cjs')

const repoRoot = path.join(__dirname, '..')
const outputRoot = path.join(repoRoot, 'output', 'author-tools-test')
const dataRoot = path.join(outputRoot, 'profile')
fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(path.join(dataRoot, 'story-engine', 'stories'), { recursive: true })
// 真实世界线样本：任何沙盒/测试写入越界都会让指纹变化
fs.writeFileSync(path.join(dataRoot, 'story-engine', 'stories', 'real-story.json'), JSON.stringify({ story_id: 'real-story', counters: { turn: 12 } }))

const KERNEL_A = '# 测试内核\n\n<!--KERNEL_META {"title":"测试内核","tagline":"单元测试","version":"0.1","license":"MIT","author":"测试","startLabel":"开始"} KERNEL_META-->\n规则一：世界由六面构成。\n规则二：记忆不可篡改。\n'
const KERNEL_B = '# 测试内核\n\n<!--KERNEL_META {"title":"测试内核","tagline":"单元测试","version":"0.2","license":"MIT","author":"测试","startLabel":"开始"} KERNEL_META-->\n规则一：世界由六面构成。\n规则二：记忆不可篡改（修订）。\n规则三：新增条款。\n'

/* 内核库读取桩：复用仓库内置内核文件，验证精选元数据/预览走现有库 */
const kernelSource = {
  list: () => [
    { id: 'builtin:kernel.md', name: 'kernel', source: 'builtin', size: fs.statSync(path.join(repoRoot, 'kernel.md')).size, mtime: 1 },
    { id: 'user:local', name: 'local', source: 'user', size: KERNEL_A.length, mtime: 2 }
  ],
  read: (id) => {
    if (id === 'builtin:kernel.md') return { ok: true, id, name: 'kernel', text: fs.readFileSync(path.join(repoRoot, 'kernel.md'), 'utf8') }
    if (id === 'user:local') return { ok: true, id, name: 'local', text: KERNEL_A }
    return { ok: false, error: '未知内核 id' }
  }
}

const tools = createAuthorTools({ dataRoot, kernelSource })
const hashOf = (text) => require('node:crypto').createHash('sha1').update(text).digest('hex').slice(0, 12)
const realFingerprint = () => JSON.stringify(fs.readdirSync(path.join(dataRoot, 'story-engine', 'stories')).sort())

try {
  // ---------- 1. 不可变版本 ----------
  const first = tools.registerVersion({ kernelId: 'user:local', name: '测试内核', text: KERNEL_A, source: 'desktop' })
  assert.equal(first.created, true)
  assert.equal(first.immutable, true)
  assert.equal(first.version.hash, hashOf(KERNEL_A))
  assert.equal(first.version.version, '0.1', 'KERNEL_META 版本应被解析')
  const filePath = path.join(tools.root, 'versions', 'user-local', hashOf(KERNEL_A) + '.json')
  assert.ok(fs.existsSync(filePath), '版本文件应落盘')
  const bytesBefore = fs.readFileSync(filePath, 'utf8')
  const again = tools.registerVersion({ kernelId: 'user:local', name: '测试内核', text: KERNEL_A, source: 'desktop' })
  assert.equal(again.created, false, '同内容重复登记不得改写版本文件')
  assert.equal(again.version.hash, hashOf(KERNEL_A))
  assert.equal(fs.readFileSync(filePath, 'utf8'), bytesBefore, '不可变：重复登记后文件字节不变')

  const second = tools.registerVersion({ kernelId: 'user:local', name: '测试内核', text: KERNEL_B, source: 'desktop' })
  assert.equal(second.version.version, '0.2')
  const list = tools.listVersions({ kernelId: 'user:local' })
  assert.equal(list.length, 2)
  assert.deepEqual(list.map((item) => item.hash).sort(), [first.version.hash, second.version.hash].sort())

  // 外部改写检测 + 冲突拒绝
  fs.writeFileSync(filePath, fs.readFileSync(filePath, 'utf8').replace('规则一：世界由六面构成。', '规则一：已被外部改写。'))
  assert.equal(tools.readVersion({ kernelId: 'user:local', hash: first.version.hash }).intact, false, '内容被改写应能被识别')
  assert.throws(() => tools.registerVersion({ kernelId: 'user:local', name: '测试内核', text: KERNEL_A }), /hash 冲突|不一致/)
  fs.rmSync(filePath)
  assert.throws(() => tools.readVersion({ kernelId: 'user:local', hash: first.version.hash }), /不存在/)
  tools.registerVersion({ kernelId: 'user:local', name: '测试内核', text: KERNEL_A })

  // ---------- 2. 版本差异 ----------
  const diff = tools.diffVersions({ kernelId: 'user:local', from: first.version.hash, to: second.version.hash })
  assert.equal(diff.same, false)
  // 变化行：KERNEL_META（版本 0.1→0.2）、规则二修订、新增规则三 → 增 3 删 2
  assert.equal(diff.stats.added, 3)
  assert.equal(diff.stats.removed, 2)
  assert.ok(diff.stats.unchanged >= 3)
  const rows = diff.hunks.flatMap((hunk) => hunk.rows)
  assert.ok(rows.some((row) => row.type === 'del' && row.text.includes('规则二：记忆不可篡改。')))
  assert.ok(rows.some((row) => row.type === 'add' && row.text.includes('规则三：新增条款。')))
  assert.equal(tools.diffVersions({ kernelId: 'user:local', from: first.version.hash, to: first.version.hash }).same, true)
  const direct = diffText('a\nb\nc', 'a\nB\nc')
  assert.deepEqual(direct.stats, { added: 1, removed: 1, unchanged: 2 })

  // ---------- 3. 沙盒试玩（离线回合不发起模型请求） ----------
  const before = realFingerprint()
  const sandbox = tools.createSandbox({ kernelId: 'user:local', text: KERNEL_A, label: '单元测试沙盒' })
  assert.ok(sandbox.sandboxId.startsWith('SBX-'))
  assert.equal(sandbox.kernelHash, hashOf(KERNEL_A))
  assert.equal(sandbox.kernelMatch, true)
  assert.equal(sandbox.kernelVersion, 'sha1:' + hashOf(KERNEL_A), '沙盒故事须绑定内核 hash 版本')
  assert.ok(path.resolve(dataRoot, sandbox.path).startsWith(path.resolve(tools.root, 'sandbox') + path.sep), '沙盒必须落在独立目录')
  const context = tools.sandboxContext({ sandboxId: sandbox.sandboxId, input: '观察四周' })
  assert.equal(context.storyId, sandbox.storyId)
  assert.ok(context.block.length > 0, '沙盒上下文块应可构建（供真实试玩使用）')
  assert.ok(context.overview, '沙盒上下文应附带状态概览')
  const turn1 = tools.sandboxTurn({ sandboxId: sandbox.sandboxId, input: '我在沙盒里观察四周' })
  assert.equal(turn1.mock, true)
  assert.equal(turn1.committed, true)
  assert.equal(turn1.turn, 1)
  assert.ok(turn1.overview, '沙盒回合应返回状态概览')
  // 口径标注：离线回合不经过任何模型，不得被当作模型质量验收
  assert.equal(turn1.scope, 'offline-deterministic')
  assert.equal(turn1.modelInvolved, false)
  // 沙盒世界线落盘在独立引擎目录（不写真实 story-engine）
  const sandboxStoryDir = path.join(tools.root, 'sandbox', sandbox.sandboxId, 'engine', 'stories')
  assert.ok(fs.readdirSync(sandboxStoryDir).some((file) => file.endsWith('.json')), '沙盒回合应写入沙盒自己的故事文件')
  const turn2 = tools.sandboxTurn({ sandboxId: sandbox.sandboxId, input: '继续前进', raw: '<<<STATE_PATCH>>>' + JSON.stringify({ turn_summary: '显式 raw 回合', events: [{ type: 'action', description: '前进' }] }) + '<<<END_PATCH>>>' })
  assert.equal(turn2.mock, false, '传入 raw 时按调用方提供的模型输出提交')
  assert.equal(turn2.modelInvolved, true, '传入 raw 表示由调用方提供的模型输出')
  assert.equal(turn2.turn, 2)
  assert.deepEqual(realFingerprint(), before, '沙盒试玩不得触碰真实世界线目录')
  assert.equal(tools.listSandboxes().length, 1)
  const closed = tools.closeSandbox({ sandboxId: sandbox.sandboxId })
  assert.equal(closed.removed, true)
  assert.equal(fs.existsSync(path.join(tools.root, 'sandbox', sandbox.sandboxId)), false, '结束沙盒应清理独立目录')

  // ---------- 3b. 沙盒世界线缺失：给可读错误，不抛 TypeError ----------
  const orphan = tools.createSandbox({ kernelId: 'user:local', text: KERNEL_A, label: '世界线缺失' })
  tools.closeSandbox({ sandboxId: orphan.sandboxId, keep: true }) // 关引擎句柄，保留目录
  for (const file of fs.readdirSync(path.join(tools.root, 'sandbox', orphan.sandboxId, 'engine', 'stories'))) {
    fs.rmSync(path.join(tools.root, 'sandbox', orphan.sandboxId, 'engine', 'stories', file), { force: true })
  }
  assert.throws(() => tools.sandboxTurn({ sandboxId: orphan.sandboxId, input: 'x' }), /世界线不存在/)
  tools.closeSandbox({ sandboxId: orphan.sandboxId })

  // ---------- 4. 可重现测试记录 ----------
  const record = tools.runSuite({ kernelId: 'user:local', name: '测试内核', text: KERNEL_A })
  assert.equal(record.kind, 'author-suite')
  assert.equal(record.kernel.hash, hashOf(KERNEL_A))
  assert.equal(record.script.hash, hashOf(JSON.stringify(SUITE_SCRIPT)))
  assert.equal(record.engine.version, require('../engine/index').ENGINE_VERSION)
  assert.equal(record.ok, true, '测试记录应全部通过：' + JSON.stringify(record.cases.filter((c) => !c.ok)))
  assert.deepEqual(record.cases.map((item) => item.id), [
    'open', 'no-change', 'conflict-rollback', 'disk-failure-rollback',
    'restore', 'restart-persistence', 'kernel-binding', 'isolation'
  ])
  assert.deepEqual(record.script.inputs, SUITE_SCRIPT.map((item) => item.id))
  const recordFile = path.join(tools.root, 'records', record.recordId + '.json')
  assert.ok(fs.existsSync(recordFile), '测试记录应落盘到 workspace/output')
  assert.ok(fs.readFileSync(recordFile, 'utf8').includes(hashOf(KERNEL_A)), '记录须包含内核 hash')
  assert.equal(tools.listRecords({ kernelId: 'user:local' })[0].recordId, record.recordId)
  // 口径标注：结构用例必须显式声明「不涉及模型」，避免被当成模型试玩质量验收
  assert.equal(record.scope, 'engine-contract')
  assert.equal(record.modelInvolved, false)
  assert.match(record.scopeNote, /不调用任何模型/)
  assert.equal(tools.listRecords({ kernelId: 'user:local' })[0].modelInvolved, false)
  assert.match(tools.listRecords({ kernelId: 'user:local' })[0].scopeNote, /不代表模型叙事质量/)
  const replay = tools.replayRecord({ recordId: record.recordId })
  assert.equal(replay.reproduced, true, '同内核同脚本复跑必须逐用例一致')
  assert.equal(replay.rows.length, record.cases.length)
  assert.deepEqual(realFingerprint(), before, '测试执行不得触碰真实世界线目录')

  // UI 直接测试未登记草稿后，仅传 recordId 复跑：输入必须独立落盘，重开服务仍可取回。
  const draftId = 'user:unregistered-draft'
  assert.equal(tools.listVersions({ kernelId: draftId }).length, 0)
  const draftRecord = tools.runSuite({ kernelId: draftId, text: KERNEL_B })
  assert.equal(tools.readVersion({ kernelId: draftId, hash: draftRecord.kernel.hash }).text, KERNEL_B)
  const reopened = createAuthorTools({ dataRoot, kernelSource })
  try {
    assert.equal(reopened.replayRecord({ recordId: draftRecord.recordId }).reproduced, true, '未登记草稿重启后仅凭记录复跑')
    assert.equal(reopened.replayRecord({ recordId: draftRecord.recordId, text: KERNEL_A }).reproduced, false, '换内核即使用例相同也不算复现')
  } finally { reopened.closeAll() }

  // ---------- 4b. 记录裁剪：超过上限时按时间裁掉最旧的（listRecords 截断不影响裁剪） ----------
  const recordDir = path.join(tools.root, 'records')
  for (let i = 1; i <= 85; i++) {
    fs.writeFileSync(path.join(recordDir, 'ATR-fake-' + String(i).padStart(4, '0') + '.json'), JSON.stringify({
      recordId: 'ATR-fake-' + String(i).padStart(4, '0'), kind: 'author-suite',
      kernel: { id: 'user:local', hash: hashOf(KERNEL_A), name: '测试内核' },
      engine: { version: 'x', name: 'x', protocol: 2 }, script: { hash: 'x', inputs: [], cases: [] },
      startedAt: 1000 + i, durationMs: 1, ok: true, cases: []
    }))
  }
  tools.runSuite({ kernelId: 'user:local', name: '测试内核', text: KERNEL_A })
  const keptRecords = fs.readdirSync(recordDir).filter((file) => file.endsWith('.json'))
  assert.equal(keptRecords.length, 80, '记录数须被裁剪到上限（裁剪不能因列表截断而失效）')
  assert.equal(keptRecords.includes('ATR-fake-0001.json'), false, '最旧记录应被裁掉')
  assert.equal(tools.listRecords().length, 80)

  // ---------- 4c. 内核正文完整性：大内核不得被截断（截断会让 hash 校验失去意义） ----------
  const bigKernel = '# 大内核\n' + '填充行内容abcdefghij\n'.repeat(20000)
  const bigVersion = tools.registerVersion({ kernelId: 'user:local', name: '大内核', text: bigKernel })
  assert.equal(bigVersion.version.bytes, Buffer.byteLength(bigKernel))
  const bigRead = tools.readVersion({ kernelId: 'user:local', hash: bigVersion.version.hash })
  assert.equal(bigRead.text, bigKernel, '登记的正文必须逐字节取回')
  assert.equal(bigRead.intact, true, '大内核的 hash 校验必须通过')
  const bigStored = fs.readFileSync(path.join(tools.root, 'versions', 'user-local', bigVersion.version.hash + '.json'), 'utf8')
  assert.ok(bigStored.length > bigKernel.length, '落盘文件不得短于正文（旧实现按 400k 字符截断）')
  assert.ok(bigStored.includes('填充行内容abcdefghij'), '落盘正文须完整保留')

  // ---------- 4d. 内核 id 撞名隔离：目录 slug 相同也不得互相串味 ----------
  const dotted = tools.registerVersion({ kernelId: 'user:a.b', name: '点号内核', text: '# 点号\n内容 A\n' })
  const dashed = tools.registerVersion({ kernelId: 'user:a-b', name: '短横内核', text: '# 短横\n内容 B\n' })
  // 两个 id 归一化到同一目录（user-a-b），但列举/读取必须按 kernelId 精确归属
  assert.equal(fs.readdirSync(path.join(tools.root, 'versions', 'user-a-b')).length >= 2, true)
  assert.deepEqual(tools.listVersions({ kernelId: 'user:a.b' }).map((item) => item.kernelId), ['user:a.b'])
  assert.deepEqual(tools.listVersions({ kernelId: 'user:a-b' }).map((item) => item.kernelId), ['user:a-b'])
  assert.equal(tools.readVersion({ kernelId: 'user:a.b', hash: dotted.version.hash }).text.includes('内容 A'), true)
  assert.equal(tools.readVersion({ kernelId: 'user:a-b', hash: dashed.version.hash }).text.includes('内容 B'), true)
  // 跨内核读同 hash：不得借道读到别人的版本
  assert.throws(() => tools.readVersion({ kernelId: 'user:a-b', hash: dotted.version.hash }), /不存在/)
  // 同正文登记到另一个 id：必须各自成档（不得复用别人的文件返回别人的 kernelId）
  const cloned = tools.registerVersion({ kernelId: 'user:a-b', name: '短横内核', text: '# 点号\n内容 A\n' })
  assert.equal(cloned.created, true)
  assert.equal(cloned.version.kernelId, 'user:a-b')
  assert.equal(tools.readVersion({ kernelId: 'user:a.b', hash: dotted.version.hash }).intact, true, '撞名写入不得破坏原内核版本')

  // ---------- 4e. 密钥：拒绝登记（正文按原文不可变保存，不做静默改写/截断） ----------
  assert.throws(() => tools.registerVersion({ kernelId: 'user:local', name: '含密钥内核', text: KERNEL_A + '\napiKey: sk-abcdefghijklmnop123456\n' }), /密钥/)
  assert.throws(() => tools.registerVersion({ kernelId: 'user:local', name: '含密钥内核', text: KERNEL_A + '\nAuthorization: Bearer abcdefghijklmnopqrst\n' }), /密钥/)
  assert.throws(() => tools.createSandbox({ kernelId: 'user:local', text: KERNEL_A + '\ntoken: sk-abcdefghijklmnop123456\n' }), /密钥/)
  assert.equal(tools.listVersions({ kernelId: 'user:local' }).some((item) => item.name === '含密钥内核'), false)

  // ---------- 4f. 元数据/记录仍脱敏（正文之外的诊断产物） ----------
  const sandbox3 = tools.createSandbox({ kernelId: 'user:local', text: KERNEL_A, label: '脱敏检查' })
  const metaRaw = fs.readFileSync(path.join(tools.root, 'sandbox', sandbox3.sandboxId, 'meta.json'), 'utf8')
  /* 与模块 SECRET_TEXT_SOURCE 同形：\b 前缀是必须的，否则 disk-failure-rollback 这类
   * 用例 id 会被误判成 sk- 密钥串 */
  const SECRET_LIKE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b|Bearer\s+[A-Za-z0-9._-]{12,}/
  assert.ok(!SECRET_LIKE.test(metaRaw), '沙盒元数据不得含明文密钥')
  tools.closeSandbox({ sandboxId: sandbox3.sandboxId })
  const recordRaw = fs.readFileSync(recordFile, 'utf8')
  assert.ok(!SECRET_LIKE.test(recordRaw), '测试记录不得含明文密钥')

  // ---------- 5. 沙盒元数据（meta.json）故障注入：引擎是权威，不得报成完全失败 ----------
  /* 局部故障注入只包住一次 fs.writeFileSync 调用（atomicWriteJson 的唯一落盘入口），
   * 无论断言是否失败都在 finally 还原，避免污染后续用例。
   * 匹配必须限定「沙盒目录直接子文件 meta.json」：引擎自身的 stories/<id>.meta.json 侧车
   * 先在 engine/tmp/<name>.meta.json.<ms>.tmp 暂存，若只匹配 /meta\.json\.\d+\.tmp$/ 会被
   * 引擎内部先命中，注入点就不是沙盒 meta 了（表现为「没有抛错」）。 */
  const sandboxTmpMatch = (file) => /[\\/]author-tools[\\/]sandbox[\\/][^\\/]+[\\/]meta\.json\.\d+\.tmp$/.test(file)
  const withWriteFailure = (match, run) => {
    const realWrite = fs.writeFileSync
    let armed = true
    fs.writeFileSync = (file, ...rest) => {
      if (armed && match(String(file))) { armed = false; throw new Error('simulated meta write failure') }
      return realWrite(file, ...rest)
    }
    try { return run() } finally { fs.writeFileSync = realWrite }
  }
  const sandboxDirOf = (sandboxId) => path.join(tools.root, 'sandbox', sandboxId)
  const readMeta = (sandboxId) => JSON.parse(fs.readFileSync(path.join(sandboxDirOf(sandboxId), 'meta.json'), 'utf8'))
  const storyTurnOf = (sandboxId, storyId) => JSON.parse(fs.readFileSync(path.join(sandboxDirOf(sandboxId), 'engine', 'stories', storyId + '.json'), 'utf8')).counters.turn

  // 5a. 初次 meta 写失败：必须整体失败，且不留半个沙盒（残留目录没有 meta.json，既不可列举也清不掉）
  const beforeInitFail = fs.readdirSync(path.join(tools.root, 'sandbox'))
  assert.throws(() => withWriteFailure(
    sandboxTmpMatch,
    () => tools.createSandbox({ kernelId: 'user:local', text: KERNEL_A, label: '初写失败沙盒' })
  ), /simulated meta write failure/)
  const afterInitFail = fs.readdirSync(path.join(tools.root, 'sandbox'))
  assert.deepEqual(afterInitFail.sort(), beforeInitFail.sort(), '创建失败不得留下残留目录（目录无 meta 即不可列举/不可清理）')
  assert.equal(tools.listSandboxes().some((item) => item.label === '初写失败沙盒'), false)

  // 5b. 提交后 meta 写失败：引擎已推进 → 必须返回正常提交结果 + 显式 metadataSaved:false + 受控告警
  const metaFail = tools.createSandbox({ kernelId: 'user:local', text: KERNEL_A, label: '提交后元数据失败' })
  const failTurn = withWriteFailure(
    sandboxTmpMatch,
    () => tools.sandboxTurn({ sandboxId: metaFail.sandboxId, input: '元数据写失败探针' })
  )
  assert.equal(failTurn.committed, true, '引擎已提交即视为回合成立，不得因 meta 写失败报失败')
  assert.equal(failTurn.turn, 1)
  assert.equal(failTurn.metadataSaved, false, 'meta 同步失败须显式标注')
  assert.equal(failTurn.metadataWarningCode, 'SANDBOX_META_SYNC_FAILED')
  const metaWarning = (failTurn.warnings || []).find((item) => item.code === 'SANDBOX_META_SYNC_FAILED')
  assert.ok(metaWarning, '须给出受控 warning code')
  assert.match(metaWarning.message, /同步失败/)
  assert.match(metaWarning.message, /请勿据此重复提交/)
  assert.match(metaWarning.message, /引擎状态为准/)
  assert.equal(/已提交/.test(metaWarning.message), false, 'meta 同步失败不等于回合已提交，文案不得预设提交成功')
  /* 只认「真实路径」形状：Windows 盘符或 POSIX 绝对路径。
   * 不能简单用 / 判断 —— 文案里的「回合数/账本」是中文斜杠连接，不是路径。 */
  assert.equal(/[A-Za-z]:[\\/]|(?:^|[\s（(])[\\/][A-Za-z]/.test(metaWarning.message), false, '告警文案不得回传原始路径')
  assert.equal(metaWarning.message.includes('simulated meta write failure'), false, '告警文案不得回传原始异常串')
  assert.equal(readMeta(metaFail.sandboxId).turns, 0, 'meta 仍是旧值（缓存未同步）')
  assert.equal(storyTurnOf(metaFail.sandboxId, metaFail.storyId), 1, '引擎状态已推进（权威）')

  // 5c. 列表/服务重建：读到引擎权威回合数，不得继续显示旧 turns
  assert.equal(tools.listSandboxes().find((item) => item.sandboxId === metaFail.sandboxId).turns, 1, 'listSandboxes 须以引擎回合数为准')
  /* 真实重启语义：先关掉旧服务的缓存引擎（keep 目录），重建的服务才是在「重启后」从磁盘继续，
   * 否则旧缓存引擎仍持有内存状态，后续用例测的是同一进程续写而不是重启。 */
  tools.closeSandbox({ sandboxId: metaFail.sandboxId, keep: true })
  const rebuilt = createAuthorTools({ dataRoot, kernelSource })
  try {
    assert.equal(rebuilt.listSandboxes().find((item) => item.sandboxId === metaFail.sandboxId).turns, 1, '服务重建后不得回落到过期 meta 回合数')
    assert.equal(rebuilt.sandboxTurn({ sandboxId: metaFail.sandboxId, input: '重启后继续' }).turn, 2, '重启后继续提交须从引擎真实回合继续（不丢回合）')
  } finally { rebuilt.closeAll() }

  // 5d. 继续提交不丢回合：连续两次回合数单调递增，且磁盘引擎与列表一致
  const continued = tools.sandboxTurn({ sandboxId: metaFail.sandboxId, input: '继续前进' })
  assert.equal(continued.committed, true)
  assert.equal(continued.metadataSaved, true, 'meta 恢复正常后须重新同步')
  assert.equal(continued.turn, 3)
  assert.equal(readMeta(metaFail.sandboxId).turns, 3)
  assert.equal(storyTurnOf(metaFail.sandboxId, metaFail.storyId), 3)

  // 5e. meta 同步失败与「是否推进」解耦：显式 NO_STATE_CHANGE 的合法回合 committed=false，但同样需要同步 meta
  const noChangeFail = withWriteFailure(
    sandboxTmpMatch,
    () => tools.sandboxTurn({ sandboxId: metaFail.sandboxId, input: '闲聊', raw: '只是笑笑。\n<<<NO_STATE_CHANGE>>>' })
  )
  assert.equal(noChangeFail.committed, false)
  assert.equal(noChangeFail.patchStatus, 'NO_STATE_CHANGE')
  assert.equal(noChangeFail.metadataSaved, false, '未推进状态的合法回合同样会同步 meta，失败须照实标注')
  const noChangeWarning = (noChangeFail.warnings || []).find((item) => item.code === 'SANDBOX_META_SYNC_FAILED')
  assert.equal(/已提交/.test(noChangeWarning.message), false, '未提交回合的 meta 告警不得说已提交')

  // 沙盒清理放在所有依赖它的用例之后（提前删除会让后续用例自身失败）
  tools.closeSandbox({ sandboxId: metaFail.sandboxId })
  assert.equal(fs.existsSync(sandboxDirOf(metaFail.sandboxId)), false)

  // 5f. text 与 hash 同时传入且不一致：必须拒绝（否则会按 text 静默采用与声明不符的版本）
  /* text 分支先算正文 hash，再与声明 hash 比对，不读已登记文件 —— 因此这里断言的是
   * 「不一致」而不是「不存在」。 */
  const hashSandbox = tools.createSandbox({ kernelId: 'user:local', hash: hashOf(KERNEL_A) })
  assert.equal(hashSandbox.kernelHash, hashOf(KERNEL_A))
  assert.throws(() => tools.createSandbox({ kernelId: 'user:local', hash: hashOf(KERNEL_B), text: KERNEL_A }), /不一致/)
  assert.throws(() => tools.createSandbox({ kernelId: 'user:local', hash: 'not-a-hash', text: KERNEL_A }), /格式不正确/)
  assert.throws(() => tools.createSandbox({ kernelId: 'user:local', hash: 'abcdefabcdef', text: KERNEL_A }), /不一致/)
  tools.closeSandbox({ sandboxId: hashSandbox.sandboxId })

  // 5g. 读取已登记版本要求 intact：文件被外部改写后不得静默开档
  const intactKernel = '# 校验内核\n内容一\n'
  const intactVersion = tools.registerVersion({ kernelId: 'user:intact', name: '校验内核', text: intactKernel })
  const intactFile = path.join(tools.root, 'versions', 'user-intact', intactVersion.version.hash + '.json')
  assert.equal(tools.createSandbox({ kernelId: 'user:intact', hash: intactVersion.version.hash }).kernelHash, intactVersion.version.hash)
  fs.writeFileSync(intactFile, fs.readFileSync(intactFile, 'utf8').replace('内容一', '内容二'))
  assert.throws(() => tools.createSandbox({ kernelId: 'user:intact', hash: intactVersion.version.hash }), /内容校验失败/)
  fs.unlinkSync(intactFile)

  // ---------- 6. 路径边界 ----------
  assert.throws(() => tools.closeSandbox({ sandboxId: '../escape' }), /只能/)
  assert.throws(() => tools.readRecord({ recordId: '../escape' }), /只能/)
  assert.throws(() => tools.registerVersion({ kernelId: 'user:local', text: '   ' }), /不能为空/)

  // ---------- 7. 精选内核元数据 / 预览 ----------
  const curated = tools.curatedList()
  assert.equal(curated.length, 2)
  const builtin = curated.find((item) => item.kernelId === 'builtin:kernel.md')
  assert.ok(builtin.readable, '接入内核库后应可读取')
  assert.equal(builtin.license, 'MIT')
  assert.ok(builtin.recommendedModels.length > 0)
  assert.ok(builtin.genres.length > 0)
  assert.ok(builtin.hash.length === 12)
  const preview = tools.preview({ kernelId: 'builtin:kernel.md' })
  assert.equal(preview.preview.available, true)
  assert.ok(preview.preview.lineCount > 10)
  assert.ok(preview.preview.excerpt.length > 0)
  assert.ok(preview.preview.headings.length > 0, '预览应给出章节标题')
  const localPreview = tools.preview({ kernelId: 'user:local' })
  assert.equal(localPreview.info.registeredVersions >= 2, true)
  assert.ok(localPreview.records.length >= 1, '预览应带出该内核的测试记录')

  // 未接入内核库时退化为内置精选常量（不抛错）
  const bare = createAuthorTools({ dataRoot: path.join(outputRoot, 'bare-profile') })
  const bareCurated = bare.curatedList()
  assert.ok(bareCurated.length >= 1)
  assert.equal(bareCurated[0].readable, false)
  assert.equal(bare.preview({ kernelId: 'builtin:kernel.md' }).preview.available, false)
  bare.closeAll()

  // ---------- 8. KERNEL_META 解析与 HTTP 无关性 ----------
  assert.equal(parseKernelMeta(KERNEL_A).title, '测试内核')
  assert.equal(parseKernelMeta('no meta here'), null)
  const source = fs.readFileSync(path.join(repoRoot, 'engine', 'author-tools.cjs'), 'utf8')
  assert.ok(!/require\('node:http|require\('https|require\('node:net/.test(source), '作者工具自身不得持有网络客户端')
  assert.ok(!/fetch\(/.test(source), '作者工具自身不得发起网络请求')

  tools.closeAll()
  console.log('PASS author-tools: immutable versions, diff, sandbox isolation, reproducible record, verbatim text, id-collision isolation, secret rejection, pruning, path boundary, curated preview')
} finally {
  tools.closeAll()
  fs.rmSync(outputRoot, { recursive: true, force: true })
}
