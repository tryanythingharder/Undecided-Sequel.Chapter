// 进度包导入规划器单元测试（纯内存，无网络、无 Electron、无落盘）。
// 覆盖：包级防线（type/v/字段/路径白名单/规范化重复/大小/JSON/schema 兼容）、
// 冲突决策（默认 keep / replace / branch 重写归属 id 与路径、正文不动）、
// 工作区同名内核不同 → 独立工作区（本机不被静默换核）、未声明 owner 跳过、
// 缺失记忆 → replacedIds（不继承本机未来记忆）、超限预览放行 + keep 选项。
const assert = require('node:assert/strict')
const { createStory } = require('../engine/schema')
const { LIMITS, validateBundle, planProgress, planProgressBundle, validateRelativePath, fileOwner } = require('../engine/progress-import.cjs')

const hasKernel = (id) => id === 'builtin:kernel.md'
const story = (id, turn, extra) => Object.assign(createStory({ storyId: id, title: '故事' + id, kernelId: 'builtin:kernel.md', kernelVersion: 'sha1:x', createdAt: 1 }), { counters: Object.assign(createStory({ storyId: id, title: '', kernelId: 'k', kernelVersion: 'v', createdAt: 1 }).counters, { turn }) }, extra || {})
const sess = (id, ws, updatedAt, messages) => ({ id, ws, title: '线' + id, createdAt: 1, updatedAt, messages: messages || [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] })
const file = (obj) => JSON.stringify(obj)

let checked = 0
const ok = (name, fn) => { fn(); checked++; console.log('PASS  ' + name) }
const throws = (name, fn, re) => { assert.throws(fn, re); checked++; console.log('PASS  ' + name) }

const bundle = (over) => Object.assign({
  type: 'sixworlds-progress', v: 1, exportedAt: 10, world: { id: 'ws-1' },
  workspaces: [{ id: 'ws-1', name: '默认世界', createdAt: 1, kernelId: 'builtin:kernel.md' }],
  sessions: [sess('s1', 'ws-1', 2000)],
  engine: { files: { 'stories/s1.json': file(story('s1', 3)), 'stories/s1.meta.json': file({ story_id: 's1', title: '线s1' }) } }
}, over || {})

// ---- 1. 路径白名单与文件类型 ----
ok('path-whitelist-accepts-declared-shapes', () => {
  for (const rel of ['stories/s1.json', 'stories/s1.meta.json', 'snapshots/s1/SNP-000001.json', 'logs/s1/turn-TRN-000001.json', 'pendings/s1.PC-000001.json']) {
    assert.equal(validateRelativePath(rel).rel, rel)
  }
  assert.equal(fileOwner('snapshots/s1/SNP-1.json'), 's1')
  assert.equal(fileOwner('stories/s1.meta.json'), 's1')
})
for (const [name, rel, re] of [
  ['reject-absolute-path', '/etc/passwd.json', /绝对路径/],
  ['reject-drive-path', 'C:/x/stories/s1.json', /绝对路径/],
  ['reject-traversal', 'stories/../../evil.json', /非法片段|层级不正确/],
  ['reject-illegal-segment', 'stories/s 1.json', /非法片段/],
  ['reject-illegal-owner-id', 'stories/..json.json', /所属世界线非法/],
  ['reject-non-whitelisted-root', 'tmp/x.json', /不支持的引擎文件目录/],
  ['reject-memory-db-path', 'memory.db/x.json', /不支持的引擎文件目录/],
  ['reject-bad-extension', 'stories/x.exe', /不支持的引擎文件类型/],
  ['reject-depth', 'snapshots/s1/a/b.json', /目录层级不正确/],
  ['reject-stories-depth', 'stories/s1/x.json', /目录层级不正确/]
]) throws(name, () => validateRelativePath(rel), re)

