// 验证 R5 修改（CDP 模式，绕过沙箱 pipe 限制）：
// 1) btn-new 文案「新世界线」 2) 默认占位 3) 有选项时占位切换 4) 截图
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })

const fails = []
const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

async function main() {
  // 应用由外部（PowerShell Start-Process）以 --remote-debugging-port 启动；本脚本仅连接
  try {
    let browser = null
    for (let i = 0; i < 40 && !browser; i++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT) } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    if (!browser) throw new Error('CDP connect failed')
    let win = null
    for (let i = 0; i < 40 && !win; i++) {
      for (const ctx of browser.contexts()) {
        const p = ctx.pages().find((x) => x.url().includes('index.html'))
        if (p) win = p
      }
      if (!win) await new Promise((r) => setTimeout(r, 250))
    }
    await win.setViewportSize({ width: 1440, height: 900 })
    await win.evaluate(() => localStorage.clear())
    await win.reload(); await win.waitForTimeout(1800)

    check('btn-new-label', (await win.locator('#btn-new').textContent()) === '新世界线')
    const ph0 = await win.locator('#input').getAttribute('placeholder')
    check('placeholder-default', ph0 === '自由描述你的行动…（Enter 发送 · Shift+Enter 换行）', ph0)
    await win.screenshot({ path: path.join(OUT, 'r5-01-empty-newlabels.png') })

    // 注入含选项的会话 → 占位应切换
    await win.evaluate(() => {
      localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
        id: 'v5', title: '占位验证线', createdAt: Date.now(), updatedAt: Date.now(),
        messages: [
          { role: 'user', content: '开始' },
          { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n你醒了。\n\n【你需要决定】\n\n【A】出门探索【B】再睡一会' },
        ],
      }]))
    })
    await win.reload(); await win.waitForTimeout(1800)
    const ph1 = await win.locator('#input').getAttribute('placeholder')
    check('placeholder-choices', ph1 === '点选上方选项直接行动，或在此自由描述…（Enter 发送）', ph1)
    check('choice-cards', (await win.locator('.choice').count()) >= 2)
    await win.screenshot({ path: path.join(OUT, 'r5-02-choices-placeholder.png') })
  } finally { /* 进程由调用方回收 */ }
  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })
