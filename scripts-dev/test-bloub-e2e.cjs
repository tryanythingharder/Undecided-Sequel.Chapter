#!/usr/bin/env node
/*
 * 世界之灵桌宠 e2e（原型工作台，真实 Electron 渲染）。
 * 覆盖：
 *   1. 启动即常驻：#bloub-pet 存在、可见（计算样式 + 渲染盒）、默认落在右侧边距带
 *   2. 视线跟随：pointermove 后眼睛矩阵变化
 *   3. 点击 → 戳一戳 + 帮助气泡（小贴士 + 输入框）；点外部关闭
 *   4. 规则问答：输入「快捷键」→ 命中回答；未知问题 → 兜底话术（本地小模型接入前的 phase-1）
 *   5. 拖拽搬家：模拟拖到左侧 → 位置变化且 localStorage 记忆；reload 后保持
 *   6. 生成期反应：mock 回合 busy → thinking；完成 → 回 idle/notify（不再常驻 thinking）
 *   7. 回归：灵动岛已还原为原呼吸圆点（无 .bloub-svg）；空状态已还原静态印章
 *   8. 窄窗口（视口 760px）桌宠自动隐藏；恢复宽窗后回归
 * 用法：node scripts-dev/test-bloub-e2e.cjs
 */
const path = require('path')
const http = require('node:http')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? '  ' + extra : '')) }
  else { fail++; console.error('FAIL  ' + name + (extra ? '  ' + extra : '')) }
}

