'use strict'
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const unit = [
  'scripts-dev/test-story-engine.cjs',
  'scripts-dev/test-vector-store.cjs',
  'scripts-dev/test-embedder-api.cjs',
  'scripts-dev/test-sessions-db.cjs',
  'scripts-dev/test-engine-comic.cjs',
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
  'scripts-dev/verify.cjs',
  'scripts-dev/test-kernel-hub.cjs',
  'scripts-dev/test-secure-storage.cjs',
  'scripts-dev/test-sessions-persistence.cjs',
  'scripts-dev/test-progress-import.cjs',
  'scripts-dev/test-ui-scheme.cjs',
  'scripts-dev/test-choices.cjs',
  'scripts-dev/test-engine-e2e.cjs',
  'scripts-dev/e2e-mock.cjs',
  'scripts-dev/test-bloub-e2e.cjs'
]
const mode = process.argv[2] || 'all'
const files = mode === 'unit' ? unit : (mode === 'desktop' ? desktop : unit.concat(desktop))
if (!['all', 'unit', 'desktop'].includes(mode)) throw new Error('未知测试套件: ' + mode)

/* UI 方案矩阵（绞杀者闸门）：e2e-mock 在 classic 之外再以 SIXWORLDS_UI_SCHEME=proto
 * 整轮跑一次——shared/ 模块两套 UI 共用，proto 侧挂接点崩坏只有这条矩阵能抓住。
 * 就地进程注入环境变量，不新增文件条目（顺序在 classic e2e 与桌宠 e2e 之后）。 */
const e2eMockIdx = files.indexOf('scripts-dev/e2e-mock.cjs')
if (e2eMockIdx !== -1) files.splice(e2eMockIdx + 1, 0, 'scripts-dev/e2e-mock.cjs#proto')

for (const file of files) {
  const schemeProto = file.endsWith('#proto')
  const target = schemeProto ? file.slice(0, -6) : file
  const label = schemeProto ? (target + '（SIXWORLDS_UI_SCHEME=proto）') : file
  console.log('\n=== ' + label + ' ===')
  const result = spawnSync(process.execPath, [path.join(root, target)], {
    cwd: root, stdio: 'inherit',
    env: schemeProto ? Object.assign({}, process.env, { SIXWORLDS_UI_SCHEME: 'proto' }) : process.env
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log('\n全部 ' + files.length + ' 个测试程序通过。')
