
const path = require("node:path")
const fs = require("node:fs")
const { _electron: electron } = require("playwright")
const electronExecutable = require("electron")
const ROOT = process.cwd()
const OUT = "D:/六面世界源码/UI效果图/主题兼容验证"
const PALETTES = ["classic", "paper", "forest", "violet", "ocean", "rose", "contrast"]
const MODES = ["dark", "light"]

function lum(c) {
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return null
  const [r, g, b] = [+m[1], +m[2], +m[3]].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (l1 === null || l2 === null) ? 0 : (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const app = await electron.launch({ executablePath: electronExecutable, args: ["."], cwd: ROOT, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true", SIXWORLDS_TEST: "1" } })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1280, height: 860 })
  await win.waitForTimeout(1600)
  if (await win.evaluate(() => window.api.uiScheme()) !== "d") { await win.evaluate(() => window.api.setUiScheme("d")); await win.waitForTimeout(2200) }
  const fails = []
  const check = (n, ok, ex) => { console.log((ok ? "PASS" : "FAIL") + " " + n + (ex ? "  " + ex : "")); if (!ok) fails.push(n) }
  for (const pal of PALETTES) for (const mode of MODES) {
    const errs = []
    const onErr = (e) => errs.push(e.message.slice(0, 80))
    win.on("pageerror", onErr)
    await win.click("#btn-theme")
    await win.waitForSelector("#theme-pop:not(.hidden)", { timeout: 8000 })
    await win.click(`.swatch[data-value="${pal}"]`)
    await win.click(`[data-setting="theme"][data-value="${mode}"]`)
    await win.waitForTimeout(350)
    await win.keyboard.press("Escape")
    await win.waitForTimeout(250)
    const st = await win.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      const body = getComputedStyle(document.body)
      const pill = document.getElementById("statepill")
      return {
        theme: document.documentElement.dataset.theme, pal: document.documentElement.dataset.palette,
        bg: body.backgroundColor, fg: body.color,
        accent: cs.getPropertyValue("--accent").trim(), amber: cs.getPropertyValue("--amber").trim(),
        pillBg: pill ? getComputedStyle(pill).backgroundColor : "", topbarBg: getComputedStyle(document.querySelector(".titlebar")).backgroundColor
      }
    })
    const cr = ratio(st.bg, st.fg)
    const ok = st.theme === mode && st.pal === pal && cr >= 4 && !!st.accent && st.amber !== "" && !errs.length
    check(pal + "-" + mode, ok, "对比度" + cr.toFixed(1) + " bg=" + st.bg + " fg=" + st.fg + " t=" + st.theme + " p=" + st.pal + (errs.length ? " JS错:" + errs.join(";") : ""))
    if (["classic", "forest", "contrast", "paper"].includes(pal)) await win.screenshot({ path: path.join(OUT, pal + "-" + mode + ".png") })
    win.off("pageerror", onErr)
  }
  // 持久化：重载后保持最后组合（rose-light）
  await win.reload(); await win.waitForTimeout(1400)
  const persist = await win.evaluate(() => ({ t: document.documentElement.dataset.theme, p: document.documentElement.dataset.palette }))
  check("persist-after-reload", persist.t === "light" && persist.p === "contrast", JSON.stringify(persist))
  // 方案间共享：切到 classic 主题属性仍在
  await win.evaluate(() => window.api.setUiScheme("classic")); await win.waitForTimeout(2200)
  const shared = await win.evaluate(() => ({ t: document.documentElement.dataset.theme, p: document.documentElement.dataset.palette }))
  check("theme-shared-across-schemes", shared.t === "light" && shared.p === "contrast", JSON.stringify(shared))
  // 收尾恢复默认
  await win.evaluate(() => window.api.setUiScheme("d")); await win.waitForTimeout(2200)
  console.log(fails.length ? "FAILED " + fails.length : "ALL PASS")
  await app.close()
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.error("FATAL", e.message); process.exit(1) })
