// R76d：向导第 1 步配色方案行验证（点击实时预览 / 完成落库 / 跳过还原）
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

const checks = []
function check(name, ok, extra) {
  checks.push({ name, ok: !!ok, extra: extra || '' })
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' : '') + (extra || ''))
}

async function main() {
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1200)
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1800)

  const ev = (fn, arg) => win.evaluate(fn, arg)

  // ---- 步骤 0 结构 ----
  const opts = await ev(() => {
    const els = [...document.querySelectorAll('.wizard-palette-opt')]
    return { count: els.length, ids: els.map((e) => e.dataset.pal) }
  })
  check('配色选项 7 个', opts.count === 7, JSON.stringify(opts))
  check('含 classic 且无 codex', opts.ids.includes('classic') && !opts.ids.includes('codex'), opts.ids.join(','))
  const sel0 = await ev(() => document.querySelector('.wizard-palette-opt.sel')?.dataset.pal || '')
  check('默认选中 classic', sel0 === 'classic', sel0)

  // ---- 点击 paper：属性实时预览、选中态切换 ----
  await win.click('.wizard-palette-opt[data-pal="paper"]')
  await win.waitForTimeout(150)
  const afterPaper = await ev(() => ({
    pal: document.documentElement.getAttribute('data-palette'),
    sel: document.querySelector('.wizard-palette-opt.sel')?.dataset.pal || '',
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  }))
  check('点击 paper → data-palette 预览生效', afterPaper.pal === 'paper' && afterPaper.sel === 'paper', JSON.stringify(afterPaper))
  check('paper 暗色 --bg 覆盖生效（非纯黑）', afterPaper.bg !== '' && afterPaper.bg !== '#000000', afterPaper.bg)

  // ---- 跳过（Esc/跳过按钮）→ 还原 classic 预览且不落库 paper ----
  await win.click('.confirm.wizard .confirm-foot .cancel')
  await win.waitForTimeout(400)
  const afterSkip = await ev(() => ({
    pal: document.documentElement.getAttribute('data-palette'),
    disclaimer: !!document.querySelector('.disclaimer-body'),
  }))
  check('跳过 → 免责声明出现', afterSkip.disclaimer)
  check('跳过 → 配色预览还原 classic', afterSkip.pal === 'classic', afterSkip.pal)

  // ---- 重新触发向导走完成链：选 forest 后落库 ----
  await ev(() => localStorage.removeItem('sixworlds.onboard.v1'))
  await win.reload()
  await win.waitForTimeout(1800)
  await win.click('.wizard-palette-opt[data-pal="forest"]')
  await win.waitForTimeout(120)
  for (let i = 0; i < 3; i++) {
    await win.click('.confirm.wizard .confirm-foot .primary')
    await win.waitForTimeout(250)
  }
  await win.waitForTimeout(500)
  const finishState = await ev(() => {
    const raw = localStorage.getItem('sixworlds.codex.state.v3')
    let palette = ''
    try { palette = (JSON.parse(raw) || {}).palette || '' } catch {}
    return {
      pal: document.documentElement.getAttribute('data-palette'),
      saved: palette,
      disclaimer: !!document.querySelector('.disclaimer-body'),
    }
  })
  check('完成 → data-palette=forest', finishState.pal === 'forest', finishState.pal)
  check('完成 → 落库 palette=forest', finishState.saved === 'forest', finishState.saved)
  check('完成 → 免责声明紧随其后', finishState.disclaimer)

  // 收尾清理，避免污染其他测试
  await ev(() => localStorage.clear())

  const fails = checks.filter((c) => !c.ok).length
  console.log(fails ? '\nR76d 探针: ' + fails + ' failed' : '\nR76d 探针: ALL PASS (' + checks.length + '/' + checks.length + ')')
  await app.close()
  process.exit(fails ? 1 : 0)
}

main().catch((e) => { console.error('PROBE ERROR', e); process.exit(1) })
