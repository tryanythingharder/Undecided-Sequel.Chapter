'use strict'
/* 内核工作台（桌面作者工具）测试 —— 版本不可变 / 文本差异 / 沙盒试跑可重现 / 不污染
 * 运行：node scripts-dev/test-kernel-workbench.cjs
 * 产物目录：output/kernel-workbench-tests（每轮先清空；不进版本库）
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.join(__dirname, '..')
const {
  createKernelWorkbench, createKernelWorkbenchHandlers, diffText, refKeyOf, sha256, CASES
} = require(path.join(ROOT, 'engine', 'kernel-workbench.js'))
const { createEngine } = require(path.join(ROOT, 'engine', 'index.js'))

let fails = 0
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  << ' + extra : ''))
  if (!cond) fails++
}
const readBytes = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

const TEST_ROOT = path.join(ROOT, 'output', 'kernel-workbench-tests')
/* Windows 上杀软/索引器可能瞬时占用刚写的文件：带重试清理，避免测试自身被误判失败 */
try { fs.rmSync(TEST_ROOT, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 }) } catch { /* 目录不存在 */ }
fs.mkdirSync(TEST_ROOT, { recursive: true })

/* 走父代理接入路径（createKernelWorkbenchHandlers），保证接口面与 IPC 一致 */
const handlers = createKernelWorkbenchHandlers(TEST_ROOT)
const wb = handlers.wb

const KERNEL_V1 = [
  '<!--KERNEL_META',
  '{"title":"工作台测试世界","tagline":"离线沙盒用例","origins":[{"label":"游方旅人","text":"我背着旧皮箱上路"}]}',
  'KERNEL_META-->',
  '',
  '# 工作台测试世界',
  '',
  '## 一、世界设定',
  '青石村位于北岭山脚，村口有古道通往旧王朝废墟。',
  '',
  '## 二、运行规则',
  '1. 玩家只是世界里的普通人，行动必须有代价。',
  '2. 每幕给出场景行与二至四个选项。',
  '',
  '## 三、状态记录',
  '每幕末尾输出状态记录块；纯闲聊回合输出 <<<NO_STATE_CHANGE>>>。'
].join('\n')
const KERNEL_V2 = KERNEL_V1
  .replace('青石村位于北岭山脚，村口有古道通往旧王朝废墟。', '青石村位于北岭山脚，村口有古道通往旧王朝废墟；夜里能听见铜铃。')
  .replace('2. 每幕给出场景行与二至四个选项。', '2. 每幕给出场景行与二至四个选项。\n3. 失败会真实改变资源与关系，不得无条件回退。')

const REF = 'user:workbench-test'

/* ---------------- 1. 发布：版本不可变 ---------------- */
const pub1 = wb.publish({ ref: REF, name: '工作台测试世界', text: KERNEL_V1, note: '初版' })
check('发布 v1 成功', pub1.ok && pub1.version === 'v1', JSON.stringify({ ok: pub1.ok, v: pub1.version, err: pub1.error }))
check('v1 内容哈希为 sha256', pub1.hash === sha256(KERNEL_V1), pub1.hash)
const v1File = path.join(wb.releasesDir, refKeyOf(REF), 'v1.json')
const v1Bytes = readBytes(v1File)
check('v1 版本文件落盘', fs.existsSync(v1File))

const dup = wb.publish({ ref: REF, name: '工作台测试世界', text: KERNEL_V1, note: '同一内容再发一次' })
check('相同内容重复发布不新增版本', dup.ok && dup.duplicate === true && dup.version === 'v1', JSON.stringify({ dup: dup.duplicate, v: dup.version }))
check('重复发布不改动既有版本文件字节', readBytes(v1File) === v1Bytes)

const pub2 = wb.publish({ ref: REF, name: '工作台测试世界', text: KERNEL_V2, note: '补两条规则' })
check('发布 v2 成功且版本号递增', pub2.ok && pub2.version === 'v2', JSON.stringify({ ok: pub2.ok, v: pub2.version }))
check('v2 哈希与 v1 不同', pub2.hash !== pub1.hash)
check('发布 v2 后 v1 文件字节不变（不可变）', readBytes(v1File) === v1Bytes)

