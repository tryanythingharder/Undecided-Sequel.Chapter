'use strict'
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const unit = [
  'scripts-dev/test-author-tools.cjs',
  'scripts-dev/test-experience-tools.cjs',
  'scripts-dev/test-kernel-workbench.cjs',
  'scripts-dev/test-archives.cjs',
  'scripts-dev/test-progress-plan.cjs',
  'scripts-dev/test-player-memory.cjs',
  'scripts-dev/test-runtime-tools.cjs',
  'scripts-dev/test-runtime-service.cjs',
  'scripts-dev/test-audit-regressions.cjs',
  'scripts-dev/test-story-engine.cjs',
  'scripts-dev/test-vector-store.cjs',
  'scripts-dev/test-embedder-api.cjs',
  'scripts-dev/test-sessions-db.cjs',
  'scripts-dev/test-engine-comic.cjs',
  'scripts-dev/test-comic-layout.cjs',
  'scripts-dev/test-holo-card.cjs',
  'scripts-dev/test-patch-reliability.cjs',
  'scripts-dev/test-protocol-position.cjs',
  'scripts-dev/test-access.cjs',
  'scripts-dev/test-bloub.cjs',
  'scripts-dev/audit-acceptance.cjs',
  'scripts-dev/validate-kernel-xianxia.cjs',
  'mobile/tools/bridge-test.mjs',
  'mobile/tools/bridge-sandbox.mjs'
]
const desktop = [
  'scripts-dev/test-runtime-authority-desktop.cjs',
  'scripts-dev/test-kernel-focus-desktop.cjs',
  'scripts-dev/test-product-tools-desktop.cjs',
  'scripts-dev/test-audit-desktop.cjs',
  'scripts-dev/verify.cjs',
  'scripts-dev/test-kernel-hub.cjs',
  'scripts-dev/test-secure-storage.cjs',
  'scripts-dev/test-sessions-persistence.cjs',
  'scripts-dev/test-archive-ui-roundtrip.cjs',
  'scripts-dev/test-progress-import.cjs',
  'scripts-dev/test-desktop-evolution.cjs',
  'scripts-dev/test-ui-scheme.cjs',
  'scripts-dev/test-choices.cjs',
  'scripts-dev/test-engine-e2e.cjs',
  'scripts-dev/e2e-mock.cjs',
  'scripts-dev/test-comic-fused.cjs',
  'scripts-dev/test-comic-reader.cjs',
  'scripts-dev/test-comic-reader.cjs#proto',
  'scripts-dev/test-bloub-e2e.cjs'
]
const mode = process.argv[2] || 'all'
const selected = mode === 'unit' ? unit : (mode === 'desktop' ? desktop : unit.concat(desktop))
if (!['all', 'unit', 'desktop'].includes(mode)) throw new Error('未知测试套件: ' + mode)
// 仅桌面验收时显式排除移动桥测试；默认 npm test 仍保持原有完整矩阵。
const desktopOnly = process.argv.includes('--desktop-only')
const skipped = desktopOnly ? selected.filter((file) => file.startsWith('mobile/')) : []
const files = selected.filter((file) => !skipped.includes(file))
if (skipped.length) console.log('按 --desktop-only 排除：' + skipped.join(', '))

/* 三入口共享模块验收：e2e-mock 覆盖 proto；存档 UI 往返覆盖 proto 与 d。
 * 通过后缀标注方案，在独立 profile 下串行运行同一正式入口。 */
const e2eMockIdx = files.indexOf('scripts-dev/e2e-mock.cjs')
if (e2eMockIdx !== -1) files.splice(e2eMockIdx + 1, 0, 'scripts-dev/e2e-mock.cjs#proto')
const archiveTest = 'scripts-dev/test-archive-ui-roundtrip.cjs'
const archiveIdx = files.indexOf(archiveTest)
if (archiveIdx !== -1) files.splice(archiveIdx + 1, 0, archiveTest + '#proto', archiveTest + '#d')

// 每轮、每个测试独立档案。APPDATA 与显式 userData 对齐，兼容旧脚本的磁盘断言；
// TEMP/TMP 也落在工作区内，不污染系统临时目录。真实 Electron 始终 spawnSync 串行。
const runsRoot = path.join(root, 'output', 'test-runs')
fs.mkdirSync(runsRoot, { recursive: true })
const runRoot = fs.mkdtempSync(path.join(runsRoot, mode + '-'))
const results = []
console.log('本轮隔离目录：' + runRoot)
for (const file of files) {
  const schemeMatch = /#(proto|d)$/.exec(file)
  const scheme = schemeMatch ? schemeMatch[1] : null
  const target = schemeMatch ? file.slice(0, schemeMatch.index) : file
  const label = scheme ? (target + '（SIXWORLDS_UI_SCHEME=' + scheme + '）') : file
  const testRoot = path.join(runRoot, path.basename(target, path.extname(target)) + (scheme ? '-' + scheme : ''))
  const appData = path.join(testRoot, 'appdata')
  const temp = path.join(testRoot, 'tmp')
  const storageTest = target === 'scripts-dev/test-secure-storage.cjs'
  const profile = path.join(appData, '六面世界', storageTest ? 'test-profile-storage' : 'test-profile')
  for (const dir of [profile, temp]) fs.mkdirSync(dir, { recursive: true })
  const env = Object.assign({}, process.env, {
    APPDATA: appData, TEMP: temp, TMP: temp, TMPDIR: temp,
    SIXWORLDS_TEST: '1', SIXWORLDS_TEST_USER_DATA: profile,
    SIXWORLDS_STORAGE_TEST: storageTest ? '1' : '',
    SIXWORLDS_UI_SCHEME: scheme || 'classic'
  })
  delete env.ELECTRON_RUN_AS_NODE
  const startedAt = Date.now()
  console.log('\n=== ' + label + ' ===')
  const result = spawnSync(process.execPath, [path.join(root, target)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env
  })
  const log = String(result.stdout || '') + String(result.stderr || '')
  fs.writeFileSync(path.join(testRoot, 'test.log'), log, 'utf8')
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  results.push({ file, status: result.status, elapsedMs: Date.now() - startedAt, error: result.error ? result.error.message : null })
  fs.writeFileSync(path.join(runRoot, 'results.json'), JSON.stringify({ mode, desktopOnly, skipped, results, complete: results.length === files.length }, null, 2))
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log('\n全部 ' + files.length + ' 个测试程序通过。')
