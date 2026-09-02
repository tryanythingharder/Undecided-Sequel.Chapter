'use strict'
/* 前端大历史性能基准（Chat History Performance · 规范一/五/三十九）
 * 向 localStorage 注入 5000 条消息的会话，真实启动 Electron，测量：
 *   boot_ms        启动到世界线列表可交互
 *   dom_msgs       聊天 DOM 中的消息节点数（应为有界窗口，而非全部历史）
 *   switch_ms      切换到 5000 条消息的世界线的渲染耗时
 *   send_ms        真实发送一回合的 UI 侧耗时（mock LLM 即时回复，剥离网络）
 *   save_ms        localStorage 全量会话保存耗时（注入前单测一次等规模写入）
 * 运行：node scripts-dev/bench-fe.cjs [消息数=5000]
 */
const path = require('node:path')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const N = Number(process.argv[2]) || 5000

function msgText(i, role) {
  const who = role === 'user' ? '凯岩' : '世界'
  return '【玄历 1024.05.' + (1 + (i % 28)) + '｜' + ['晨', '午', '黄昏', '夜'][i % 4] + '｜临水镇】\n' +
    who + '的第' + i + '条记录：河湾码头的货栈又进了一批铁矿，林晚说漕运公所的船期提前了三天，' +
    '赵石主张先把旧账结清再谈新单，阿萝在旁边把账目抄成了两份，一份给商会一份留档备查。' +
    '（此处为基准填充文本，用于测量渲染与持久化开销，共约两百字。）'.repeat(2)
}

async function main() {
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1200)
  await win.evaluate(() => localStorage.clear())

  /* 注入 3 条世界线：A 空、B 5000 条、C 2000 条 */
  const payload = await win.evaluate(({ n }) => {
    const mk = (id, title, count, offset) => {
      const messages = []
      for (let i = 0; i < count; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant'
        messages.push({ role, content: '【基准消息】', at: Date.now() - (count - i) * 60000 })
        messages[messages.length - 1].content = (role === 'user' ? '我去河湾码头找林晚谈铁矿的生意，顺便结清旧账。#MS' + (offset + i) : '')
        if (role === 'assistant') messages[messages.length - 1].content = worldText(offset + i)
      }
      return { id, title, ws: (window.__ws0 = window.__ws0 || 'ws-x', window.__ws0), createdAt: Date.now(), updatedAt: Date.now(), messages, tokens: { prompt: 1, completion: 1, total: count * 100 } }
    }
    function worldText(i) {
      return '【玄历 1024.05.' + (1 + (i % 28)) + '｜' + ['晨', '午', '黄昏', '夜'][i % 4] + '｜临水镇】\n世界的第' + i + '条回应：河湾码头的货栈又进了一批铁矿，林晚说漕运公所的船期提前了三天，赵石主张先把旧账结清再谈新单，阿萝在旁边把账目抄成了两份，一份给商会一份留档备查。（基准填充文本约两百字，用于测量渲染与持久化开销。）'.repeat(2)
    }
    const sessions = [mk('bA', '空线', 0, 0), mk('bB', '五千条线', n, 0), mk('bC', '两千条线', Math.floor(n / 2.5), n)]
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([{ id: 'ws-x', name: '基准世界' }]))
    const t0 = performance.now()
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify(sessions))
    const saveMs = performance.now() - t0
    const bytes = localStorage.getItem('sixworlds.sessions.v2').length
    return { saveMs, mb: Number((bytes / 1048576).toFixed(2)) }
  }, { n: N })
  console.log('注入 ' + N + ' 条消息 · localStorage 全量写入 ' + payload.saveMs.toFixed(1) + 'ms · 体积 ' + payload.mb + 'MB')

  /* 真实重启加载（大历史 boot） */
  const boot0 = Date.now()
  await win.reload()
  await win.waitForSelector('.session-item', { timeout: 30000 })
  const bootMs = Date.now() - boot0
  await win.waitForTimeout(400)
  const domMsgs = await win.locator('.msg').count()
  console.log('boot(打开故事): ' + bootMs + 'ms · 初始 DOM 消息节点: ' + domMsgs)

  /* 切换到 5000 条的世界线 */
  const t1 = Date.now()
  await win.locator('.session-item', { hasText: '五千条线' }).first().click()
  await win.waitForTimeout(120)
  const switchMs = Date.now() - t1
  const domAfterSwitch = await win.locator('.msg').count()
  console.log('切换世界线(5000条): ' + switchMs + 'ms · DOM 消息节点: ' + domAfterSwitch)

  /* 真实发送一回合（mock LLM 即时 JSON 回复，剥离网络流时间） */
  const http = require('node:http')
  const mock = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => {
      if (String(req.url).endsWith('/chat/completions')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '【玄历 1024.05.28｜夜｜临水镇】\n基准回复：账目两讫，船期照旧。\n<<<NO_STATE_CHANGE>>>' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      } else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}') }
    })
  })
  await new Promise((r) => mock.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + mock.address().port
  await win.click('#btn-settings')
  for (let i = 0; i < 30; i++) { const ws = app.windows(); if (ws.find((w) => w.url().includes('settings.html'))) break; await win.waitForTimeout(100) }
  const sw = app.windows().find((w) => w.url().includes('settings.html'))
  await sw.selectOption('#set-preset', 'custom')
  await sw.fill('#set-baseurl', base)
  await sw.fill('#set-apikey', 'sk-mock')
  await sw.fill('#set-model', 'mock-chat')
  await sw.click('#btn-save-settings')
  await win.waitForTimeout(400)

  const sendTimes = []
  for (let k = 0; k < 3; k++) {
    const t0 = Date.now()
    await win.fill('#input', '基准发送第' + k + '回合：继续在街市走动。')
    await win.click('#btn-send')
    // 等回复出现且不再 busy
    for (let i = 0; i < 200; i++) {
      const busy = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop')).catch(() => true)
      if (!busy) break
      await win.waitForTimeout(50)
    }
    await win.waitForTimeout(200)
    sendTimes.push(Date.now() - t0)
  }
  console.log('发送回合(5000条历史下) 3 次: ' + sendTimes.map((x) => x + 'ms').join(' / '))
  const domFinal = await win.locator('.msg').count()
  console.log('发送后 DOM 消息节点: ' + domFinal)

  await app.close()
  mock.close()
  console.log('FE_BASELINE_JSON ' + JSON.stringify({ n: N, storage_mb: payload.mb, save_ms: Number(payload.saveMs.toFixed(1)), boot_ms: bootMs, dom_msgs_initial: domMsgs, switch_ms: switchMs, dom_after_switch: domAfterSwitch, send_ms: sendTimes, dom_final: domFinal }))
}

main().catch((e) => { console.error('BENCH-FE-FAIL', e); process.exit(1) })