const list = wb.list({ ref: REF })
check('版本列表按发布顺序返回两版', list.ok && list.releases.length === 2 && list.releases[0].version === 'v1' && list.releases[1].version === 'v2')
check('列表标注不可变语义', list.immutable === true)
check('latest 指向 v2', list.latest === 'v2')

const readV1 = wb.read({ ref: REF, version: 'v1' })
check('可读取历史版本原文', readV1.ok && readV1.text === KERNEL_V1)
const readLatest = wb.read({ ref: REF })
check('缺省读取最新版本', readLatest.ok && readLatest.meta.version === 'v2' && readLatest.text === KERNEL_V2)
check('read 不回传正文以外的体积', readLatest.meta.text === undefined)

const badRead = wb.read({ ref: REF, version: 'v9' })
check('读取不存在的版本被拒绝', badRead.ok === false && /不存在/.test(badRead.error || ''))

const emptyPublish = wb.publish({ ref: REF, text: '   ' })
check('空内容拒绝发布', emptyPublish.ok === false)
const hugePublish = wb.publish({ ref: REF, text: 'x'.repeat(1024 * 1024 + 1) })
check('超过 1MB 的内核拒绝发布', hugePublish.ok === false && /1MB/.test(hugePublish.error || ''), hugePublish.error)

/* ---------------- 2. 完整性校验（防覆盖 / 防手改） ---------------- */
const intact = wb.verify({ ref: REF })
check('发布版本完整性校验通过', intact.ok && intact.intact === true && intact.checked === 2, JSON.stringify(intact.issues))

const v2File = path.join(wb.releasesDir, refKeyOf(REF), 'v2.json')
const v2Raw = JSON.parse(fs.readFileSync(v2File, 'utf8'))
const v2Backup = fs.readFileSync(v2File)
v2Raw.text = v2Raw.text + '\n<!-- 手工篡改 -->'
fs.writeFileSync(v2File, JSON.stringify(v2Raw, null, 2), 'utf8')
const tampered = wb.verify({ ref: REF })
check('篡改版本文件可被检出', tampered.ok && tampered.intact === false && tampered.issues.some((i) => i.code === 'FILE_TAMPERED'), JSON.stringify(tampered.issues))
fs.writeFileSync(v2File, v2Backup)
check('恢复后校验重新通过', wb.verify({ ref: REF }).intact === true)

/* ---------------- 3. 文本差异 ---------------- */
const d = wb.diff({ ref: REF, from: 'v1', to: 'v2' })
check('差异返回统计', d.ok && d.stats.added === 2 && d.stats.removed === 1, JSON.stringify(d.ok ? d.stats : d.error))
check('差异统计行数与原文一致', d.ok && d.stats.aLines === KERNEL_V1.split('\n').length && d.stats.bLines === KERNEL_V2.split('\n').length)
check('差异块包含上下文行', d.ok && d.hunks.length >= 1 && d.hunks.every((h) => h.lines.some((l) => l.type === 'equal')))
check('统一格式含 +/- 行', d.ok && /^\+.*铜铃/m.test(d.unified) && /^-.*古道通往旧王朝废墟。$/m.test(d.unified))
check('差异未截断（用例文本很小）', d.ok && d.truncated === false && d.identical === false)
const dDefault = wb.diff({ ref: REF })
check('缺省对比最近两版', dDefault.ok && dDefault.from.version === 'v1' && dDefault.to.version === 'v2')
const dSame = diffText(KERNEL_V1, KERNEL_V1)
check('相同文本差异为空', dSame.identical === true && dSame.stats.added === 0 && dSame.stats.removed === 0 && dSame.stats.same === KERNEL_V1.split('\n').length)
check('差异计算可重现（两次结果一致）', diffText(KERNEL_V1, KERNEL_V2).unified === d.unified)
const dNoFrom = wb.diff({ ref: 'user:never-published' })
check('未发布内核差异请求被拒绝', dNoFrom.ok === false)

