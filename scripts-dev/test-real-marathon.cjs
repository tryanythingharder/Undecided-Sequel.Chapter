'use strict'
/* 真实模型长程马拉松（开发机手动工具，npm run test:real:marathon [轮数=100]）：
 * 在真实 userData（A6api DeepSeek）下新建独立测试会话，连续 N 轮真实对话
 * （默认点选项推进，每 7 轮穿插一次自由输入），逐轮采集遥测：
 *   耗时 / 回复长度 / 选项数 / 待补录 chip（协议合规）/
 *   后台补账触发与耗时（首轮 State Patch 缺失→静默重试的真实发生率，生产关键指标）/
 *   引擎回合数（engineOverview，验证状态引擎逐轮落账）/ 消息数 / 堆内存。
 * 轮间协议：每轮结束等「记账中」chip 消失再进入下一轮——engineBusy 期间 send()
 * 会被守卫拒绝（提示 toast），不等 chip 就点选项会被静默吞掉造成空转超时。
 * 结束输出汇总（成功率、协议合规、补账率、引擎记忆规模）并删除测试会话。
 * 产生真实 API 费用；单轮 180s 硬超时（busy 挂起→点停止；点击被吞→补发一次）。 */
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')

const ROUNDS = Number(process.argv[2]) || 100

const state = { rounds: [], resolves: [], recoveries: 0, errors: [], errStreak: 0, outageRounds: 0 }
const fmt = (n) => (n / 1000).toFixed(1) + 's'

async function readUI(win) {
  return win.evaluate(() => {
    const bodies = document.querySelectorAll('.msg.assistant .msg-body')
    const last = bodies[bodies.length - 1]
    const act = document.querySelector('.session-item.active')
    return {
      txt: last ? last.textContent : '',
      busy: document.querySelector('#btn-send').classList.contains('stop'),
      choices: document.querySelectorAll('.choice').length,
      pending: document.querySelectorAll('.msg-pending-chip').length,
      committing: document.querySelectorAll('.msg-committing-chip').length,
      msgCount: document.querySelectorAll('.msg').length,
      sid: act ? act.dataset.sid : null,
      heap: (performance.memory && performance.memory.usedJSHeapSize / 1048576) || 0
    }
  })
}

async function engineTurn(win, sid) {
  try {
    const r = await win.evaluate(async (id) => await window.api.engineOverview({ storyId: id }), sid)
    if (r && r.ok && r.data) return { turn: r.data.engine_turn || 0, o: r.data }
  } catch {}
  return null
}

async function waitRoundDone(win, prevTxt, timeoutMs) {
  const t0 = Date.now()
  let cur = ''
  let stable = 0
  while (Date.now() - t0 < timeoutMs) {
    const ui = await readUI(win)
    if (!ui.busy && ui.txt.length > 20 && ui.txt !== prevTxt) {
      if (ui.txt === cur) { stable++; if (stable >= 3) return { ok: true, ui, dur: Date.now() - t0 } }
      else { cur = ui.txt; stable = 0 }
    }
    await win.waitForTimeout(500)
  }
  return { ok: false, ui: await readUI(win), dur: Date.now() - t0 }
}

// 等「记账中」chip 消失（后台补账完成；engineBusy 随之解除）。
// 返回等待毫秒数；-1 = 超上限仍未清（补账请求挂起）。
async function waitCommitClear(win, capMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < capMs) {
    const c = await win.evaluate(() => document.querySelectorAll('.msg-committing-chip').length)
    if (!c) return Date.now() - t0
    await win.waitForTimeout(1000)
  }
  return -1
}

// 等一键补录完成：resolvePendingFlow 会置 busy 并逐条串行调模型（每条一轮真实 API），
// 结束标志 = busy 清零且待补录横幅隐藏。返回 { ok, ms }。
async function waitResolveDone(win, capMs) {
  const t0 = Date.now()
  let stable = 0
  while (Date.now() - t0 < capMs) {
    const s = await win.evaluate(() => ({
      busy: document.querySelector('#btn-send').classList.contains('stop'),
      banner: !document.getElementById('pending-banner').classList.contains('hidden')
    }))
    if (!s.busy && !s.banner) { stable++; if (stable >= 3) return { ok: true, ms: Date.now() - t0 } }
    else stable = 0
    await win.waitForTimeout(1000)
  }
  return { ok: false, ms: Date.now() - t0 }
}