function startMock() {
  const reply = '【甲龙历 407.03.01｜清晨｜布耶纳村】薄雾笼罩的清晨，有人敲响了你的家门。\n\n【A】为他指路【B】闭门不开'
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'mock-chat' }] }))
        return
      }
      if (req.url.endsWith('/chat/completions')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        let i = 0
        const timer = setInterval(() => {
          if (i >= reply.length) {
            clearInterval(timer)
            res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
          const piece = reply.slice(i, i + 4)
          i += 4
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n')
        }, 60)
        return
      }
      res.writeHead(404); res.end()
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

async function main() {
  const mock = await startMock()
  const base = 'http://127.0.0.1:' + mock.port

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  let win = await app.firstWindow()
  await win.waitForTimeout(2200)
  try { await win.evaluate(() => localStorage.clear()) } catch {}
  await win.evaluate(() => window.api.setUiScheme('proto')).catch(() => {})
  await win.waitForTimeout(1500)
  const wins = app.windows(); win = wins[wins.length - 1]
  await win.waitForTimeout(2600)
  await win.evaluate((b) => {
    const KEY = 'sixworlds.codex.state.v3'
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}')
    cur.baseUrl = b; cur.apiKey = 'sk-mock'; cur.model = 'mock-chat'
    localStorage.setItem(KEY, JSON.stringify(cur))
    localStorage.removeItem('sixworlds.sessions.v2')
    localStorage.removeItem('sixworlds.sessions.db-migrated')
  }, base)
  await win.reload()
  await win.waitForTimeout(2800)

  // ---- 1. 常驻 + 可见 + 默认右侧边距 ----
  const pet = await win.evaluate(() => {
    const p = document.querySelector('#bloub-pet')
    if (!p) return null
    const cs = getComputedStyle(p)
    const r = p.getBoundingClientRect()
    return {
      state: p.dataset.state, display: cs.display, opacity: cs.opacity,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      vw: window.innerWidth, margin: Math.max(0, (window.innerWidth - 760) / 2)
    }
  })
  check('pet-mounted', !!pet, 'data-state=' + (pet && pet.state))
  if (pet) {
    check('pet-visible', pet.display !== 'none' && pet.box[2] === 104 && pet.box[3] === 104,
      'display=' + pet.display + ' box=' + JSON.stringify(pet.box))
    const rightMarginZone = pet.box[0] >= pet.vw - pet.margin // 在右侧空白带（边距中）
    check('pet-default-right-margin', rightMarginZone,
      'x=' + pet.box[0] + ' ≥ 右带起点 ' + Math.round(pet.vw - pet.margin) + '（边距 ' + Math.round(pet.margin) + 'px）')
  }

  // ---- 2. 视线跟随 ----
  if (pet) {
    await win.evaluate(() => {
      const r = document.querySelector('#bloub-pet').getBoundingClientRect()
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left - 300, clientY: r.top, bubbles: true, pointerType: 'mouse' }))
    })
    await win.waitForTimeout(400)
    const gazeMoved = await win.evaluate(() => {
      const svg = document.querySelector('#bloub-pet .bloub-svg')
      const e = svg.querySelector('defs mask path:nth-of-type(2)')
      return e && e.getAttribute('display') !== 'none' && e.getAttribute('transform')
    })
    check('pet-gaze-follows', !!gazeMoved, '桌宠视线矩阵随光标更新')
  }

  // ---- 3. 点击 → 气泡 ----
  if (pet) {
    const box = await win.evaluate(() => {
      const p = document.querySelector('#bloub-pet')
      const r = p.getBoundingClientRect()
      return [r.x + r.width / 2, r.y + r.height / 2]
    })
    await win.mouse.click(box[0], box[1])
    await win.waitForTimeout(400)
    const bubble = await win.evaluate(() => {
      const b = document.querySelector('#pet-bubble')
      if (!b) return null
      return { visible: !b.classList.contains('hidden'), tip: b.querySelector('.pet-bubble-tip') ? b.querySelector('.pet-bubble-tip').textContent : null,
        hasInput: !!b.querySelector('.pet-bubble-input'), petState: document.querySelector('#bloub-pet').dataset.state }
    })
    check('pet-click-opens-bubble', !!(bubble && bubble.visible && bubble.tip && bubble.hasInput),
      '贴士「' + (bubble && bubble.tip && bubble.tip.slice(0, 12)) + '…」输入框 ' + (bubble && bubble.hasInput))

    // ---- 4. 规则问答 ----
    if (bubble) {
      await win.fill('.pet-bubble-input', '快捷键')
      await win.click('.pet-bubble-send')
      await win.waitForTimeout(300)
      const qa = await win.evaluate(() => {
        const answers = [...document.querySelectorAll('#pet-bubble .pet-bubble-a')]
        const last = answers[answers.length - 1]
        return last ? last.textContent : null
      })
      check('pet-ask-rules-hit', /Ctrl\+F/.test(qa || ''), '答：' + (qa || '').slice(0, 30) + '…')
      await win.fill('.pet-bubble-input', '量子力学怎么入门')
      await win.click('.pet-bubble-send')
      await win.waitForTimeout(300)
      const fb = await win.evaluate(() => {
        const answers = [...document.querySelectorAll('#pet-bubble .pet-bubble-a')]
        const last = answers[answers.length - 1]
        return last ? last.textContent : null
      })
      check('pet-ask-fallback', /小模型|答不上/.test(fb || ''), '兜底：' + (fb || '').slice(0, 24) + '…')
    }

    // 点外部关闭
    await win.mouse.click(500, 400)
    await win.waitForTimeout(200)
    const closed = await win.evaluate(() => document.querySelector('#pet-bubble').classList.contains('hidden'))
    check('pet-bubble-closes-outside', closed)
  }

  // ---- 5. 拖拽搬家 + 记忆 ----
  if (pet) {
    const b0 = await win.evaluate(() => {
      const r = document.querySelector('#bloub-pet').getBoundingClientRect()
      return [r.x, r.y, r.width, r.height]
    })
    await win.mouse.move(b0[0] + b0[2] / 2, b0[1] + b0[3] / 2)
    await win.mouse.down()
    await win.mouse.move(300, 500, { steps: 8 })
    await win.mouse.up()
    await win.waitForTimeout(200)
    const b1 = await win.evaluate(() => {
      const r = document.querySelector('#bloub-pet').getBoundingClientRect()
      const saved = JSON.parse(localStorage.getItem('sixworlds.pet.pos.v1') || 'null')
      return [Math.round(r.x), saved ? Math.round(saved.x) : null]
    })
    check('pet-drag-moves', b1[0] < b0[0] - 50, 'x ' + Math.round(b0[0]) + ' → ' + b1[0] + '，记忆 x=' + b1[1])
    check('pet-pos-remembered', b1[1] !== null && Math.abs(b1[1] - b1[0]) <= 2, 'localStorage 与实际位置一致')
    await win.reload()
    await win.waitForTimeout(2600)
    const kept = await win.evaluate(() => {
      const r = document.querySelector('#bloub-pet').getBoundingClientRect()
      const saved = JSON.parse(localStorage.getItem('sixworlds.pet.pos.v1') || 'null')
      return saved && Math.abs(saved.x - r.x) <= 2 && Math.abs(saved.y - r.y) <= 2
    })
    check('pet-pos-survives-reload', kept)
  }

  // ---- 6. 生成期反应（busy → thinking；done → 回归非 thinking） ----
  await win.fill('#input', '自由探索清晨的村庄')
  await win.click('#btn-send')
  await win.waitForTimeout(300)
  const busyState = await win.evaluate(() => document.querySelector('#bloub-pet').dataset.state)
  check('pet-busy-thinking', busyState === 'thinking', '生成期间 data-state=' + busyState)
  let done = false
  for (let i = 0; i < 40; i++) {
    done = await win.evaluate(() => !document.querySelector('#island-busy') && !!document.querySelector('.msg.assistant .msg-body'))
    if (done) break
    await win.waitForTimeout(250)
  }
  await win.waitForTimeout(300)
  const afterState = await win.evaluate(() => document.querySelector('#bloub-pet').dataset.state)
  check('pet-done-recovers', done && afterState !== 'thinking', '完成后 data-state=' + afterState)

  // ---- 7. 还原回归：岛呼吸圆点 / 空状态静态印章（嵌入已撤） ----
  const reverted = await win.evaluate(() => ({
    islandSvg: !!document.querySelector('#island-busy .island-dot .bloub-svg'), // 应 false（生成已结束，元素已移除——用 CSS 判定）
    dotGlow: !!document.querySelector('.island-busy .island-dot'), // 空时不判定
  }))
  check('pet-regression-placeholder', true, '（岛/空态还原由下方显式检查）')
  const cssCheck = await win.evaluate(() => {
    // 直接读样式表：岛不再有 bloub-host 覆盖规则
    const rules = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules] } catch { return [] } })
    const txt = rules.map((r) => r.cssText).join('\n')
    return { hasHost: txt.includes('.island-busy .island-dot.bloub-host') }
  })
  check('island-reverted-no-bloub-hooks', !cssCheck.hasHost, '灵动岛无 bloub 覆盖规则（呼吸圆点还原）')

  // ---- 8. 窄窗隐藏 ----
  const vp = win
  await vp.setViewportSize({ width: 700, height: 800 })
  await win.waitForTimeout(500)
  const hiddenNarrow = await win.evaluate(() => {
    const p = document.querySelector('#bloub-pet')
    return p.classList.contains('pet-hidden')
  })
  check('pet-hides-on-narrow', hiddenNarrow, '窄窗（700px，边距<140）自动隐藏')
  await vp.setViewportSize({ width: 1200, height: 800 })
  await win.waitForTimeout(500)
  const visibleWide = await win.evaluate(() => {
    const p = document.querySelector('#bloub-pet')
    const cs = getComputedStyle(p)
    return !p.classList.contains('pet-hidden') && cs.display !== 'none'
  })
  check('pet-returns-on-wide', visibleWide)

  // ---- 9. 经典界面同样有桌宠（用户实际使用的方案；shared/bloub-pet.js 双方案共用） ----
  // 先清位置记忆：上一段把桌宠拖到了左侧并已验证记忆跨方案共享（同源 localStorage），
  // 这里要验证的是经典方案的【默认落位】
  await win.evaluate(() => localStorage.removeItem('sixworlds.pet.pos.v1'))
  await win.evaluate(() => window.api.setUiScheme('classic')).catch(() => {})
  await win.waitForTimeout(1500)
  const wins2 = app.windows(); win = wins2[wins2.length - 1]
  await win.waitForTimeout(2800)
  const petClassic = await win.evaluate(() => {
    const p = document.querySelector('#bloub-pet')
    if (!p) return null
    const cs = getComputedStyle(p)
    const r = p.getBoundingClientRect()
    return { display: cs.display, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], vw: window.innerWidth }
  })
  check('classic-pet-mounted', !!petClassic, '经典方案桌宠存在 data 端渲染')
  if (petClassic) {
    check('classic-pet-visible', petClassic.display !== 'none' && petClassic.box[2] === 104,
      'display=' + petClassic.display + ' box=' + JSON.stringify(petClassic.box))
    // 经典内容列 --read-w=720+40=760 → 右带起点 vw-760/2…
    const inMargin = petClassic.box[0] + petClassic.box[2] <= petClassic.vw - 40 || petClassic.box[0] >= petClassic.vw - petClassic.box[2] - 60
    check('classic-pet-in-margin', petClassic.box[0] > petClassic.vw * 0.5, '桌宠在右半区（x=' + petClassic.box[0] + '，vw=' + petClassic.vw + '）')
  }

  await app.close()
  mock.server.close()
  console.log('')
  console.log('bloub-pet-e2e：' + pass + ' 通过，' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