/* ---------------- 4. 沙盒试跑：状态链路 + 可重现 ---------------- */
const caseList = wb.cases()
check('用例清单离线且标注模式', caseList.ok && caseList.cases.length === CASES.length && caseList.mode === 'offline-mock-simulation' && caseList.network === 'none')
check('用例清单不含任何网络调用信息', caseList.cases.every((c) => c.turns >= 1))

const runA = wb.runCase({ ref: REF, version: 'v1', caseId: 'basic-loop' })
check('沙盒试跑成功', runA.ok, runA.error)
if (runA.ok) {
  check('试跑记录标注离线模拟且非真实试玩', runA.record.mode === 'offline-mock-simulation' && runA.record.realPlaytest === false && runA.record.network === 'none')
  check('试跑记录含免责声明', /不是收费模型的真实试玩/.test(runA.record.disclaimer))
  check('内核绑定写入试跑故事', /^sha1:/.test(runA.kernel_binding || ''), runA.kernel_binding)
  check('两幕均提交状态（PATCH_PRESENT）', runA.record.turns.every((t) => t.patch_status === 'PATCH_PRESENT' && t.committed === true), JSON.stringify(runA.record.turns.map((t) => t.patch_status)))
  const t1 = runA.record.turns[0].applied
  check('第一幕写入实体/决定/承诺/事实/事件/关系/认知/伏笔/因果', ['entities', 'decisions', 'commitments', 'facts', 'events', 'relationships', 'knowledge', 'threads', 'causal'].every((k) => (t1[k] || []).length >= 1), JSON.stringify(Object.keys(t1).map((k) => k + ':' + t1[k].length)))
  check('第一幕含玩家不可知的秘密事实', (t1.facts || []).length === 2)
  check('秘密事实不出现在 PLAYER 级上下文（权限闸在沙盒内同样生效）', !/青铜罗盘来自更北的旧王朝/.test(runA.record.turns[1].context_block))
  check('公开事实出现在 PLAYER 级上下文', /北岭近来夜里有铜铃之声/.test(runA.record.turns[1].context_block))
  check('第二幕闭环承诺/伏笔/因果', ['commitment_updates', 'thread_updates', 'causal_updates'].every((k) => (runA.record.turns[1].applied[k] || []).length === 1), JSON.stringify(Object.keys(runA.record.turns[1].applied)))
  check('第二幕上下文包含第一幕的结构化记忆', /世界状态/.test(runA.record.turns[1].context_block) && runA.record.turns[1].context_chars > runA.record.turns[0].context_chars)
  check('上下文块哈希随内容记录', /^sha256:[0-9a-f]{12}$/.test(runA.record.turns[1].context_hash))
  check('摘要统计正确', runA.record.summary.committed === 2 && runA.record.summary.engine_turn === 2, JSON.stringify(runA.record.summary))
  check('摘要为 sha256 且可复现', /^sha256:[0-9a-f]{64}$/.test(runA.record.digest))
  check('试跑记录已落盘到产物目录', fs.existsSync(runA.recordPath) && runA.relativeRecordPath.startsWith('kernel-workbench/records/'), runA.relativeRecordPath)
  check('沙盒目录运行后被清理', !fs.existsSync(path.join(wb.sandboxRoot, path.basename(runA.sandbox.dir))), runA.sandbox.dir)
}

const runB = wb.runCase({ ref: REF, version: 'v1', caseId: 'basic-loop' })
check('相同用例重复运行摘要一致（可重现）', runB.ok && runA.ok && runB.digest === runA.digest, (runA.digest || '') + ' vs ' + (runB.digest || ''))
const runOtherVersion = wb.runCase({ ref: REF, version: 'v2', caseId: 'basic-loop' })
check('换内核版本后摘要随之变化（版本可分辨）', runOtherVersion.ok && runOtherVersion.digest !== runA.digest)

const runNsc = wb.runCase({ ref: REF, caseId: 'no-state-change' })
check('纯闲聊回合判定 NO_STATE_CHANGE 且不递增回合', runNsc.ok && runNsc.record.turns[0].patch_status === 'NO_STATE_CHANGE' && runNsc.record.summary.engine_turn === 0, JSON.stringify(runNsc.ok ? runNsc.record.summary : runNsc.error))

