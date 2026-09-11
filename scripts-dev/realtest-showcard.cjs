/* 给用户看真实测试卡：沙盒实例 + 查看器窗口，保留到用户手动关闭（关掉查看器即全部退出） */
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const SANDBOX_APPDATA = path.join(ROOT, 'test-shots', 'realtest-appdata')

async function main() {
  const cardDir = path.join(SANDBOX_APPDATA, '六面世界', 'holo-cards')
  const cards = fs.readdirSync(cardDir).filter((d) => /^card-/.test(d))
  if (!cards.length) throw new Error('沙盒内没有已生成的卡')
  const cardId = cards[0]
  console.log('[showcard] 卡：', cardId)

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [path.join(__dirname, 'realtest-entry.cjs')], cwd: ROOT,
    env: { ...process.env, APPDATA: SANDBOX_APPDATA, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(4000)
  await win.locator('#splash').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})

  const r = await win.evaluate(async (cid) => window.api.cardWindow({ cardId: cid }), cardId).catch((e) => ({ err: String(e) }))
  if (!r || !r.ok) throw new Error('cardWindow 失败：' + JSON.stringify(r))

  let viewer = null
  for (let i = 0; i < 60; i++) {
    viewer = app.windows().find((w) => w.url().includes('holo/viewer'))
    if (viewer) break
    await new Promise((s) => setTimeout(s, 250))
  }
  if (!viewer) throw new Error('查看器未出现')

  // 前置查看器；关闭主窗口（用户关掉查看器 → 全部实例自动退出，不留后台进程）
  await viewer.evaluate(() => { window.focus() }).catch(() => {})
  await win.close().catch(() => {})
  await new Promise((s) => setTimeout(s, 800))
  await viewer.bringToFront().catch(() => {})

  console.log('[showcard] 查看器已打开并置前。用户关闭查看器窗口后进程自动退出。')
  console.log('[showcard] 交互提示：拖拽旋转 / 视角流光 / 底部按钮翻面与自动旋转。')

  // 挂着等用户关窗（viewer 关闭 → window-all-closed → app 退出 → 本脚本自然结束）
  await new Promise((resolve) => {
    app.on('close', resolve)
    setTimeout(resolve, 30 * 60 * 1000) // 30 分钟兜底
  })
  await app.close().catch(() => {})
  process.exit(0)
}

main().catch((e) => { console.error('[showcard] FATAL', e); process.exit(2) })