// ---- 2. 包级防线 ----
throws('reject-wrong-type', () => validateBundle(bundle({ type: 'nope' })), /不是有效的进度包/)
throws('reject-unsupported-version', () => validateBundle(bundle({ v: 2 })), /版本不支持/)
throws('reject-bad-workspaces', () => validateBundle(bundle({ workspaces: 'x' })), /工作区数据不正确/)
throws('reject-duplicate-workspace', () => validateBundle(bundle({ workspaces: [{ id: 'ws-1', name: 'a' }, { id: 'ws-1', name: 'b' }] })), /工作区数据重复/)
throws('reject-bad-sessions', () => validateBundle(bundle({ sessions: 'x' })), /世界线数据不正确/)
throws('reject-duplicate-session-id', () => validateBundle(bundle({ sessions: [sess('s1', 'ws-1', 1), sess('s1', 'ws-1', 2)] })), /非法或重复/)
throws('reject-bad-message', () => validateBundle(bundle({ sessions: [sess('s1', 'ws-1', 1, [{ role: 'system', content: 'x' }])] })), /消息格式不正确/)
throws('reject-non-json-file', () => validateBundle(bundle({ engine: { files: { 'stories/s1.json': '{oops' } } })), /不是合法 JSON/)
throws('reject-duplicate-normalized-path', () => validateBundle(bundle({ engine: { files: { 'stories/s1.json': file(story('s1', 1)), 'stories/S1.json': file(story('s1', 1)) } } })), /路径重复/)
ok('incompatible-story-schema-skipped-and-reported', () => {
  const b = bundle({ engine: { files: { 'stories/s1.json': file({ story_id: 's1', schema_version: 1, counters: { turn: 0 } }), 'stories/s1.meta.json': file({ story_id: 's1' }) } } })
  const v = validateBundle(b)
  assert.deepEqual(v.entries.map((e) => e.relative), ['stories/s1.meta.json'])
  assert.equal(v.skippedFiles.length, 1)
  assert.equal(v.skippedFiles[0].relative, 'stories/s1.json')
  assert.ok(v.warnings.some((w) => /结构不兼容/.test(w)))
})
throws('incompatible-story-schema-strict-rejected', () => validateBundle(bundle({ engine: { files: { 'stories/s1.json': file({ story_id: 's1', schema_version: 1, counters: { turn: 0 } }) } } }), { strict: true }), /记忆结构不正确/)
ok('incompatible-story-skips-its-sidecars', () => {
  const s = story('s1', 2)
  const p = planProgress({
    bundle: bundle({ engine: { files: {
      'stories/s1.json': file({ story_id: 's1', schema_version: 9 }),
      'snapshots/s1/SNP-000001.json': file({ snapshot_id: 'SNP-000001', story_id: 's1', state: s }),
      'pendings/s1.PC-000001.json': file({ pending_id: 'PC-000001', story_id: 's1' })
    } } }),
    currentSessions: [], currentWorkspaces: [], hasKernel
  })
  assert.equal(p.writes.length, 0)
  assert.equal(p.rows[0].missingMemory, true)
  assert.deepEqual(p.skipped.map((x) => x.reason).sort(), ['story-incompatible', 'story-incompatible', 'structure'])
})
throws('reject-cross-story-memory', () => {
  const s = story('s1', 1); s.facts.push({ fact_id: 'FAC-000001', story_id: 's2', statement: 'x' })
  validateBundle(bundle({ engine: { files: { 'stories/s1.json': file(s) } } }))
}, /跨世界线记忆/)
throws('reject-owner-mismatch', () => validateBundle(bundle({ engine: { files: { 'stories/s1.json': file(story('s2', 1)) } } })), /归属不一致|记忆结构不正确/)
throws('reject-snapshot-id-mismatch', () => validateBundle(bundle({ engine: { files: { 'snapshots/s1/SNP-000002.json': file({ snapshot_id: 'SNP-000001', story_id: 's1', state: story('s1', 1) }) } } })), /快照编号与文件名不一致/)
throws('reject-pending-id-mismatch', () => validateBundle(bundle({ engine: { files: { 'pendings/s1.PC-000002.json': file({ story_id: 's1', pending_id: 'PC-000001' }) } } })), /待补录编号与文件名不一致/)
throws('reject-file-too-large', () => validateBundle(bundle({ engine: { files: { 'stories/s1.json': file(story('s1', 1)) } } }), { limits: { maxFileBytes: 10 } }), /引擎文件过大/)
throws('reject-session-over-limit', () => validateBundle(bundle({ sessions: [sess('s1', 'ws-1', 1), sess('s2', 'ws-1', 1)] }), { limits: { maxSessions: 1 } }), /数量超过上限/)