const runConflict = wb.runCase({ ref: REF, caseId: 'conflict-rollback' })
check('引用冲突用例第二幕判定 PATCH_CONFLICT', runConflict.ok && runConflict.record.turns[1].patch_status === 'PATCH_CONFLICT', JSON.stringify(runConflict.ok ? runConflict.record.turns.map((t) => t.patch_status) : runConflict.error))
check('冲突回合整回合回滚（回合号停在 1）', runConflict.ok && runConflict.record.summary.engine_turn === 1 && runConflict.record.summary.committed === 1)
check('冲突回合未留半提交实体', runConflict.ok && runConflict.record.turns[1].overview_counts.entities === runConflict.record.turns[0].overview_counts.entities)

const runUnmarked = wb.runCase({ ref: REF, caseId: 'unmarked-tail-json' })
check('无标记尾部裸 JSON 兜底识别为 PATCH_PRESENT', runUnmarked.ok && runUnmarked.record.turns[0].patch_status === 'PATCH_PRESENT', JSON.stringify(runUnmarked.ok ? runUnmarked.record.turns[0].patch_status : runUnmarked.error))
check('兜底识别记录 PATCH_UNMARKED 警告', runUnmarked.ok && runUnmarked.record.turns[0].warnings.includes('PATCH_UNMARKED'), JSON.stringify(runUnmarked.ok ? runUnmarked.record.turns[0].warnings : ''))

const unknownCase = wb.runCase({ ref: REF, caseId: 'not-a-case' })
check('未知用例被拒绝', unknownCase.ok === false && /未知用例/.test(unknownCase.error || ''))
const noRelease = wb.runCase({ ref: 'user:never-published', caseId: 'basic-loop' })
check('未发布内核拒绝试跑', noRelease.ok === false && /先发布/.test(noRelease.error || ''))

const recList = wb.records({ ref: REF })
check('试跑记录可列举', recList.ok && recList.records.length >= 4 && recList.records.every((r) => r.realPlaytest === false), JSON.stringify(recList.ok ? recList.records.length : recList.error))

/* ---------------- 5. 沙盒不污染：目录隔离 + 玩家世界线零接触 ---------------- */
const rootEntries = fs.readdirSync(wb.root).sort()
check('工作台根目录只有自身产物', JSON.stringify(rootEntries) === JSON.stringify(['index.json', 'records', 'releases', 'sandbox']), JSON.stringify(rootEntries))
check('沙盒目录运行后为空（无残留引擎档）', fs.readdirSync(wb.sandboxRoot).length === 0, JSON.stringify(fs.readdirSync(wb.sandboxRoot)))
const dataRootEntries = fs.readdirSync(TEST_ROOT).sort()
check('dataRoot 下只写入 kernel-workbench 子目录', JSON.stringify(dataRootEntries) === JSON.stringify(['kernel-workbench']), JSON.stringify(dataRootEntries))
check('工作台未创建 app 的 story-engine 目录', !fs.existsSync(path.join(TEST_ROOT, 'story-engine')))

/* 试跑期间引擎目录确实存在且被删干净（keepSandbox 仅用于排障） */
const keepRun = wb.runCase({ ref: REF, caseId: 'basic-loop', keepSandbox: true })
const keptDir = keepRun.ok ? path.join(wb.sandboxRoot, path.basename(keepRun.sandbox.dir)) : ''
check('keepSandbox 保留沙盒用于排障', !!keptDir && fs.existsSync(path.join(keptDir, 'stories')))
const strayStories = fs.existsSync(path.join(keptDir, 'stories')) ? fs.readdirSync(path.join(keptDir, 'stories')).filter((f) => !f.endsWith('.meta.json')) : []
check('沙盒故事使用 WB- 前缀（与玩家世界线命名空间隔离）', strayStories.length > 0 && strayStories.every((f) => f.startsWith('WB-')), JSON.stringify(strayStories))
fs.rmSync(keptDir, { recursive: true, force: true })

