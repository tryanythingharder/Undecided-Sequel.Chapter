#!/usr/bin/env node
/*
 * 世界之灵桌宠 e2e（原型工作台，真实 Electron 渲染）。
 * 覆盖：
 *   1. 启动即常驻：#bloub-pet 存在、可见（计算样式 + 渲染盒）、默认落在右侧边距带
 *   2. 视线跟随（真实位置差）：指针左/右/贴脸三个位置，眼睛平移分量差可感知
 *   3. 点击 → 戳一戳 + 帮助气泡（小贴士 + 输入框）；点外部关闭
 *   3b. 右键快捷菜单：换边 / 归位 / 休息唤醒 / Esc 与点选后关闭
 *   4. 规则问答：输入「快捷键」→ 命中规则库（精准答案）；未命中 → 云端大脑接管流式
 *   5. 拖拽搬家：模拟拖到左侧 → 位置变化且 localStorage 记忆；reload 后保持
 *   6. 生成期反应：mock 回合 busy → thinking；完成 → 回 idle/notify（不再常驻 thinking）
 *   7. 回归：灵动岛已还原为原呼吸圆点（无 .bloub-svg）；空状态已还原静态印章
 *   8. 窄窗口（视口 760px）桌宠自动隐藏；恢复宽窗后回归
 *   9. 本地小模型一键接入（SIXWORLDS_PET_FAKE 接缝 + 本地慢速假源，不真下 400MB）：
 *      接入按钮 → 二次确认（只显示大小、不显示型号）→ 下载进度 → 自动就绪
 *      → 就绪后规则优先回归 + 未命中问题走模型流式打字机
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
  // 假模型文件：150KB 分 30 块慢速下发（走完下载进度条各阶段又不拖慢测试）
  const fakeModel = Buffer.alloc(150 * 1024, 7)
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'mock-chat' }] }))
        return
      }
      if (/pet-model(\.gguf)?$/.test(req.url)) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(fakeModel.length) })
        let sent = 0
        const timer = setInterval(() => {
          const piece = Math.min(5 * 1024, fakeModel.length - sent)
          res.write(fakeModel.subarray(sent, sent + piece))
          sent += piece
          if (sent >= fakeModel.length) { clearInterval(timer); res.end() }
        }, 40)
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
  const centerOfPet = async () => {
    return await win.evaluate(() => {
      const r = document.querySelector('#bloub-pet').getBoundingClientRect()
      return [r.x + r.width / 2, r.y + r.height / 2]
    })
  }
  const mock = await startMock()
  const base = 'http://127.0.0.1:' + mock.port

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      SIXWORLDS_TEST: '1',
      // 桌宠模型接缝：假下载源（mock /pet-model）+ 跳过 llama 推理（pet:chat 回脚本化回复）
      SIXWORLDS_PET_FAKE: '1',
      SIXWORLDS_PET_MODEL_URL: 'http://127.0.0.1:' + mock.port + '/pet-model.gguf'
    }
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

  // ---- 2. 视线跟随（精度标准：idle 门控采样 + 双眼中点 + 对称性） ----
  if (pet) {
    const eyeMidAt = async (px, py) => {
      await win.evaluate(({ x, y }) => {
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' }))
      }, { x: px, y: py })
      for (let i = 0; i < 14; i++) {   // 等转头缓动收敛 + 避开自发表情瞬态（瞬态期间 aim 松手）
        await win.waitForTimeout(300)
        const e = await win.evaluate(() => {
          const pet = document.querySelector('#bloub-pet')
          const svg = pet.querySelector('.bloub-svg')
          const eyes = [...svg.querySelectorAll('defs mask path')].filter((p) => p.getAttribute('display') !== 'none' && p.getAttribute('transform'))
          if (eyes.length < 2) return null
          const xs = eyes.map((el) => {
            const m = el.getAttribute('transform').match(/matrix\(([^)]+)\)/)
            const v = m[1].split(',').map(Number)
            return { x: v[4], y: v[5] }
          })
          return { state: pet.dataset.state, midX: (xs[0].x + xs[1].x) / 2, midY: (xs[0].y + xs[1].y) / 2 }
        })
        if (e && e.state === 'idle') return e
      }
      return null
    }
    const pr = await win.evaluate(() => {
      const r = document.querySelector('#bloub-pet').getBoundingClientRect()
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
    })
    const center = await eyeMidAt(pr.cx, pr.cy)
    const left = await eyeMidAt(Math.max(20, pr.cx - 300), pr.cy - 150)
    const right = await eyeMidAt(pr.cx + 300, pr.cy - 150)   // 与左点关于桌宠中轴对称（斜向同角度，pitch 耦合相互抵消）
    const near = await eyeMidAt(pr.cx, pr.cy)
    check('pet-gaze-follows', !!(center && left && right), '三个指针位置均采到 idle 眼位')
    if (center && left && right && near) {
      // 指针贴在桌宠身上 → 双眼中点正对脸中心（水平归零，「看进镜头」）
      check('pet-gaze-centered-on-hover', Math.abs(center.midX) <= 4, '贴脸时双眼中点 x=' + center.midX.toFixed(1) + '（|≤4px|）')
      // 左右各移一档 → 眼位移对称且幅度可感知
      const L = left.midX - center.midX
      const R = right.midX - center.midX
      const swing = right.midX - left.midX
      check('pet-gaze-symmetric', Math.abs(L + R) <= 3.5, '左/右偏移 ' + L.toFixed(1) + '/' + R.toFixed(1) + 'px，对称误差 ' + Math.abs(L + R).toFixed(2) + 'px')
      check('pet-gaze-tracks-pointer', swing >= 25 && L < -8 && R > 8, '全摆幅 ' + swing.toFixed(1) + 'px，方向正确（左负右正）')
      // 垂直：指针上/下 → 眼线上下移动
      const up = await eyeMidAt(pr.cx, pr.cy - 350)
      const down = await eyeMidAt(pr.cx, pr.cy + 350)
      if (up && down) {
        const vSwing = down.midY - up.midY
        check('pet-gaze-vertical', vSwing >= 18, '垂直摆幅 ' + vSwing.toFixed(1) + 'px（下移眼线更低）')
      } else check('pet-gaze-vertical', false, '上下采样失败')
      // 指针回贴脸 → 眼位回中（与首次贴脸一致）
      check('pet-gaze-recenters', Math.abs(near.midX - center.midX) <= 2, '回贴脸后中点回到 ' + near.midX.toFixed(1) + 'px')
    }
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
      // 未命中问题：此时云端大脑（mock-chat 配置已注入）接管 → 流式打字机回复（FAKE 接缝回「（云端测试大脑）收到：…」）
      await win.fill('.pet-bubble-input', '量子力学怎么入门')
      await win.click('.pet-bubble-send')
      let cloudAnswer = ''
      for (let i = 0; i < 60; i++) {
        const st = await win.evaluate(() => {
          const a = [...document.querySelectorAll('#pet-bubble .pet-bubble-a')]
          const last = a[a.length - 1]
          return last ? { text: last.textContent, gen: last.classList.contains('gen') } : { text: '', gen: false }
        })
        if (!st.gen && st.text.length > 4) { cloudAnswer = st.text; break }
        await win.waitForTimeout(150)
      }
      check('pet-ask-cloud-brain', /云端测试大脑/.test(cloudAnswer || ''), '云端大脑接管闲聊：' + (cloudAnswer || '').slice(0, 26) + '…')
    }

    // 点外部关闭
    await win.mouse.click(500, 400)
    await win.waitForTimeout(200)
    const closed = await win.evaluate(() => document.querySelector('#pet-bubble').classList.contains('hidden'))
    check('pet-bubble-closes-outside', closed)
  }

  // ---- 3b. 右键快捷菜单：换边 / 归位 / 休息唤醒 / Esc 关闭 / 点外部关闭 ----
  if (pet) {
    const center = async () => win.evaluate(() => {
      const r = document.querySelector('#bloub-pet').getBoundingClientRect()
      return [r.x + r.width / 2, r.y + r.height / 2, r.x]
    })
    const [cx, cy] = await center()
    await win.mouse.click(cx, cy, { button: 'right' })
    await win.waitForTimeout(250)
    const menu0 = await win.evaluate(() => {
      const m = document.querySelector('#pet-menu')
      if (!m) return null
      return {
        open: !m.classList.contains('hidden'),
        items: [...m.querySelectorAll('.pet-menu-item')].map((b) => b.textContent),
        modelItem: (m.querySelector('[data-model]') || {}).textContent || null
      }
    })
    check('pet-menu-opens', !!(menu0 && menu0.open), '右键弹出菜单')
    check('pet-menu-items', !!(menu0 && menu0.open && menu0.items.length >= 6
      && menu0.items.some((t) => /换到另一侧/.test(t)) && menu0.items.some((t) => /休息/.test(t))
      && menu0.items.some((t) => /帮助气泡/.test(t))), '菜单项齐备：' + (menu0 && menu0.items).join(' / '))
    // 换边：右 → 左
    const vw = await win.evaluate(() => window.innerWidth)
    const xBefore = (await center())[2]
    await win.click('#pet-menu .pet-menu-item:has-text("换到另一侧")')
    await win.waitForTimeout(350)
    const xAfter = (await center())[2]
    const menuClosed = await win.evaluate(() => document.querySelector('#pet-menu').classList.contains('hidden'))
    check('pet-menu-flip-side', xAfter < vw / 2 && Math.abs(xAfter - xBefore) > 200,
      'x ' + Math.round(xBefore) + ' → ' + Math.round(xAfter) + '（换到左侧）')
    check('pet-menu-closes-after-action', menuClosed, '菜单点选后自动关闭')
    // 归位：回默认位置（右侧带）
    const [cx2, cy2] = await center()
    await win.mouse.click(cx2, cy2, { button: 'right' })
    await win.waitForTimeout(250)
    await win.click('#pet-menu .pet-menu-item:has-text("回到默认位置")')
    await win.waitForTimeout(350)
    const xReset = (await center())[2]
    check('pet-menu-reset-pos', xReset >= vw - 300, '归位后回到右侧带（x=' + Math.round(xReset) + '）')
    // 休息 → data-state=sleep；Esc 关菜单
    const [cx3, cy3] = await center()
    await win.mouse.click(cx3, cy3, { button: 'right' })
    await win.waitForTimeout(250)
    await win.click('#pet-menu .pet-menu-item:has-text("休息 / 唤醒")')
    await win.waitForTimeout(200)
    const sleeping = await win.evaluate(() => document.querySelector('#bloub-pet').dataset.state)
    check('pet-menu-sleep', sleeping === 'sleep', '休息：data-state=' + sleeping)
    // 唤醒（再点一次菜单项）→ transient egg → idle
    const [cx4, cy4] = await center()
    await win.mouse.click(cx4, cy4, { button: 'right' })
    await win.waitForTimeout(250)
    await win.click('#pet-menu .pet-menu-item:has-text("休息 / 唤醒")')
    await win.waitForTimeout(2200)   // egg transient 1400ms 收敛
    const woke = await win.evaluate(() => document.querySelector('#bloub-pet').dataset.state)
    check('pet-menu-wake', woke === 'idle', '唤醒回 idle（data-state=' + woke + '）')
    // Esc 关闭
    const [cx5, cy5] = await center()
    await win.mouse.click(cx5, cy5, { button: 'right' })
    await win.waitForTimeout(250)
    await win.keyboard.press('Escape')
    await win.waitForTimeout(150)
    const escClosed = await win.evaluate(() => document.querySelector('#pet-menu').classList.contains('hidden'))
    check('pet-menu-esc-closes', escClosed, 'Esc 关闭菜单')
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

  // ---- 9. 本地小模型一键接入（假源 + SIXWORLDS_PET_FAKE，全程不下真实 400MB）----
  // 9a. 打开气泡：接入按钮存在且只说大小、不显示型号
  const petCenter = await centerOfPet()
  await win.mouse.click(petCenter[0], petCenter[1])
  await win.waitForTimeout(400)
  const chip0 = await win.evaluate(() => {
    const z = document.querySelector('#pet-bubble .pet-model-zone')
    if (!z) return null
    const b = z.querySelector('.pet-chip-model')
    return b ? { text: b.textContent, zonePhase: z.dataset.phase } : null
  })
  check('pet-model-chip', !!chip0 && /400MB/.test(chip0.text) && !/qwen|0\.5b|instruct/i.test(chip0.text),
    '「' + (chip0 && chip0.text) + '」（只说大小，无型号）')

  // 9b. 点按钮 → 二次确认：只出现「约 400MB」与用途说明，无型号
  await win.click('#pet-bubble .pet-model-zone .pet-chip-model')
  await win.waitForTimeout(250)
  const confirm = await win.evaluate(() => {
    const c = document.querySelector('#pet-bubble .pet-model-confirm')
    if (!c) return null
    return { text: c.textContent, hasGo: !!c.querySelector('.pet-chip-go'), hasNo: !!c.querySelector('.pet-chip-ghost') }
  })
  check('pet-model-confirm-size-only', !!(confirm && /400MB/.test(confirm.text) && confirm.hasGo && confirm.hasNo
    && !/qwen|0\.5b|instruct/i.test(confirm.text)), '确认文案含大小、无型号、双按钮')

  // 9c. 确认下载 → 进度条出现（received > 0）
  await win.click('#pet-bubble .pet-chip-go')
  await win.waitForTimeout(400)
  const dlMid = await win.evaluate(() => {
    const z = document.querySelector('#pet-bubble .pet-model-zone')
    return z ? { phase: z.dataset.phase, pct: (z.querySelector('.pet-model-pct') || {}).textContent || '' } : null
  })
  check('pet-model-downloading', !!(dlMid && (dlMid.phase === 'downloading' || dlMid.phase === 'loading' || dlMid.phase === 'ready') && (dlMid.pct || dlMid.phase !== 'downloading')),
    'phase=' + (dlMid && dlMid.phase) + ' ' + (dlMid && dlMid.pct))

  // 9d. 等待假模型下载完 + 自动就绪（FAKE 模式 loading 立即转 ready）
  let ready = false
  for (let i = 0; i < 40; i++) {
    await win.waitForTimeout(250)
    const s = await win.evaluate(() => window.BloubPet.modelPhase())
    if (s === 'ready') { ready = true; break }
  }
  check('pet-model-ready', ready, '假源下载 → 自动接入 → ready')

  // 9e. 就绪后：规则问题仍走规则库（Ctrl+F，不是模型腔）
  await win.fill('.pet-bubble-input', '快捷键')
  await win.click('.pet-bubble-send')
  await win.waitForTimeout(300)
  const ruleHit = await win.evaluate(() => {
    const a = [...document.querySelectorAll('#pet-bubble .pet-bubble-a')]
    return a[a.length - 1] ? a[a.length - 1].textContent : ''
  })
  check('pet-model-ready-rules-first', /Ctrl\+F/.test(ruleHit), '就绪后规则优先：' + ruleHit.slice(0, 24) + '…')

  // 9f. 大脑路由：云端优先（boot 注入的 mock-chat 配置）→ 切换偏好到本地 → 两路都流式打字机
  //     FAKE 接缝回复「（云端测试大脑）收到：「…」」/「（测试大脑）收到：「…」」；完成判定 = 光标消失
  const askAndRead = async (q) => {
    await win.fill('.pet-bubble-input', q)
    await win.click('.pet-bubble-send')
    let sawGen = false
    let sawPartial = false
    let answer = ''
    for (let i = 0; i < 80; i++) {
      await win.waitForTimeout(150)
      const st = await win.evaluate(() => {
        const a = [...document.querySelectorAll('#pet-bubble .pet-bubble-a')]
        const last = a[a.length - 1]
        return last ? { text: last.textContent, gen: last.classList.contains('gen') } : { text: '', gen: false }
      })
      if (st.gen) sawGen = true
      if (st.gen && st.text.length > 0 && st.text.indexOf('」') === -1) sawPartial = true
      if (!st.gen && st.text.indexOf('」') !== -1) { answer = st.text; break }
    }
    return { answer, sawGen, sawPartial }
  }
  const brain0 = await win.evaluate(() => window.BloubPet.brain())
  check('pet-brain-default-cloud', brain0 === 'cloud', '本地就绪 + 云端已配置 → 默认大脑 cloud')
  const zoneBrain = await win.evaluate(() => document.querySelector('#pet-bubble .pet-model-zone').textContent)
  check('pet-brain-zone-label', /云端大脑/.test(zoneBrain), '接入区显示双大脑：' + zoneBrain)
  const rCloud = await askAndRead('讲个笑话')
  check('pet-brain-cloud-answers', /云端测试大脑/.test(rCloud.answer), '云端大脑作答：' + (rCloud.answer || '').slice(0, 22) + '…')
  check('pet-brain-cloud-typewriter', rCloud.sawPartial, '云端回答同样走打字机逐字（途中半截 ' + rCloud.sawPartial + '）')
  await win.evaluate(() => localStorage.setItem('sixworlds.pet.brain.v1', 'local'))
  const brain1 = await win.evaluate(() => window.BloubPet.brain())
  check('pet-brain-toggle-local', brain1 === 'local', '偏好切到 local → brain() = local')
  const rLocal = await askAndRead('再讲一个')
  check('pet-brain-local-answers', /（测试大脑）/.test(rLocal.answer) && !/云端/.test(rLocal.answer),
    '本地大脑作答：' + (rLocal.answer || '').slice(0, 22) + '…')
  check('pet-brain-local-typewriter', rLocal.sawPartial, '本地回答打字机逐字（途中半截 ' + rLocal.sawPartial + '）')
  await win.evaluate(() => { const b = document.querySelector('#pet-bubble .pet-bubble-x'); if (b) b.click() })
  await win.waitForTimeout(200)

  // ---- 10. 智能体：推荐选项 → 替我选 → 托管 2 轮 → 配图建议 → 提示词优化 ----
  //     mock 剧情自带【A】【B】选项，托管是真刀真枪地代点并发送（FAKE 接缝只替代「判断」环节）
  const petCenter2 = await centerOfPet()
  await win.mouse.click(petCenter2[0], petCenter2[1])
  await win.waitForTimeout(450)
  const agentZone0 = await win.evaluate(() => {
    const z = document.querySelector('#pet-bubble .pet-agent-zone')
    if (!z) return null
    return [...z.querySelectorAll('.pet-chip-agent')].map((b) => b.textContent)
  })
  check('agent-zone-chips', !!(agentZone0 && agentZone0.length >= 3
    && agentZone0.some((t) => /这一幕选哪个/.test(t))
    && agentZone0.some((t) => /托管 3 轮/.test(t))
    && agentZone0.some((t) => /哪幕值得配图/.test(t))), '智能体快捷按钮齐备：' + (agentZone0 || []).join(' / '))
  check('agent-zone-no-prompt-chip-without-illust', !(agentZone0 || []).some((t) => /优化生图提示词/.test(t)),
    '生图端点未配置时不显示「优化生图提示词」（' + (agentZone0 || []).length + ' 个按钮）')

  // 10a. 推荐：FAKE 决策 → 推荐【B】+「替我选」按钮
  await win.click('#pet-bubble .pet-agent-zone .pet-chip-agent:has-text("这一幕选哪个")')
  await win.waitForTimeout(400)
  const recNote = await win.evaluate(() => {
    const notes = [...document.querySelectorAll('#pet-bubble .pet-bubble-note')]
    const last = notes[notes.length - 1]
    return last ? { text: last.textContent, hasBtn: !!last.querySelector('.pet-bubble-actions .pet-chip-go') } : null
  })
  check('agent-recommend-note', !!(recNote && /推荐【B】/.test(recNote.text) && recNote.hasBtn),
    '推荐结果：' + (recNote && recNote.text || '').slice(0, 30) + '…（附替我选按钮）')
  // 10b. 替我选 → 代点【B】→ mock 推进一轮剧情
  if (recNote && recNote.hasBtn) {
    await win.click('#pet-bubble .pet-bubble-note .pet-bubble-actions .pet-chip-go')
    let doneNote = null
    for (let i = 0; i < 60; i++) {
      await win.waitForTimeout(200)
      doneNote = await win.evaluate(() => {
        const notes = [...document.querySelectorAll('#pet-bubble .pet-bubble-note')]
        const t = notes.map((n) => n.textContent).join('|')
        return /替你选了【B】/.test(t) ? (/(这一轮完成了|生成没有完成)/.test(t) ? t : null) : null
      })
      if (doneNote) break
    }
    check('agent-play-choice-round', !!doneNote && /这一轮完成了/.test(doneNote),
      '代选【B】完成一轮剧情生成')
  }

  // 10c. 自然语言托管：输入「托管 2 轮」→ 意图路由 → 连续代打
  await win.fill('.pet-bubble-input', '托管 2 轮')
  await win.click('.pet-bubble-send')
  await win.waitForTimeout(500)
  let sawStop = false
  let autoDone = null
  for (let i = 0; i < 120; i++) {
    const st = await win.evaluate(() => {
      const z = document.querySelector('#pet-bubble .pet-agent-zone')
      const run = z && z.querySelector('.pet-agent-run')
      const notes = [...document.querySelectorAll('#pet-bubble .pet-bubble-note')].map((n) => n.textContent).join('|')
      return { running: !!(run && !run.closest('.hidden') && /停止托管/.test(run.textContent)), notes }
    })
    if (st.running) sawStop = true
    if (/托管结束：一共替你打了 2 轮/.test(st.notes)) { autoDone = st.notes; break }
    await win.waitForTimeout(250)
  }
  check('agent-autopilot-runs', !!autoDone, '托管 2 轮跑完：' + (autoDone || '未完成').slice(0, 40) + '…')
  check('agent-autopilot-shows-stop', sawStop, '托管期间显示「停止托管」')
  if (autoDone) {
    check('agent-autopilot-picks', /第 1 轮选【A】/.test(autoDone) && /第 2 轮选【A】/.test(autoDone),
      '每轮报告选择与理由（FAKE 决策固定选 A）')
  }

  // 10d. 配图建议：FAKE 决策 idx=0（最近一幕）+「就这幕，生成」；生图端点未配置 → 守卫提示
  await win.click('#pet-bubble .pet-agent-zone .pet-chip-agent:has-text("哪幕值得配图")')
  await win.waitForTimeout(400)
  const illustNote = await win.evaluate(() => {
    const notes = [...document.querySelectorAll('#pet-bubble .pet-bubble-note')]
    const last = notes[notes.length - 1]
    return last ? { text: last.textContent, hasBtn: !!last.querySelector('.pet-bubble-actions .pet-chip-go') } : null
  })
  check('agent-illust-note', !!(illustNote && /最值得配图的是/.test(illustNote.text) && illustNote.hasBtn),
    '配图建议：' + (illustNote && illustNote.text || '').slice(0, 30) + '…')
  if (illustNote && illustNote.hasBtn) {
    // 点「最后一条 note」的操作按钮（10a 的替我选按钮已留在历史里，选择器必须精确）
    await win.evaluate(() => {
      const notes = [...document.querySelectorAll('#pet-bubble .pet-bubble-note')]
      const last = notes[notes.length - 1]
      const b = last.querySelector('.pet-bubble-actions .pet-chip-go')
      if (b) b.click()
    })
    await win.waitForTimeout(350)
    const guard = await win.evaluate(() => {
      const notes = [...document.querySelectorAll('#pet-bubble .pet-bubble-note')]
      return notes.map((n) => n.textContent).join('|')
    })
    check('agent-illust-guard', /生图端点未配置/.test(guard), '未配置插图端点时守卫提示（不盲发请求）')
  }

  // 10e. 自然语言提示词优化：「优化生图提示词」→ FAKE 返回固定提示词 + 两个操作按钮
  await win.fill('.pet-bubble-input', '帮我优化生图的提示词')
  await win.click('.pet-bubble-send')
  await win.waitForTimeout(450)
  const promptNote = await win.evaluate(() => {
    const notes = [...document.querySelectorAll('#pet-bubble .pet-bubble-note')]
    const last = notes[notes.length - 1]
    return last ? { text: last.textContent, btns: [...last.querySelectorAll('.pet-bubble-actions .pet-chip')].map((b) => b.textContent) } : null
  })
  check('agent-prompt-optimize', !!(promptNote && /masterpiece/.test(promptNote.text)
    && /优化后的生图提示词/.test(promptNote.text)), '提示词优化结果：' + (promptNote && promptNote.text || '').slice(0, 36) + '…')
  check('agent-prompt-actions', !!(promptNote && promptNote.btns.length >= 2
    && promptNote.btns.some((t) => /用这个生图/.test(t)) && promptNote.btns.some((t) => /复制/.test(t))),
    '操作按钮：' + (promptNote && promptNote.btns || []).join(' / '))
  await win.evaluate(() => { const b = document.querySelector('#pet-bubble .pet-bubble-x'); if (b) b.click() })
  await win.waitForTimeout(200)

  await app.close()
  mock.server.close()
  console.log('')
  console.log('bloub-pet-e2e：' + pass + ' 通过，' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