ok('legacy-memory-db-skipped-not-fatal', () => {
  const v = validateBundle(bundle({ engine: { files: Object.assign({}, bundle().engine.files, { 'memory.db': 'legacy-bytes', 'memory.db-wal': 'x' }) } }))
  assert.equal(v.entries.length, 2)
  assert.deepEqual(v.entries.map((e) => e.relative).sort(), ['stories/s1.json', 'stories/s1.meta.json'])
  assert.ok(v.warnings.filter((w) => /已跳过旧包派生文件/.test(w)).length === 2)
})
ok('preview-allows-session-over-limit', () => {
  const v = validateBundle(bundle({ sessions: [sess('s1', 'ws-1', 1), sess('s2', 'ws-1', 1)] }), { preview: true, limits: { maxSessions: 1 } })
  assert.equal(v.sessions.length, 2)
})

// ---- 3. 冲突决策 ----
const local = (over) => Object.assign({ sessions: [sess('s1', 'ws-1', 1000, [{ role: 'user', content: 'old' }])], workspaces: [{ id: 'ws-1', name: '默认世界', createdAt: 1, kernelId: 'builtin:kernel.md' }] }, over || {})

ok('default-keeps-local', () => {
  const p = planProgress({ bundle: bundle(), currentSessions: local().sessions, currentWorkspaces: local().workspaces, hasKernel })
  assert.equal(p.rows[0].decision, 'keep')
  assert.equal(p.sessions.length, 1)
  assert.equal(p.sessions[0].messages[0].content, 'old')
  assert.equal(p.writes.length, 0)
  assert.equal(p.replacedIds.length, 0)
  assert.equal(p.workspaces.length, 1)
})
ok('conflict-default-newer-selects-import', () => {
  const p = planProgress({ bundle: bundle(), currentSessions: local().sessions, currentWorkspaces: local().workspaces, hasKernel, conflictDefault: 'newer' })
  assert.equal(p.rows[0].decision, 'replace')
  assert.equal(p.sessions[0].messages.length, 2)
  assert.equal(p.sessions[0].messages[1].content, 'yo')
})
ok('legacy-direct-import-default-keep-ignores-older-bundle', () => {
  const p = planProgress({ bundle: bundle({ sessions: [sess('s1', 'ws-1', 500)] }), currentSessions: local().sessions, currentWorkspaces: local().workspaces, hasKernel, conflictDefault: 'newer' })
  assert.equal(p.rows[0].decision, 'keep')
})
ok('legacy-flag-selects-newer-for-choiceless-import', () => {
  const p = planProgress({ bundle: bundle(), currentSessions: local().sessions, currentWorkspaces: local().workspaces, hasKernel, legacy: true })
  assert.equal(p.rows[0].decision, 'replace')
  const kept = planProgress({ bundle: bundle({ sessions: [sess('s1', 'ws-1', 500)] }), currentSessions: local().sessions, currentWorkspaces: local().workspaces, hasKernel, legacy: true })
  assert.equal(kept.rows[0].decision, 'keep')
})
throws('reject-bad-choice', () => planProgress({ bundle: bundle(), currentSessions: [], currentWorkspaces: [], choices: { s1: 'nuke' }, hasKernel }), /处理方式不正确/)