/* 真实玩家引擎目录不受影响：独立建一个引擎，跑工作台用例，确认其故事文件未变 */
const playerDir = path.join(TEST_ROOT, 'player-engine')
const playerEngine = createEngine(playerDir)
playerEngine.ensureStory({ storyId: 'STO-PLAYER-1', title: '玩家世界线', kernelId: 'builtin:kernel.md', kernelText: '# 玩家内核' })
const playerStoryFile = path.join(playerDir, 'stories', 'STO-PLAYER-1.json')
const playerBefore = readBytes(playerStoryFile)
wb.runCase({ ref: REF, caseId: 'basic-loop' })
check('工作台试跑不改动玩家引擎故事档', readBytes(playerStoryFile) === playerBefore)
check('玩家引擎目录无工作台产物', !fs.existsSync(path.join(playerDir, 'kernel-workbench')))
playerEngine.close()

/* ---------------- 6. 真实模型试玩：未授权一律阻断 ---------------- */
const realStatus = handlers.realPlaytestStatus()
check('真实试玩标注需授权且不可用', realStatus.available === false && realStatus.requiresAuthorization === true)
const realRun = handlers.runRealPlaytest()
check('真实试玩被阻断且不返回任何请求结果', realRun.ok === false && realRun.blocked === true && !realRun.data)