async function main() {
  console.log(`== 真实模型马拉松：${ROUNDS} 轮（A6api DeepSeek）==`)
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(3200)
  await win.keyboard.press('Enter').catch(() => {}) // 进 splash
  await win.waitForTimeout(1200)
  win.on('pageerror', (e) => state.errors.push(String(e).slice(0, 200)))
  win.on('console', (m) => { if (m.type() === 'error') state.errors.push('CONSOLE: ' + m.text().slice(0, 200)) })

  const cfgState = await win.evaluate(() => {
    const chip = document.getElementById('chip-text-model')
    return chip ? chip.textContent.trim() : ''
  })
  console.log('model=' + cfgState)

  const before = await win.evaluate(() => document.querySelectorAll('.session-item').length)
  await win.click('#btn-new')
  await win.waitForTimeout(600)

  let prevTxt = ''
  const tStart = Date.now()
  for (let n = 1; n <= ROUNDS; n++) {
    const t0 = Date.now()
    try {
      const ui = await readUI(win)
      if (ui.busy) { // 上一轮未完：等待最多 120s
        const settled = await waitRoundDone(win, prevTxt, 120000)
        if (!settled.ok) {
          console.log(`  [round ${n}] 上一轮仍未结束，点停止中止`)
          await win.click('#btn-send').catch(() => {})
          await win.waitForTimeout(1500)
        }
      }
      await waitCommitClear(win, 90000) // 上一轮后台补账收尾（engineBusy 解除后才允许发送）
      // 7 的倍数轮：自由输入推进时间；其余轮：点选项
      const freeTexts = ['（时间推进三个月，继续这个世界的运转）', '（我离开当前地点，去更远的地方游历）', '（我尝试提升自己的能力，专注修行）', '（我去拜访一位久未联系的故人）', '（我在当地定居下来，经营一摊小生意）', '（我卷入一场突如其来的意外事件）', '（我决定低调观察一段时间，不主动行动）']
      if (n % 7 === 0 || n === 1) {
        await win.fill('#input', freeTexts[(n / 7 | 0) % freeTexts.length])
        await win.click('#btn-send')
      } else {
        const cnt = await win.locator('.choice').count()
        if (cnt >= 1) {
          const idx = [0, cnt - 1, Math.floor(cnt / 2)][n % 3] % cnt
          await win.locator('.choice').nth(idx).click()
        } else {
          await win.fill('#input', '继续推进剧情')
          await win.click('#btn-send')
        }
      }
      let r = await waitRoundDone(win, prevTxt, 180000)
      let retried = false
      if (!r.ok && !r.ui.busy && r.ui.txt === prevTxt) {
        // 点击被吞（engineBusy 守卫 / 元素瞬时未挂载）：补发一次
        retried = true
        console.log(`  [round ${n}] 首次动作被吞（busy=false · 文本未变），补发一次`)
        await win.fill('#input', '（继续推进剧情）')
        await win.click('#btn-send')
        r = await waitRoundDone(win, prevTxt, 120000)
      }
      // ---- API 故障轮识别（R85）：秒回 + 无选项 + 报错模板 = 服务端故障，不是有效叙事轮。
      // 错误轮一律不入账、不烧轮次：单轮暂停 30s 后重打；连击 4 轮 → 熔断每 120s 探测恢复 ----
      if (r.ok && r.dur < 5000 && r.ui.choices === 0 && /世界引擎报错/.test(r.ui.txt)) {
        state.errStreak++
        state.outageRounds++
        if (state.errStreak >= 4) {
          console.log(`  [round ${n}] API 故障带（连击 ${state.errStreak}）→ 熔断，每 2 分钟探测恢复…`)
          let recovered = false
          for (let probe = 1; probe <= 30 && !recovered; probe++) {
            await win.waitForTimeout(120000)
            const ui2 = await readUI(win)
            if (!ui2.busy) {
              await win.fill('#input', '（继续）')
              await win.click('#btn-send')
              const rp = await waitRoundDone(win, prevTxt, 150000)
              if (rp.ok && rp.ui.choices > 0 && !/世界引擎报错/.test(rp.ui.txt)) {
                recovered = true
                console.log(`  [round ${n}] 服务已恢复（探测 ${probe} 次成功）`)
              } else {
                state.outageRounds++
                console.log(`  [round ${n}] 探测 ${probe} 仍报错，继续等…`)
              }
            }
          }
          if (!recovered) {
            console.log('  [熔断] 30 次探测均失败：服务持续不可用，提前收束')
            state.errors.push('OUTAGE: 服务端故障未恢复，马拉松提前收束')
            break
          }
          state.errStreak = 0
        } else {
          console.log(`  [round ${n}] API 报错轮（不计轮次，暂停 30s 后重打）`)
          await win.waitForTimeout(30000)
        }
        n-- // 本轮作废重打（for 自增后仍是 n）
        continue
      }
      state.errStreak = 0
      if (!r.ok) {
        // 超时分类观测：busy 卡住（请求挂起/流式中）vs 已停但文本未变（点击未生效/发送失败）
        console.log(`  [round ${n}] 超时态：busy=${r.ui.busy} · chip=${r.ui.pending}/${r.ui.committing} · 消息${r.ui.msgCount}`)
        try {
          fs.mkdirSync(path.join(__dirname, '..', 'output'), { recursive: true })
          await win.screenshot({ path: path.join(__dirname, '..', 'output', `marathon-timeout-r${n}.png`) })
        } catch {}
        await win.click('#btn-send').catch(() => {}) // busy 中此为停止
        await win.waitForTimeout(2000)
      }
      prevTxt = r.ui.txt
      // 轮末：后台补账观测（记账中 chip 出现即首轮 State Patch 缺失，app 静默重试）
      const bg = await win.evaluate(() => document.querySelectorAll('.msg-committing-chip').length)
      let bgMs = 0
      if (bg > 0) bgMs = await waitCommitClear(win, 90000)
      const eng = await engineTurn(win, r.ui.sid) // 补账落账后再读，回合数即准确
      state.rounds.push({
        n, ok: r.ok, retried, dur: Date.now() - t0, len: r.ui.txt.length, choices: r.ui.choices,
        pending: r.ui.pending, committing: r.ui.committing, msgCount: r.ui.msgCount,
        turn: eng ? eng.turn : -1, heap: Math.round(r.ui.heap),
        bg: bg > 0 ? (bgMs >= 0 ? bgMs : -1) : 0
      })
      const avg = state.rounds.reduce((a, x) => a + x.dur, 0) / state.rounds.length
      console.log(`[round ${n}] ${r.ok ? 'OK' : 'TIMEOUT'}${retried && r.ok ? '(补发后)' : ''} ${fmt(Date.now() - t0)} · ${r.ui.txt.length}字 · 选项${r.ui.choices}${bg > 0 ? ` · 补账${bgMs >= 0 ? fmt(bgMs) : '挂起'}` : ''} · 待补录${r.ui.pending} · 引擎回合${eng ? eng.turn : '?'} · 堆${Math.round(r.ui.heap)}MB · 均速${fmt(avg)}`)
      if (n % 25 === 0) {
        const done = state.rounds.filter((x) => x.ok).length
        const pendingHits = state.rounds.filter((x) => x.pending > 0).length
        const bgHits = state.rounds.filter((x) => x.bg !== 0).length
        console.log(`== 里程碑 ${n}/${ROUNDS}：成功 ${done} · 待补录 ${pendingHits} 轮 · 补账触发 ${bgHits} 轮 · 累计 ${fmt(Date.now() - tStart)} ==`)
      }
      // 每 10 轮触发一次一键补录（真实恢复路径验证 + 防待补录单调累积）：
      // 横幅 #btn-pending-resolve → resolvePendingFlow(null) → busy 串行逐条调模型补状态块
      if (n % 10 === 0) {
        const banner = await win.evaluate(() => !document.getElementById('pending-banner').classList.contains('hidden'))
        if (banner) {
          await win.click('#btn-pending-resolve')
          const rv = await waitResolveDone(win, 300000) // 每条补录一轮真实 API（15-60s），上限 5 分钟
          const after10 = await readUI(win)
          state.resolves.push({ after: n, ok: rv.ok, ms: rv.ms, left: after10.pending })
          console.log(`  [补录] 第 ${n} 轮后一键补录：${rv.ok ? '完成' : '超时'} ${fmt(rv.ms)} · 剩余待补录 ${after10.pending}`)
          await waitCommitClear(win, 30000)
        }
      }
    } catch (e) {
      state.recoveries++
      console.log(`[round ${n}] 异常：${String(e).slice(0, 120)} → 等待恢复`)
      state.errors.push('ROUND' + n + ': ' + String(e).slice(0, 150))
      await win.waitForTimeout(6000)
    }
  }

  // ---- 汇总 ----
  const done = state.rounds.filter((x) => x.ok)
  const timeouts = state.rounds.filter((x) => !x.ok)
  const pendingHits = state.rounds.filter((x) => x.pending > 0)
  const bgRounds = state.rounds.filter((x) => x.bg !== 0)
  const retriedRounds = state.rounds.filter((x) => x.retried)
  const lastEng = await (async () => {
    const ui = await readUI(win).catch(() => null)
    return ui && ui.sid ? engineTurn(win, ui.sid) : null
  })()
  const durs = done.map((x) => x.dur).sort((a, b) => a - b)
  const totalChars = done.reduce((a, x) => a + x.len, 0)
  console.log('\n== 马拉松汇总 ==')
  console.log(`成功 ${done.length}/${ROUNDS} 轮（超时 ${timeouts.length}，补发后成功 ${retriedRounds.filter((x) => x.ok).length}，异常恢复 ${state.recoveries} 次，API 故障轮 ${state.outageRounds} 已熔断跳过）`)
  console.log(`耗时：中位 ${fmt(durs[Math.floor(durs.length / 2)] || 0)} · 最快 ${fmt(durs[0] || 0)} · 最慢 ${fmt(durs[durs.length - 1] || 0)} · 总计 ${fmt(Date.now() - tStart)}`)
  console.log(`叙事总字数 ${totalChars} · 待补录遗留 ${pendingHits.length} 轮（协议合规 ${done.length - pendingHits.length}/${done.length}）`)
  console.log(`后台补账触发 ${bgRounds.length} 轮（首轮 Patch 缺失率 ${Math.round(bgRounds.length / Math.max(state.rounds.length, 1) * 100)}%）· 补账总耗时 ${fmt(bgRounds.reduce((a, x) => a + Math.max(x.bg, 0), 0))}${bgRounds.some((x) => x.bg < 0) ? ' · 有挂起' : ''}`)
  if (state.resolves.length) console.log(`一键补录触发 ${state.resolves.length} 次：成功 ${state.resolves.filter((x) => x.ok).length} · 剩余待补录 ${state.resolves[state.resolves.length - 1].left} · 总耗时 ${fmt(state.resolves.reduce((a, x) => a + x.ms, 0))}`)
  else console.log('一键补录：未触发（无待补录横幅出现）')
  if (lastEng) console.log(`引擎终态：回合 ${lastEng.turn} · 概览 ${JSON.stringify(lastEng.o).slice(0, 220)}`)
  const lastUi = state.rounds[state.rounds.length - 1]
  if (lastUi) console.log(`UI 终态：消息 ${lastUi.msgCount} 条 · 渲染堆 ${lastUi.heap}MB`)
  console.log(`页面错误 ${state.errors.length} 条` + (state.errors.length ? '：' + JSON.stringify(state.errors.slice(0, 3)) : ''))

  // ---- R85 运行时验证：测试会话若存在待补录 → 实测横幅「放弃」按钮（只动本测试线）----
  try {
    const testPending = await win.evaluate(() => document.querySelectorAll('.msg-pending-chip').length)
    if (testPending > 0) {
      const hasBtn = await win.locator('#btn-pending-discard').count()
      if (hasBtn) {
        await win.locator('#btn-pending-discard').click({ timeout: 8000 })
        await win.waitForTimeout(500)
        const cv = await win.locator('.confirm-mask').isVisible().catch(() => false)
        if (cv) await win.locator('.confirm-mask .confirm-foot button').last().click()
        await win.waitForTimeout(1500)
        const afterP = await win.evaluate(() => ({
          chips: document.querySelectorAll('.msg-pending-chip').length,
          banner: !document.getElementById('pending-banner').classList.contains('hidden')
        }))
        console.log(`放弃按钮实测：${testPending} 条待补录 → 剩余 ${afterP.chips} · 横幅${afterP.banner ? '仍可见' : '已隐藏'} ${afterP.chips === 0 ? '✓' : '✗'}`)
      } else console.log('放弃按钮实测：跳过（按钮未挂载）✗')
    } else console.log('放弃按钮实测：本轮无待补录（未触发，正常）')
  } catch (e) {
    console.log('放弃按钮实测：探针异常（不影响清理）', String(e).slice(0, 100))
  }

  // ---- 清理测试会话 ----
  await win.locator('.session-item.active .session-del').click().catch(() => {})
  await win.waitForTimeout(400)
  const confirmVisible = await win.locator('.confirm-mask').isVisible().catch(() => false)
  if (confirmVisible) await win.locator('.confirm-mask .confirm-foot button').last().click().catch(() => {})
  await win.waitForTimeout(800)
  const after = await win.evaluate(() => document.querySelectorAll('.session-item').length)
  console.log(`清理：会话 before=${before} after=${after} ${after === before ? '✓' : '✗'}`)

  const fail = timeouts.length + state.recoveries > 0 || after !== before
  console.log(fail ? 'MARATHON_ISSUES_FOUND' : 'MARATHON_ALL_PASS')
  await app.close().catch(() => {})
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
