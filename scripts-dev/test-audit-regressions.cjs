'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createEngine } = require('../engine')

const root = path.join(__dirname, '..')
const noop = () => {}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
function loadScript(file, globals = {}) {
  const context = vm.createContext({ window: {}, setTimeout, clearTimeout, setInterval, clearInterval, ...globals })
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context)
  return context.window
}

async function engineChecks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-audit-engine-'))
  let engine = createEngine(dir)
  try {
    engine.ensureStory({ storyId: 'audit', title: 'Audit', kernelText: 'test kernel' })
    const changedKernel = engine.ensureStory({ storyId: 'audit', kernelText: 'changed rules' })
    assert.equal(changedKernel.kernel_match, false)
    assert.equal(changedKernel.kernel_text, 'test kernel')
    const meta = { storyId: 'audit', playerInput: 'act' }
    const before = engine.snapshot('audit', 'before', true)
    const originalWrite = engine.store._atomicWrite
    engine.store._atomicWrite = () => { throw new Error('simulated disk failure') }
    const failed = engine.commitPatch({ facts: [{ key: 'failed', statement: 'must not persist' }] }, meta)
    assert.equal(failed.committed, false)
    assert.equal(engine.getStory('audit').counters.turn, 0)
    assert.equal(engine.getStory('audit').facts.length, 0)
    engine.store._atomicWrite = originalWrite
    assert.equal(engine.commitPatch({ facts: [{ key: 'future', statement: 'future event' }] }, meta).committed, true)
    engine.cloneStory({ storyId: 'audit', targetId: 'branch', snapshotId: before.snapshot_id })
    assert.equal(engine.getStory('branch').counters.turn, 0)
    assert.equal(engine.getStory('branch').facts.length, 0)
    assert.equal(engine.getStory('audit').facts.length, 1)
    engine.restoreSnapshot('branch', before.snapshot_id)
    assert.equal(engine.getStory('branch').story_id, 'branch')
    const manual1 = engine.snapshot('audit', 'manual 1')
    engine.close()
    engine = createEngine(dir)
    const manual2 = engine.snapshot('audit', 'manual 2 after restart')
    assert.notEqual(manual1.snapshot_id, manual2.snapshot_id)
    engine.restoreSnapshot('audit', manual1.snapshot_id)
    const manual3 = engine.snapshot('audit', 'manual 3 after restore')
    assert.notEqual(manual2.snapshot_id, manual3.snapshot_id)
    assert.equal(engine.listSnapshots('audit').length, 3)
    const pending = engine.recordPending({ storyId: 'audit', narrative: 'no change' })
    assert.equal(pending.current_state_version, engine.getStory('audit').counters.turn)
    assert.equal(engine.resolvePending({ storyId: 'audit', pendingId: pending.pending_id, raw: '<<<NO_STATE_CHANGE>>>' }).resolved, true)
    assert.equal(engine.listPendings('audit').length, 0)
    console.log('PASS engine: disk rollback, historical branch, snapshot IDs, no-change pending')
  } finally { engine.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

async function persistenceChecks() {
  const data = new Map()
  const localStorage = { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }
  const lib = loadScript('ui/shared/sessions-client.js', { localStorage }).SessionsClient
  const sessions = Array.from({ length: 201 }, (_, i) => ({ id: 's' + i, messages: [], ws: 'w' }))
  let writes = 0, warnings = 0
  const api = { saveSessions: async () => { writes++; return { ok: true } } }
  const persistence = lib.createSessionsPersistence({ getSessions: () => sessions }, { api, onOverLimit: () => warnings++ })
  assert.equal((await persistence.saveSessions(true)).ok, false)
  assert.equal(writes, 0)
  assert.equal(sessions.length, 201)
  assert.equal(warnings, 1)
  const broken = lib.createSessionsPersistence({ getSessions: () => [] }, { api: { ...api, loadSessions: async () => ({ ok: false }) }, warnSaveFail: noop })
  await broken.loadSessions(() => [{ id: 'w' }], 'w')
  await broken.saveSessions(true)
  assert.equal(writes, 0)
  data.set('sixworlds.sessions.v1', JSON.stringify([{ id: 'deleted', messages: [] }]))
  const empty = lib.createSessionsPersistence({ getSessions: () => [] }, { api: { ...api, loadSessions: async () => ({ ok: true, exists: true, sessions: [] }) } })
  assert.equal((await empty.loadSessions(() => [{ id: 'w' }], 'w')).sessions.length, 0)
  console.log('PASS sessions: overflow preserves disk, failed load blocks overwrite, deleted history stays deleted')
}

async function sendChecks() {
  const document = { getElementById: () => null }
  const lib = loadScript('ui/shared/send-flow.js', { document, cancelAnimationFrame: noop }).SendFlow
  const session = { id: 'send', title: 'story', messages: [] }
  const input = { value: '' }
  const st = { busy: false, engineBusy: false }
  const first = deferred(), retry = deferred()
  let sends = 0, saves = 0
  const api = {
    sendChat: async (payload) => {
      sends++
      if (payload.silent) return retry.promise
      return sends === 1 ? first.promise : { ok: true, content: 'next turn' }
    },
    engineCommit: async ({ raw }) => raw === 'first turn'
      ? { ok: true, data: { narrative: raw, pending_id: 'PC-1', patch_status: 'PATCH_MISSING' } }
      : { ok: true, data: { committed: true, narrative: raw } },
    notify: async () => {}, engineSnapshot: async () => ({ ok: true, data: { snapshot_id: 'SNP-1' } })
  }
  const ctx = { st, api, $: () => input, cfg: () => ({ baseUrl: 'mock', apiKey: 'mock', model: 'mock' }), kernel: () => ({ text: 'kernel' }),
    curSession: () => session, deriveTitle: () => 'story', fitInput: noop, generateIllust: noop, illustReady: () => false, newSession: noop, openSettings: noop,
    renderMessages: noop, renderSessionList: noop, saveSessions: () => saves++, sessionDrafts: new Map(), setSendButtonState: noop, showBusyIsland: () => ({ close: noop }),
    toast: noop, touchSession: noop, updateTitle: noop, enginePrep: async (_s, value) => ({ storyId: session.id, playerInput: value, retrievedIds: [] }),
    patchRetryPrompt: () => 'retry', protocolText: () => '' }
  const send = lib.createSend(ctx)
  const active = send.send('first action')
  await wait(0)
  await send.send('queued action')
  first.resolve({ ok: true, content: 'first turn' })
  await wait(30)
  assert.equal(st.engineBusy, true)
  assert.equal(session.messages[1].content, 'first turn')
  assert.equal(sends, 2)
  await wait(330)
  assert.equal(sends, 2, 'queue must wait for pending commit')
  retry.resolve({ ok: true, content: 'patch only' })
  await active
  await wait(650)
  assert.equal(sends, 3, 'queued action runs after retry settles')
  assert.equal(session.messages[2].content, 'queued action')
  assert.equal(st.busy, false)
  assert.equal(st.engineBusy, false)
  assert.equal(session.messages[0].engineSnapshot, 'SNP-1')
  api.sendChat = async () => { throw new Error('IPC disconnected') }
  await send.send('network failure')
  assert.equal(st.busy, false)
  assert.equal(st.engineBusy, false)
  assert.match(session.messages.at(-1).content, /IPC disconnected/)
  session.messages.push({ role: 'assistant', pending: 'PC-2', content: 'pending' })
  api.enginePendings = async () => ({ ok: true, data: [{ pending_id: 'PC-2', player_input: 'action' }] })
  api.sendChat = async () => ({ ok: true, content: 'patch', usage: { total_tokens: 10 } })
  api.engineResolvePending = async () => ({ ok: true, data: { resolved: true } })
  const resolve = lib.createResolvePendingFlow({ ...ctx, protocolText: () => 'protocol', refreshPendingBanner: noop })
  const beforeSaves = saves
  await resolve('PC-2')
  assert.equal(session.messages.at(-1).pending, undefined)
  assert.ok(saves > beforeSaves)
  assert.equal(st.engineBusy, false)
  console.log('PASS send: retry queue, no overlapping turns, IPC recovery, pending badges persisted')
}

async function workspaceChecks() {
  const lib = loadScript('ui/shared/workspace-panel.js').WorkspacePanel
  const sessions = [{ id: 'old', ws: 'first' }, { id: 'kept', ws: 'second' }]
  const workspaces = [{ id: 'first', name: 'first' }, { id: 'second', name: 'second' }]
  const deleted = []
  let currentWs = 'first', currentId = 'old'
  const panel = lib.createWorkspacePanel({
    $: () => ({ value: '' }), api: { archiveCreate: async () => ({ ok: true }), engineDeleteStory: async ({ storyId }) => deleted.push(storyId) },
    workspaces: () => workspaces, sessions: () => sessions, currentWsId: () => currentWs, currentId: () => currentId,
    setCurrentWsId: (id) => { currentWs = id }, setCurrentId: (id) => { currentId = id },
    curWs: () => workspaces.find((w) => w.id === currentWs), wsSessions: () => sessions.filter((s) => s.ws === currentWs),
    busy: () => false, sessionDrafts: new Map(), confirmDialog: async () => true,
    saveWorkspaces: noop, saveStore: noop, saveSessions: noop, renderWsBtn: noop, renderSessionList: noop,
    renderMessages: noop, updateTitle: noop, newSession: noop, loadKernel: async () => {}, toast: noop
  })
  await panel.deleteWorkspace()
  assert.deepEqual(deleted, ['old'])
  assert.equal(currentWs, 'second')
  assert.equal(currentId, 'kept')
  assert.equal(sessions.length, 1)
  console.log('PASS workspace: deletion uses busy getter and removes owned engine data')
}

async function main() { await engineChecks(); await persistenceChecks(); await sendChecks(); await workspaceChecks() }
main().catch((error) => { console.error(error); process.exitCode = 1 })