ok('replace-writes-declared-files-only', () => {
  const p = planProgress({ bundle: bundle(), currentSessions: local().sessions, currentWorkspaces: local().workspaces, choices: { s1: 'replace' }, hasKernel })
  assert.equal(p.rows[0].decision, 'replace')
  assert.deepEqual(p.writes.map((w) => w.relative).sort(), ['stories/s1.json', 'stories/s1.meta.json'])
  assert.equal(p.replacedIds.includes('s1'), true) // 本机已有该世界线状态 → 需清理旧记忆
  assert.equal(p.sessions[0].messages.length, 2)
})
ok('replace-does-not-touch-input-bundle', () => {
  const b = bundle()
  const before = JSON.stringify(b)
  planProgress({ bundle: b, currentSessions: local().sessions, currentWorkspaces: local().workspaces, choices: { s1: 'replace' }, hasKernel })
  assert.equal(JSON.stringify(b), before)
})
ok('branch-rewrites-owner-and-paths-without-touching-prose', () => {
  const narrative = '薇拉在旧桥救了我一命，这一句正文必须逐字保留。'
  const s = story('s1', 7)
  s.sessions.push({ session_id: 'SES-old', story_id: 's1', status: 'ACTIVE' })
  s.facts.push({ fact_id: 'FAC-000001', story_id: 's1', statement: narrative })
  s.counters.snapshot = 1
  const b = bundle({
    engine: { files: {
      'stories/s1.json': file(s),
      'stories/s1.meta.json': file({ story_id: 's1', title: '线s1' }),
      'snapshots/s1/SNP-000001.json': file({ snapshot_id: 'SNP-000001', story_id: 's1', label: 'x', turn: 7, created_at: 1, state: Object.assign(story('s1', 7), { facts: [{ fact_id: 'FAC-000001', story_id: 's1', statement: narrative }] }) }),
      'pendings/s1.PC-000001.json': file({ pending_id: 'PC-000001', story_id: 's1', session_id: 'SES-old', narrative, status: 'PENDING_COMMIT' })
    } }
  })
  const p = planProgress({
    bundle: b, currentSessions: local().sessions, currentWorkspaces: local().workspaces, choices: { s1: 'branch' }, hasKernel,
    sessionIdMap: { 'SES-old': 'SES-new' }, newId: () => 's1-branch-1', now: 12345
  })
  assert.equal(p.rows[0].decision, 'branch')
  assert.equal(p.sessions[0].id, 's1-branch-1')
  assert.equal(p.sessions[0].ifFrom, 's1')
  assert.match(p.sessions[0].title, /^导入分支 · /)
  const rels = p.writes.map((w) => w.relative).sort()
  assert.deepEqual(rels, ['pendings/s1-branch-1.PC-000001.json', 'snapshots/s1-branch-1/SNP-000001.json', 'stories/s1-branch-1.json', 'stories/s1-branch-1.meta.json'])
  const storyWrite = p.writes.find((w) => w.relative === 'stories/s1-branch-1.json')
  const parsed = JSON.parse(storyWrite.content)
  assert.equal(parsed.story_id, 's1-branch-1')
  assert.equal(parsed.facts[0].story_id, 's1-branch-1')
  assert.equal(parsed.facts[0].statement, narrative)
  assert.equal(parsed.sessions[0].session_id, 'SES-new')
  const snap = JSON.parse(p.writes.find((w) => w.kind === 'snapshot').content)
  assert.equal(snap.story_id, 's1-branch-1')
  assert.equal(snap.state.story_id, 's1-branch-1')
  assert.equal(snap.state.facts[0].statement, narrative)
  assert.equal(snap.snapshot_id, 'SNP-000001')
  const pend = JSON.parse(p.writes.find((w) => w.kind === 'pending').content)
  assert.equal(pend.story_id, 's1-branch-1')
  assert.equal(pend.session_id, 'SES-new')
  assert.equal(pend.narrative, narrative)
  assert.equal(p.sessions[0].messages.some((m) => m.engineSnapshot), false)
})

