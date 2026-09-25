'use strict'
/* 正式三入口内核编辑焦点回归。受控时钟只调度渲染定时器；不替换 API / IPC。
 * 保持业务主进程、preload、三套布局，所有 profile 与临时文件独立于用户数据。
 */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright')
const root = path.resolve(__dirname, '..')
const runs = path.join(root, 'output', 'playwright', 'kernel-focus')
fs.mkdirSync(runs, { recursive: true })
const out = fs.mkdtempSync(path.join(runs, 'run-'))
const text = '# 保存焦点回归\n\n规则：名称和正文必须完整持久化。\n'
const results = []

async function runScheme(scheme) {
  const base = path.join(out, scheme)
  const profile = path.join(base, 'profile')
  const temp = path.join(base, 'tmp')
  const appData = path.join(base, 'appdata')
  for (const dir of [profile, temp, appData]) fs.mkdirSync(dir, { recursive: true })
  const env = { ...process.env, SIXWORLDS_TEST: '1', SIXWORLDS_STORAGE_TEST: '1', SIXWORLDS_TEST_USER_DATA: profile, APPDATA: appData, TEMP: temp, TMP: temp, TMPDIR: temp }
  const launch = () => electron.launch({ executablePath: require('electron'), cwd: root, args: ['.'], env })
  const result = { scheme, status: 'running', errors: [], saved: [] }
  results.push(result)
  let app, win
  const watch = (page) => {
    page.on('pageerror', (e) => result.errors.push(e.message))
    page.on('console', (msg) => { if (msg.type() === 'error') result.errors.push(msg.text()) })
  }
  try {
    app = await launch()
    win = await app.firstWindow()
    watch(win)
    await win.waitForSelector('#input')
    // 方案切换由主进程 loadFile 重载窗口：切换瞬间旧执行上下文销毁，读/设方案都可能撞上
    // "Execution context was destroyed"——统一带重试，并在导航落地后再继续
    let current = null
    for (let i = 0; i < 10 && current === null; i++) {
      try { current = await win.evaluate(() => window.api.uiScheme()) } catch (e) { await win.waitForTimeout(500) }
    }
    if (current !== scheme) {
      for (let i = 0; i < 5; i++) {
        try { await win.evaluate((sc) => window.api.setUiScheme(sc), scheme); break } catch (e) { await win.waitForTimeout(500) }
      }
      await win.waitForURL('**/ui/' + scheme + '/index.html')
      await win.waitForSelector('#input')
    }
    await win.waitForURL('**/ui/' + scheme + '/index.html')
    await win.waitForSelector('#input')
    await win.waitForLoadState('domcontentloaded').catch(() => {})
    await win.evaluate(() => localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ skipSplash: true, theme: 'dark', palette: 'classic' })))
    await win.reload()
    await win.waitForURL('**/ui/' + scheme + '/index.html')
    await win.waitForSelector('#btn-kernel-hub')
    await win.waitForTimeout(1500)
    assert.equal(await win.evaluate(() => window.api.uiScheme()), scheme)
    await win.click('#btn-kernel-hub')
    await win.click('#btn-kernel-library')
    await win.waitForFunction(() => document.querySelectorAll('.kernel-card').length >= 2)

    // 时钟冻结后打开源码，并开始键盘输入；旧逻辑的 30ms 聚焦必须不能抢走输入。
    await win.clock.install()
    await win.clock.pauseAt(new Date(Date.now() + 1000))
    await win.click('#btn-kernel-new')
    if (scheme === 'proto') await win.click('#btn-kernel-source')
    await win.waitForSelector('#kernel-edit-name', { state: 'visible' })
    await win.locator('#kernel-edit-name').focus()
    await win.keyboard.insertText('确定性名称')
    result.beforeTimers = await win.evaluate(() => ({ active: document.activeElement.id, name: document.querySelector('#kernel-edit-name').value }))
    await win.clock.runFor(60)
    await win.keyboard.insertText('-连续输入')
    result.afterTimers = await win.evaluate(() => ({ active: document.activeElement.id, name: document.querySelector('#kernel-edit-name').value }))
    assert.deepEqual(result.beforeTimers, { active: 'kernel-edit-name', name: '确定性名称' })
    assert.deepEqual(result.afterTimers, { active: 'kernel-edit-name', name: '确定性名称-连续输入' }, '旧聚焦定时器不得抢走用户已开始的名称输入')
    await win.clock.resume()
    await win.fill('#kernel-edit-text', text)
    await saveAndRead('确定性名称-连续输入')

    // 真实时钟连续快速填写：不加等待、不 force、不通过 IPC 代替保存按钮。
    for (let i = 0; i < 8; i++) {
      await win.click('#btn-kernel-source-done')
      await win.click('#btn-kernel-library')
      await win.click('#btn-kernel-new')
      if (scheme === 'proto') await win.click('#btn-kernel-source')
      const name = scheme + '-连续保存-' + i
      await win.fill('#kernel-edit-name', name)
      assert.equal(await win.locator('#kernel-edit-name').inputValue(), name, '名称 fill 后必须留在名称字段')
      await win.fill('#kernel-edit-text', text)
      assert.equal(await win.locator('#kernel-edit-name').inputValue(), name, '正文填写不能改变名称')
      await saveAndRead(name)
    }
    await win.screenshot({ path: path.join(base, 'saved.png') })
    await app.close()
    app = await launch()
    win = await app.firstWindow()
    watch(win)
    await win.waitForURL('**/ui/' + scheme + '/index.html')
    await win.waitForSelector('#btn-kernel-hub')
    assert.equal(await win.evaluate(() => window.api.uiScheme()), scheme, '重启后不能再次切换来掩盖方案持久化失败')
    for (const item of result.saved) {
      const read = await win.evaluate((id) => window.api.kernelLibRead(id), item.id)
      assert.equal(read.ok, true)
      assert.equal(read.name, item.name)
      assert.equal(read.text, text)
    }
    assert.deepEqual(result.errors, [])
    result.status = 'passed'
    console.log('PASS ' + scheme + ': 确定性焦点 + 8 次快速保存 + 9 个内核重启回读')
  } catch (error) {
    result.status = 'failed'
    result.error = error.stack
    console.error('FAIL ' + scheme + ': ' + error.message)
    if (win) {
      try { await win.screenshot({ path: path.join(base, 'failure.png') }) } catch {}
    }
  } finally {
    if (app) { try { await app.close() } catch {} }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ out, results }, null, 2), 'utf8')
  }

  async function saveAndRead(name) {
    await win.click('#btn-kernel-source-save')
    await win.waitForFunction(() => document.querySelector('#kernel-save-state').textContent === '已保存', null, { timeout: 10000 })
    const list = await win.evaluate(() => window.api.kernelLibList())
    assert.equal(list.ok, true)
    const matches = list.kernels.filter((item) => item.source === 'user' && item.name === name)
    assert.equal(matches.length, 1, '一次保存只能创建一个同名内核')
    const read = await win.evaluate((id) => window.api.kernelLibRead(id), matches[0].id)
    assert.equal(read.ok, true)
    assert.equal(read.name, name)
    assert.equal(read.text, text)
    result.saved.push({ id: matches[0].id, name })
  }
}

async function main() {
  console.log('内核焦点回归工件：' + out)
  for (const scheme of ['classic', 'proto', 'd']) await runScheme(scheme)
  process.exitCode = results.every((item) => item.status === 'passed') ? 0 : 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
