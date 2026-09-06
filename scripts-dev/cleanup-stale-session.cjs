'use strict'
/* 一次性清理：删除中止马拉松遗留的测试会话（真实 userData），并实测级联清理（R85 修复 2） */
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')

async function main() {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(3200)
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(1200)
  const storyDir = process.env.APPDATA + '/六面世界/story-engine/stories'
  const before = await win.evaluate(() => document.querySelectorAll('.session-item').length)
  const storiesBefore = fs.readdirSync(storyDir).filter(f => f.endsWith('.json') && !f.endsWith('.meta.json'))
  // 找到测试会话（title 新世界线，id smtpy5y84）
  const item = win.locator('.session-item[data-sid="smtpy5y84"]')
  const found = await item.count()
  console.log('会话 before:', before, '· 找到测试会话:', found, '· 引擎故事 before:', storiesBefore.length)
  if (!found) { console.log('无需清理'); await app.close(); process.exit(0) }
  await item.locator('.session-del').click()
  await win.waitForTimeout(400)
  const cv = await win.locator('.confirm-mask').isVisible().catch(() => false)
  if (cv) await win.locator('.confirm-mask .confirm-foot button').last().click()
  await win.waitForTimeout(2000)
  const after = await win.evaluate(() => document.querySelectorAll('.session-item').length)
  const storiesAfter = fs.readdirSync(storyDir).filter(f => f.endsWith('.json') && !f.endsWith('.meta.json'))
  const pend = fs.readdirSync(process.env.APPDATA + '/六面世界/story-engine/pendings')
  console.log('会话 after:', after, (after === before - 1 ? '✓' : '✗'))
  console.log('引擎故事 after:', storiesAfter.length, (storiesAfter.length === storiesBefore.length - 1 ? '✓ 级联清理生效' : '✗'), '·', storiesAfter.join(','))
  console.log('剩余 pendings:', pend.length, '·', pend.join(' '))
  await app.close().catch(() => {})
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