// ---- 4. 工作区：同名不同内核 → 独立工作区，本机一字不改 ----
ok('workspace-same-id-different-kernel-gets-independent-line', () => {
  const localSpaces = [{ id: 'ws-1', name: '默认世界', createdAt: 1, kernelId: 'builtin:kernel-xianxia.md' }]
  const b = bundle()
  const before = JSON.stringify(localSpaces)
  const p = planProgress({ bundle: b, currentSessions: [], currentWorkspaces: localSpaces, hasKernel, newId: () => 'ws-import-1' })
  assert.equal(JSON.stringify(localSpaces), before) // 本机工作区不被改写（不静默换核）
  assert.equal(p.workspaces.length, 2)
  const added = p.workspaces.find((w) => w.id === 'ws-import-1')
  assert.equal(added.kernelId, 'builtin:kernel.md')
  assert.match(added.name, /^导入 · /)
  assert.equal(p.rows[0].workspaceConflict, true)
  assert.equal(p.sessions[0].ws, 'ws-import-1')
  assert.ok(p.warnings.some((w) => /独立工作区/.test(w)))
})
ok('workspace-same-id-same-kernel-merges-without-new-workspace', () => {
  const p = planProgress({ bundle: bundle(), currentSessions: [], currentWorkspaces: [{ id: 'ws-1', name: '默认世界', createdAt: 1, kernelId: 'builtin:kernel.md' }], hasKernel })
  assert.equal(p.workspaces.length, 1)
  assert.equal(p.rows[0].workspaceConflict, false)
  assert.equal(p.sessions[0].ws, 'ws-1')
})
ok('workspace-local-custom-kernel-path-is-not-replaced', () => {
  const p = planProgress({ bundle: bundle(), currentSessions: [], currentWorkspaces: [{ id: 'ws-1', name: '默认世界', createdAt: 1, kernelPath: 'D:/k.md' }], hasKernel, newId: () => 'ws-import-2' })
  assert.equal(p.workspaces[0].kernelPath, 'D:/k.md')
  assert.equal(p.sessions[0].ws, 'ws-import-2')
})
ok('keep-does-not-add-missing-kernel-workspace', () => {
  const localSpaces = [{ id: 'ws-1', name: '默认世界', createdAt: 1, kernelId: 'builtin:kernel-xianxia.md' }]
  const p = planProgress({ bundle: bundle({ workspaces: [{ id: 'ws-1', name: '默认世界', kernelId: 'user:gone' }] }), currentSessions: local().sessions, currentWorkspaces: localSpaces, choices: { s1: 'keep' }, hasKernel })
  assert.deepEqual(p.workspaces, localSpaces)
  assert.equal(p.sessions[0].messages[0].content, 'old')
  assert.equal(p.rows[0].missingKernel, true)
  assert.equal(p.rows[0].workspaceConflict, false)
  assert.equal(p.writes.length, 0)
})
ok('missing-kernel-warns-but-keeps-line', () => {
  const p = planProgress({ bundle: bundle({ workspaces: [{ id: 'ws-1', name: '默认世界', kernelId: 'user:gone' }] }), currentSessions: [], currentWorkspaces: [], hasKernel })
  assert.equal(p.rows[0].missingKernel, true)
  assert.equal(p.workspaces[0].kernelId, undefined)
  assert.ok(p.warnings.some((w) => /缺少内核/.test(w)))
})
ok('kernel-pinned-in-story-file-is-not-missing', () => {
  const s = story('s1', 2); s.kernel.text = '# pinned'
  const p = planProgress({ bundle: bundle({ workspaces: [{ id: 'ws-1', name: '默认世界', kernelId: 'user:gone' }], engine: { files: { 'stories/s1.json': file(s) } } }), currentSessions: [], currentWorkspaces: [], hasKernel })
  assert.equal(p.rows[0].missingKernel, false)
})

