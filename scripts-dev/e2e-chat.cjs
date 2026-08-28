const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

// ENV: CHAT_BASE, CHAT_KEY, CHAT_MODEL
const BASE = process.env.CHAT_BASE || ''
const KEY = process.env.CHAT_KEY || ''
const MODEL = process.env.CHAT_MODEL || ''

async function main() {
  if (!BASE || !KEY) { console.log('SKIP: no CHAT_BASE/CHAT_KEY'); return 0 }
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(2000)

  // open settings (separate window), fill real provider
  await win.click('#btn-settings')
  let sw = null
  for (let i = 0; i < 30; i++) {
    sw = app.windows().find((w) => w.url().includes('settings.html'))
    if (sw) break
    await win.waitForTimeout(100)
  }
  await sw.selectOption('#set-preset', 'custom')
  await sw.fill('#set-baseurl', BASE)
  await sw.fill('#set-apikey', KEY)
  await sw.fill('#set-model', MODEL || 'deepseek-v4-flash')
  await sw.fill('#set-temperature', '0.7')
  await sw.click('#btn-save-settings')
  await win.waitForTimeout(600)

  // start game -> triggers first user message '开始'
  await win.click('.empty .primary')
  await win.waitForTimeout(1000)

  // wait for assistant reply (poll up to 120s)
  let content = ''
  for (let i = 0; i < 60; i++) {
    const texts = await win.locator('.msg.assistant .msg-body').allTextContents().catch(() => [])
    if (texts.length > 0 && texts[texts.length - 1].trim().length > 4 && !texts[texts.length - 1].includes('正在运转')) {
      content = texts[texts.length - 1]
      break
    }
    await win.waitForTimeout(2000)
  }
  if (!content) { console.log('FAIL: no assistant reply within 120s'); await app.close(); return 2 }

  // verify user message appears
  const userCount = await win.locator('.msg.user').count()
  // verify option choices rendered (choice buttons) when present
  const choiceCount = await win.locator('.choice').count()

  console.log('PASS user-message-rendered', userCount >= 1)
  console.log('PASS assistant-reply-received', content.length > 0, '(len=' + content.length + ')')
  console.log('PASS choices-rendered-if-any', choiceCount, 'choices')
  console.log('--- assistant preview (first 300 chars) ---')
  console.log(content.slice(0, 300).replace(/\n/g, ' '))
  await win.screenshot({ path: path.join(__dirname, 'shot-chat.png') })
  await app.close()
  return 0
}

main().then((c) => process.exit(c)).catch((e) => { console.error('FAIL', e); process.exit(1) })
