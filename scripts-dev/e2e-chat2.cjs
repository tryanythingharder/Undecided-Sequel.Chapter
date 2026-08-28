const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

const BASE = process.env.CHAT_BASE || ''
const KEY = process.env.CHAT_KEY || ''
const MODEL = process.env.CHAT_MODEL || 'deepseek-v4-flash'

async function waitAssistant(win, label, ms) {
  for (let i = 0; i < Math.ceil(ms / 2000); i++) {
    const texts = await win.locator('.msg.assistant .msg-body').allTextContents().catch(() => [])
    if (texts.length > 0 && texts[texts.length - 1].trim().length > 4 && !texts[texts.length - 1].includes('正在运转')) {
      return texts[texts.length - 1]
    }
    await win.waitForTimeout(2000)
  }
  return null
}

async function main() {
  if (!BASE || !KEY) { console.log('SKIP'); return 0 }
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(2000)

  // configure provider (settings in separate window)
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
  await sw.fill('#set-model', MODEL)
  await sw.fill('#set-temperature', '0.7')
  await sw.click('#btn-save-settings')
  await win.waitForTimeout(600)

  // turn 1: start
  await win.click('.empty .primary')
  const r1 = await waitAssistant(win, 'turn1', 150000)
  if (!r1) { console.log('FAIL turn1 no reply'); await app.close(); return 2 }
  const choiceCount1 = await win.locator('.choice').count()
  console.log('PASS turn1-reply', '(len=' + r1.length + ')')
  console.log('PASS turn1-choices', choiceCount1, 'choice buttons')
  const firstChoiceText = choiceCount1 > 0 ? (await win.locator('.choice').first().textContent()) : ''
  console.log('PASS first-choice-label', JSON.stringify((firstChoiceText || '').slice(0, 60)))

  // turn 2: if choices exist, click first; else send text
  if (choiceCount1 > 0) {
    await win.locator('.choice').first().click()
  } else {
    await win.fill('#input', '我是本地农户家的孩子，名叫雷恩。')
    await win.click('#btn-send')
  }
  const r2 = await waitAssistant(win, 'turn2', 150000)
  if (!r2) { console.log('FAIL turn2 no reply'); await app.close(); return 3 }
  const userCount = await win.locator('.msg.user').count()
  const choiceCount2 = await win.locator('.choice').count()
  console.log('PASS turn2-reply', '(len=' + r2.length + ')')
  console.log('PASS user-messages', userCount)
  console.log('PASS turn2-choices', choiceCount2, 'choice buttons')

  await win.screenshot({ path: path.join(__dirname, 'shot-chat2.png') })
  console.log('--- turn2 preview (first 260) ---')
  console.log(r2.slice(0, 260).replace(/\n/g, ' '))
  await app.close()
  return 0
}

main().then((c) => process.exit(c)).catch((e) => { console.error('FAIL', e); process.exit(1) })