// ---- 5. 未声明 owner / 孤儿遗留文件 ----
ok('undeclared-engine-owner-skipped-and-reported', () => {
  const p = planProgress({
    bundle: bundle({ engine: { files: Object.assign({}, bundle().engine.files, { 'stories/orphan.json': file(story('orphan', 5)), 'snapshots/orphan/SNP-000001.json': file({ snapshot_id: 'SNP-000001', story_id: 'orphan', state: story('orphan', 5) }) }) } }),
    currentSessions: local().sessions, currentWorkspaces: local().workspaces, choices: { s1: 'replace' }, hasKernel
  })
  assert.deepEqual(p.skipped.map((x) => x.relative), ['stories/orphan.json', 'snapshots/orphan/SNP-000001.json'])
  assert.ok(p.skipped.every((x) => x.reason === 'undeclared'))
  assert.equal(p.writes.some((w) => /orphan/.test(w.relative)), false)
  assert.ok(p.warnings.some((w) => /不写入，也不当作记忆/.test(w)))
  assert.equal(p.replacedIds.includes('orphan'), false)
})
ok('undeclared-owner-never-overwrites-local-orphan-memory', () => {
  const p = planProgress({
    bundle: bundle({ engine: { files: { 'stories/ghost.json': file(story('ghost', 5)) } } }),
    currentSessions: [], currentWorkspaces: [], localEngineOwners: ['ghost'], hasKernel
  })
  assert.equal(p.writes.length, 0)
  assert.equal(p.skipped[0].reason, 'undeclared-overwrite')
  assert.ok(p.warnings.some((w) => /本机已有该世界线，绝不覆盖/.test(w)))
})
ok('undeclared-owner-adopted-only-when-explicitly-allowed', () => {
  const p = planProgress({
    bundle: bundle({ engine: { files: { 'stories/ghost.json': file(story('ghost', 5)) } } }),
    currentSessions: [], currentWorkspaces: [], hasKernel, adoptUndeclared: true
  })
  assert.deepEqual(p.writes.map((w) => w.relative), ['stories/ghost.json'])
  assert.ok(p.warnings.some((w) => /按独立世界线写入/.test(w)))
})
ok('branch-does-not-reset-original-local-line', () => {
  const p = planProgress({
    bundle: bundle({ sessions: [sess('s1', 'ws-1', 9000)] }),
    currentSessions: local().sessions, currentWorkspaces: local().workspaces, choices: { s1: 'branch' }, hasKernel, newId: () => 's1-branch'
  })
  assert.deepEqual(p.replacedIds, [])
  assert.deepEqual(p.resetIds, [])
  assert.equal(p.sessions.find((s) => s.id === 's1').messages[0].content, 'old') // 本机原线一字不动
  assert.equal(p.sessions.find((s) => s.id === 's1-branch').messages[0].content, 'hi')
})
ok('orphan-local-engine-files-flagged-for-cleanup', () => {
  const p = planProgress({ bundle: bundle(), currentSessions: local().sessions, currentWorkspaces: local().workspaces, choices: { s1: 'replace' }, hasKernel, localEngineOwners: ['s1', 'ghost'] })
  assert.deepEqual(p.replacedIds, ['s1'])
  assert.deepEqual(p.resetIds, ['s1'])
})

// ---- 6. 缺失记忆 → 不继承本机未来记忆 ----
ok('missing-memory-clears-local-state-and-stale-refs', () => {
  const oldLocal = sess('s1', 'ws-1', 1000, [
    { role: 'user', content: 'old', engineSnapshot: 'SNP-000009' },
    { role: 'assistant', content: 'n', pending: 'PC-000009', engineTurn: 4 }
  ])
  const p = planProgress({
    bundle: bundle({ sessions: [sess('s1', 'ws-1', 9000)], engine: { files: {} } }),
    currentSessions: [oldLocal], currentWorkspaces: local().workspaces, choices: { s1: 'replace' }, hasKernel
  })
  assert.deepEqual(p.replacedIds, ['s1'])
  assert.deepEqual(p.resetIds, ['s1'])
  assert.equal(p.rows[0].missingMemory, true)
  assert.equal(p.writes.length, 0)
  const merged = p.sessions.find((s) => s.id === 's1')
  assert.equal(merged.messages[0].engineSnapshot, undefined)
  assert.equal(merged.messages[1].pending, undefined)
  assert.equal(merged.messages[1].engineTurn, undefined)
  assert.ok(p.warnings.some((w) => /仅含聊天/.test(w)))
})
ok('snapshot-ref-kept-when-snapshot-is-imported', () => {
  const s = story('s1', 4)
  const p = planProgress({
    bundle: bundle({
      sessions: [sess('s1', 'ws-1', 9000, [{ role: 'user', content: 'go', engineSnapshot: 'SNP-000001' }])],
      engine: { files: { 'stories/s1.json': file(s), 'snapshots/s1/SNP-000001.json': file({ snapshot_id: 'SNP-000001', story_id: 's1', state: s }) } }
    }),
    currentSessions: local().sessions, currentWorkspaces: local().workspaces, choices: { s1: 'replace' }, hasKernel
  })
  const merged = p.sessions.find((x) => x.id === 's1')
  assert.equal(merged.messages[0].engineSnapshot, 'SNP-000001')
})
throws('orphan-sidecar-without-story-is-rejected', () => {
  planProgress({
    bundle: bundle({ engine: { files: { 'snapshots/s1/SNP-000001.json': file({ snapshot_id: 'SNP-000001', story_id: 's1', state: story('s1', 1) }) } } }),
    currentSessions: [], currentWorkspaces: [], hasKernel
  })
}, /缺少世界记忆正本/)

