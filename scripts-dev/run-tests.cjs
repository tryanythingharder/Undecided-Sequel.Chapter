'use strict'
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const unit = [
  'scripts-dev/test-story-engine.cjs',
  'scripts-dev/test-vector-store.cjs',
  'scripts-dev/test-embedder-api.cjs',
  'scripts-dev/test-sessions-db.cjs',
  'scripts-dev/test-patch-reliability.cjs',
  'scripts-dev/test-access.cjs',
  'scripts-dev/audit-acceptance.cjs',
  'scripts-dev/validate-kernel-xianxia.cjs',
  'mobile/tools/bridge-test.mjs'
]
const desktop = [
  'scripts-dev/verify.cjs',
  'scripts-dev/test-kernel-hub.cjs',
  'scripts-dev/test-secure-storage.cjs',
  'scripts-dev/test-sessions-persistence.cjs',
  'scripts-dev/test-progress-import.cjs',
  'scripts-dev/test-ui-scheme.cjs',
  'scripts-dev/test-choices.cjs',
  'scripts-dev/test-engine-e2e.cjs',
  'scripts-dev/e2e-mock.cjs'
]
const mode = process.argv[2] || 'all'
const files = mode === 'unit' ? unit : (mode === 'desktop' ? desktop : unit.concat(desktop))
if (!['all', 'unit', 'desktop'].includes(mode)) throw new Error('未知测试套件: ' + mode)

for (const file of files) {
  console.log('\n=== ' + file + ' ===')
  const result = spawnSync(process.execPath, [path.join(root, file)], { cwd: root, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log('\n全部 ' + files.length + ' 个测试程序通过。')