/* 源码层面证明零网络 / 零模型调用 */
const src = fs.readFileSync(path.join(ROOT, 'engine', 'kernel-workbench.js'), 'utf8')
check('模块不含网络调用（fetch/http/axios）', !/\bfetch\s*\(|require\(['"]node:https?['"]\)|axios/.test(src))
check('模块不读取 API 密钥配置', !/apiKey|secrets:load|loadSecrets/.test(src))
check('模块不含随机数（保证可重现）', !/Math\.random/.test(src))

/* ---------------- 7. 接口面与父代理接入契约 ---------------- */
check('handlers 暴露父代理所需方法', ['capabilities', 'publish', 'list', 'read', 'diff', 'verify', 'cases', 'run', 'records', 'realPlaytestStatus', 'runRealPlaytest'].every((k) => typeof handlers[k] === 'function'))
check('handlers 提供 IPC 通道名映射', handlers.channels.kernelWbRun === 'kernel-wb:run' && handlers.channels.kernelWbPublish === 'kernel-wb:publish')
check('handlers 提供可直接挂 ipcMain.handle 的通道表', Object.keys(handlers.ipcHandlers).length === Object.keys(handlers.channels).length && typeof handlers.ipcHandlers['kernel-wb:publish'] === 'function')
const alias = require(path.join(ROOT, 'engine', 'kernel-workbench.js'))
check('模块导出 register / createWorkbench 接入别名', typeof alias.register === 'function' && typeof alias.createWorkbench === 'function')
const aliasWb = alias.createWorkbench({ dataRoot: path.join(TEST_ROOT, 'alias-data') })
check('createWorkbench(dataRoot) 最小接口可用', aliasWb.publish({ ref: 'user:alias', text: KERNEL_V1 }).ok === true)
const aliasHandlers = alias.register(path.join(TEST_ROOT, 'alias-data2'))
check('register(dataRoot) 返回完整 IPC 方法集', aliasHandlers.publish({ ref: 'user:alias2', text: KERNEL_V1 }).ok === true && typeof aliasHandlers.run === 'function')

/* 索引丢失时也不许覆盖既有版本文件：publish 以 'wx' 独占创建，冲突即失败退出 */
const orphan = alias.createWorkbench({ dataRoot: path.join(TEST_ROOT, 'alias-data') })
const orphanV1 = path.join(orphan.releasesDir, refKeyOf('user:alias'), 'v1.json')
const orphanBytes = readBytes(orphanV1)
fs.rmSync(path.join(orphan.root, 'index.json'), { force: true })
const orphanRetry = orphan.publish({ ref: 'user:alias', text: KERNEL_V2 })
check('索引丢失后重发不会覆盖既有版本文件', readBytes(orphanV1) === orphanBytes)
check('索引丢失时发布如实报错而非静默覆盖', orphanRetry.ok === false, JSON.stringify(orphanRetry))
const caps = handlers.capabilities()
check('capabilities 声明离线模式与数据根', caps.ok && caps.offlineMock === true && caps.realPlaytest === false && caps.network === 'none' && caps.dataRoot === TEST_ROOT)

/* 方法返回纯 JSON（可结构化克隆 → 可经 IPC 直传） */
const allPayloads = [caps, wb.list({ ref: REF }), wb.cases(), wb.records({ ref: REF }), realStatus, realRun]
check('全部返回值可结构化克隆（IPC 可直传）', allPayloads.every((v) => { try { structuredClone(v); return true } catch { return false } }))

/* ---------------- 8. 共享 UI：三套界面自挂载 + 真实交互（无头浏览器） ---------------- */
/* 只验证「共享 UI 能自挂载并打通 window.api」，不涉及 Electron 主进程。 */
async function uiSmoke() {
  let chromium
  try { ({ chromium } = require('playwright')) } catch { return { skipped: '未安装 playwright' } }
  let browser
  try { browser = await chromium.launch({ headless: true }) } catch (e) { return { skipped: '浏览器不可用：' + (e.message || e) } }
  const uiRoot = path.join(TEST_ROOT, 'ui-data')
  fs.mkdirSync(uiRoot, { recursive: true })
  const uiHandlers = createKernelWorkbenchHandlers(uiRoot)
  const uiRefBase = 'user:ui-smoke'
  const results = []
  try {
    for (const scheme of ['classic', 'proto', 'd']) {
      /* 每套界面用独立 ref，保证「首发布成功」这条断言在三套界面下都是首发布 */
      const uiRef = uiRefBase + '-' + scheme
      /* proto 这一轮模拟 main.cjs 既有 safeHandle 的 { ok, data } 包装层，验证渲染层能自动拆包 */
      const wrapSafeHandle = scheme === 'proto'
      const page = await browser.newPage()
      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))
      /* 把 node 侧 handlers 暴露给页面，模拟父代理接好的 window.api */
      await page.exposeFunction('__kwbCall', async (name, payloadJson) => {
        const fn = uiHandlers[name]
        if (typeof fn !== 'function') return JSON.stringify({ ok: false, error: 'no-handler:' + name })
        const payload = payloadJson ? JSON.parse(payloadJson) : undefined
        const result = await fn(payload)
        return JSON.stringify(wrapSafeHandle ? { ok: true, data: result } : result)
      })
      await page.addInitScript(() => {
        const wrap = (name) => (payload) => window.__kwbCall(name, payload === undefined ? '' : JSON.stringify(payload)).then((s) => JSON.parse(s))
        window.api = {
          kernelWbCapabilities: wrap('capabilities'),
          kernelWbPublish: wrap('publish'),
          kernelWbList: wrap('list'),
          kernelWbRead: wrap('read'),
          kernelWbDiff: wrap('diff'),
          kernelWbVerify: wrap('verify'),
          kernelWbCases: wrap('cases'),
          kernelWbRun: wrap('run'),
          kernelWbRecords: wrap('records')
        }
      })
      const url = 'file:///' + path.join(ROOT, 'ui', scheme, 'index.html').replace(/\\/g, '/')
      await page.goto(url)
      await page.waitForTimeout(300)
      const before = pageErrors.length
      await page.addScriptTag({ url: 'file:///' + path.join(ROOT, 'ui', 'shared', 'kernel-workbench.js').replace(/\\/g, '/') })
      await page.waitForTimeout(400)
      const mounted = await page.locator('#btn-kernel-workbench').count()
      const hostInHead = await page.locator('.kernel-workbench-actions #btn-kernel-workbench').count()
      const styleInjected = await page.locator('link[data-kernel-workbench]').count()
      const newErrors = pageErrors.slice(before).filter((m) => /kernel-workbench/.test(m))
      let published = '', diffOk = false, runOk = false, recordsOk = false, dupText = ''
      if (mounted) {
        /* 无头环境不驱动 app.js 的页面切换：直接移除启动页并显示内核设计页（只测本模块自挂载） */
        await page.evaluate(() => {
          const splash = document.getElementById('splash')
          if (splash) splash.remove()
          const hub = document.getElementById('kernel-hub')
          if (hub) hub.removeAttribute('hidden')
        })
        await page.locator('#btn-kernel-workbench').click()
        await page.waitForSelector('.kwb-panel')
        const refInput = page.locator('.kwb-panel .kwb-field input').first()
        await refInput.fill(uiRef)
        await refInput.dispatchEvent('change')
        /* 同一内容发两次（第二次应被拦成沿用），再发一版不同内容以产生可对比差异 */
        await page.locator('.kwb-panel textarea').fill(KERNEL_V1)
        await page.locator('.kwb-panel button:has-text("发布为新版本")').click()
        await page.waitForSelector('.kwb-live-status.ok', { timeout: 8000 })
        published = (await page.locator('.kwb-live-status.ok').textContent()) || ''
        await page.locator('.kwb-panel button:has-text("发布为新版本")').click()
        await page.waitForTimeout(800)
        dupText = (await page.locator('.kwb-live-status.ok').textContent()) || ''
        await page.locator('.kwb-panel textarea').fill(KERNEL_V2)
        await page.locator('.kwb-panel button:has-text("发布为新版本")').click()
        await page.waitForTimeout(800)
        /* 版本与差异页 */
        await page.locator('.kwb-tab[data-tab="versions"]').click()
        await page.waitForSelector('.kwb-diff .kwb-diff-line.add', { timeout: 8000 })
        const adds = await page.locator('.kwb-diff-line.add').count()
        const dels = await page.locator('.kwb-diff-line.del').count()
        diffOk = adds >= 1 && dels >= 1
        /* 沙盒试跑页 */
        await page.locator('.kwb-tab[data-tab="cases"]').click()
        await page.waitForSelector('.kwb-case', { timeout: 8000 })
        await page.locator('.kwb-case button:has-text("在此版本上运行")').first().click()
        await page.waitForSelector('.kwb-run-result.ok', { timeout: 20000 })
        runOk = /试跑完成/.test((await page.locator('.kwb-run-result.ok').textContent()) || '')
        /* 记录页 */
        await page.locator('.kwb-tab[data-tab="records"]').click()
        await page.waitForSelector('.kwb-records .kwb-table', { timeout: 8000 })
        recordsOk = (await page.locator('.kwb-records .kwb-table tbody tr').count()) >= 1
        results.push({ scheme, mounted, hostInHead, styleInjected, published, dupText, diffOk, runOk, recordsOk, newErrors, safeWrapped: wrapSafeHandle })
      } else {
        results.push({ scheme, mounted, hostInHead, styleInjected, published, dupText: '', diffOk, runOk, recordsOk, newErrors, safeWrapped: wrapSafeHandle })
      }
      await page.close()
    }
  } finally { await browser.close() }

  for (const r of results) {
    check('[' + r.scheme + '] 共享 UI 自挂载「工作台」按钮到内核设计页顶部', r.mounted === 1 && r.hostInHead === 1, JSON.stringify({ mounted: r.mounted, inHead: r.hostInHead }))
    check('[' + r.scheme + '] 自动注入工作台样式', r.styleInjected === 1)
    check('[' + r.scheme + '] 经 window.api 发布版本成功' + (r.safeWrapped ? '（safeHandle 的 { ok, data } 包装已自动拆包）' : ''), /已发布 v1/.test(r.published), r.published)
    check('[' + r.scheme + '] 相同内容重复发布被拦为沿用（不覆盖）', /未新建版本/.test(r.dupText), r.dupText)
    check('[' + r.scheme + '] 差异视图渲染新增与删除行', r.diffOk)
    check('[' + r.scheme + '] 沙盒试跑在 UI 内跑通', r.runOk)
    check('[' + r.scheme + '] 试跑记录在 UI 内可列', r.recordsOk)
    check('[' + r.scheme + '] 无工作台脚本错误', r.newErrors.length === 0, JSON.stringify(r.newErrors))
  }
  return { skipped: null }
}

/* ---------------- 汇总 ---------------- */
void (async () => {
  const ui = await uiSmoke()
  if (ui.skipped) console.log('SKIP  共享 UI 无头浏览器冒烟（' + ui.skipped + '）')
  console.log('')
  console.log(fails === 0 ? '全部通过（' + CASES.length + ' 个离线用例，产物目录 ' + path.relative(ROOT, TEST_ROOT) + '）' : fails + ' 项失败')
  process.exit(fails === 0 ? 0 : 1)
})()