// ---- 7. 超限：预览放行 + keep 选项 ----
ok('over-limit-preview-returns-option-not-error', () => {
  const many = []
  for (let i = 0; i < 3; i++) many.push(sess('s' + i, 'ws-1', 1000 + i))
  const b = bundle({ sessions: many, engine: { files: {} } })
  const p = planProgress({ bundle: b, currentSessions: [], currentWorkspaces: [], preview: true, maxSessions: 2, hasKernel })
  assert.deepEqual(p.overLimit, { count: 3, limit: 2, overflow: 1 })
  assert.ok(p.warnings.some((w) => /超过上限/.test(w)))
  assert.equal(p.rows.length, 3)
})
throws('over-limit-apply-rejected', () => {
  const many = [sess('s0', 'ws-1', 1), sess('s1', 'ws-1', 2), sess('s2', 'ws-1', 3)]
  planProgress({ bundle: bundle({ sessions: many, engine: { files: {} } }), currentSessions: [], currentWorkspaces: [], maxSessions: 2, hasKernel })
}, /超过上限/)
ok('over-limit-resolved-by-keeping-local', () => {
  const locals = [sess('s1', 'ws-1', 1000), sess('s2', 'ws-1', 1000)]
  const p = planProgress({ bundle: bundle({ sessions: [sess('s1', 'ws-1', 1), sess('s2', 'ws-1', 2)], engine: { files: {} } }), currentSessions: locals, currentWorkspaces: local().workspaces, choices: { s1: 'keep', s2: 'keep' }, preview: true, maxSessions: 2, hasKernel })
  assert.equal(p.overLimit, null)
  assert.equal(p.sessions.length, 2)
  assert.equal(p.rows.every((r) => r.decision === 'keep'), true)
})
ok('over-limit-branch-still-reports-option', () => {
  const locals = [sess('s1', 'ws-1', 1000), sess('s2', 'ws-1', 1000)]
  const p = planProgress({ bundle: bundle({ sessions: [sess('s1', 'ws-1', 5000)], engine: { files: {} } }), currentSessions: locals, currentWorkspaces: local().workspaces, choices: { s1: 'branch' }, preview: true, maxSessions: 2, hasKernel, newId: () => 's1-branch' })
  assert.deepEqual(p.overLimit, { count: 3, limit: 2, overflow: 1 })
  assert.ok(p.warnings.some((w) => /请对部分世界线选择/.test(w)))
})

// ---- 8. planProgressBundle 串联 + 预览行字段 ----
ok('plan-bundle-single-entry', () => {
  const p = planProgressBundle(bundle(), { currentSessions: [], currentWorkspaces: [], hasKernel })
  assert.equal(p.rows.length, 1)
  assert.equal(p.rows[0].conflict, false)
  assert.equal(p.rows[0].decision, 'add')
  assert.equal(p.rows[0].messages, 2)
  assert.equal(p.rows[0].kernelId, 'builtin:kernel.md')
  assert.equal(p.rows[0].missingKernel, false)
  assert.equal(p.stats.files, 2)
  assert.equal(p.engineWrites.length, p.writes.length)
  assert.ok(p.sessions.every((s) => s.messages.every((m) => !m.illust && !m.illustAsset)))
})
ok('plan-bundle-rejects-invalid-before-planning', () => {
  assert.throws(() => planProgressBundle(bundle({ engine: { files: { 'stories/../evil.json': '{}' } } }), {}), /非法片段|层级不正确/)
})
ok('limits-exported-match-mobile-policy', () => {
  assert.equal(LIMITS.maxFileBytes, 8 * 1024 * 1024)
  assert.equal(LIMITS.maxTotalBytes, 128 * 1024 * 1024)
  assert.equal(LIMITS.maxFiles, 5000)
  assert.equal(LIMITS.maxSessions, 200)
})
ok('unassigned-session-joins-single-workspace', () => {
  const p = planProgress({ bundle: bundle({ sessions: [{ id: 's9', title: 'x', updatedAt: 5, messages: [] }] }), currentSessions: [], currentWorkspaces: [], hasKernel })
  assert.equal(p.sessions[0].ws, 'ws-1')
  assert.ok(p.warnings.some((w) => /缺少工作区归属/.test(w)))
})
ok('unassigned-session-without-unique-workspace-flagged-in-preview', () => {
  const b = bundle({ workspaces: [{ id: 'ws-1', name: 'a' }, { id: 'ws-2', name: 'b' }], sessions: [{ id: 's9', title: 'x', updatedAt: 5, messages: [] }], engine: { files: {} } })
  const p = planProgress({ bundle: b, currentSessions: [], currentWorkspaces: [], hasKernel, preview: true })
  assert.equal(p.rows[0].missingWorkspace, true)
  assert.equal(p.sessions.some((s) => s.id === 's9'), false) // 预览不猜归属
  assert.throws(() => planProgress({ bundle: b, currentSessions: [], currentWorkspaces: [], hasKernel }), /缺少工作区归属/)
})

ok('replace-keeps-engine-text-byte-identical', () => {
  const text = file(story('s1', 3))
  const p = planProgress({ bundle: bundle({ engine: { files: { 'stories/s1.json': text } } }), currentSessions: local().sessions, currentWorkspaces: local().workspaces, choices: { s1: 'replace' }, hasKernel })
  assert.equal(p.writes[0].content, text)
  assert.equal(p.writes[0].source, 'stories/s1.json')
})
ok('in-flight-flags-cleared-on-import', () => {
  const p = planProgress({
    bundle: bundle({ sessions: [sess('s1', 'ws-1', 9000, [{ role: 'assistant', content: 'x', committing: true, illustPending: true }])] }),
    currentSessions: [], currentWorkspaces: [], hasKernel
  })
  const m = p.sessions[0].messages[0]
  assert.equal(m.committing, undefined)
  assert.equal(m.illustPending, undefined)
})
ok('ifFrom-remapped-only-when-parent-accepted', () => {
  const locals = [sess('s1', 'ws-1', 1000), sess('s2', 'ws-1', 1000)]
  const b = bundle({ sessions: [sess('s1', 'ws-1', 9000), Object.assign(sess('s2', 'ws-1', 9000), { ifFrom: 's1' })] })
  const p = planProgress({ bundle: b, currentSessions: locals, currentWorkspaces: local().workspaces, choices: { s1: 'branch', s2: 'replace' }, hasKernel, newId: () => 's1-branch' })
  const child = p.sessions.find((s) => s.id === 's2')
  assert.equal(child.ifFrom, 's1-branch') // 父线开了分支 → 子线指向新分支
  const p2 = planProgress({ bundle: b, currentSessions: locals, currentWorkspaces: local().workspaces, choices: { s1: 'keep', s2: 'replace' }, hasKernel })
  assert.equal(p2.sessions.find((s) => s.id === 's2').ifFrom, 's1') // 父线保留本机 → 子线仍指向本机原线
})
ok('over-limit-preview-inherited-from-validated', () => {
  const many = [sess('s0', 'ws-1', 1), sess('s1', 'ws-1', 2), sess('s2', 'ws-1', 3)]
  const b = bundle({ sessions: many, engine: { files: {} } })
  const validated = validateBundle(b, { preview: true, limits: { maxSessions: 2 } })
  const p = planProgress({ validated, currentSessions: [], currentWorkspaces: [], hasKernel, maxSessions: 2 })
  assert.deepEqual(p.overLimit, { count: 3, limit: 2, overflow: 1 })
})
ok('mixed-decisions-independent-per-line', () => {
  const locals = [sess('s1', 'ws-1', 1000), sess('s2', 'ws-1', 1000)]
  const b = bundle({ sessions: [sess('s1', 'ws-1', 9000), sess('s2', 'ws-1', 9000), sess('s3', 'ws-1', 9000)], engine: { files: {} } })
  const p = planProgress({ bundle: b, currentSessions: locals, currentWorkspaces: local().workspaces, choices: { s1: 'keep', s2: 'replace', s3: 'branch' }, hasKernel, newId: () => 's3-branch' })
  assert.deepEqual(p.rows.map((r) => r.decision), ['keep', 'replace', 'branch'])
  assert.deepEqual(p.replacedIds, ['s2'])
  assert.equal(p.sessions.find((s) => s.id === 's1').messages.length, 2)
  assert.equal(p.sessions.some((s) => s.id === 's3-branch'), true)
})

console.log('\nALL PASS  (' + checked + ' checks)')
