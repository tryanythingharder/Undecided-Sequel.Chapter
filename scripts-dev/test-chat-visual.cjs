'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron } = require('playwright')

const root = path.join(__dirname, '..')
const outputRoot = path.join(root, 'output', 'playwright', 'chat-visual-latest')
fs.mkdirSync(outputRoot, { recursive: true })
const runRoot = fs.mkdtempSync(path.join(outputRoot, 'run-'))
let app

async function main() {
  const errors = []
  for (const scheme of ['classic', 'proto', 'd']) {
    const base = path.join(runRoot, scheme)
    const profile = path.join(base, 'profile')
    const appdata = path.join(base, 'appdata')
    const temp = path.join(base, 'tmp')
    for (const dir of [profile, appdata, temp]) fs.mkdirSync(dir, { recursive: true })
    app = await electron.launch({
      executablePath: require('electron'),
      args: ['.'],
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        SIXWORLDS_TEST: '1',
        SIXWORLDS_TEST_USER_DATA: profile,
        APPDATA: appdata,
        TEMP: temp,
        TMP: temp,
        TMPDIR: temp
      }
    })
    const win = await app.firstWindow()
    win.on('pageerror', (error) => errors.push(scheme + ': ' + error.message))
    await win.waitForSelector('#btn-archives', { timeout: 30000 })
    await win.waitForTimeout(800)
    const current = await win.evaluate(() => window.api.uiScheme())
    if (current !== scheme) {
      const navigation = win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 30000 })
      await win.evaluate((target) => setTimeout(() => void window.api.setUiScheme(target), 0), scheme)
      await navigation
      await win.waitForSelector('#btn-archives', { timeout: 30000 })
    }
    await win.evaluate(() => {
      localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({
        skipSplash: true,
        theme: 'light',
        palette: 'classic',
        fontSize: 'standard',
        readWidth: 'standard',
        density: 'standard',
        layout: 'sidebar',
        currentSessionId: 'chat-visual-check'
      }))
      localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
        id: 'chat-visual-check',
        title: '夜路上的脚印',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: '我继续沿着石阶走向门外，同时问守卫这里是否还有人出入。', at: Date.now() },
          { role: 'assistant', content: '【甲龙历 407.03.01｜夜晚｜王城外】\n\n守卫把灯举高了一些。泥地上的脚印在城门外分成两路，一路通向河岸，另一路沿着旧驿道消失在雾里。\n\n昨夜没有登记访客，但我听见过三次马蹄声。', at: Date.now() }
        ]
      }]))
    })
    await win.reload()
    await win.waitForSelector('.msg.assistant .msg-body p', { timeout: 30000 })
    await win.waitForTimeout(500)
    await win.setViewportSize({ width: 1365, height: 900 })
    const desktop = await win.evaluate(() => {
      const html = getComputedStyle(document.documentElement)
      const tokenProbe = document.createElement('span')
      tokenProbe.style.color = 'var(--ui-text)'
      document.body.appendChild(tokenProbe)
      const textToken = getComputedStyle(tokenProbe).color
      tokenProbe.remove()
      const body = getComputedStyle(document.querySelector('.msg.assistant .msg-body'))
      const paragraph = getComputedStyle(document.querySelector('.msg.assistant .msg-body p'))
      const pet = document.querySelector('#bloub-pet')
      const petStyle = getComputedStyle(pet)
      const petRect = pet.getBoundingClientRect()
      return {
        theme: document.documentElement.dataset.theme,
        textToken,
        bodyColor: body.color,
        paragraphColor: paragraph.color,
        paragraphOpacity: paragraph.opacity,
        petSize: [Math.round(petRect.width), Math.round(petRect.height)],
        petSvgSize: Number(pet.querySelector('svg')?.getAttribute('width')),
        petOpacity: petStyle.opacity,
        petFilter: petStyle.filter,
        composerWidth: Math.round(document.querySelector('.composer').getBoundingClientRect().width),
        overflow: document.documentElement.scrollWidth > innerWidth + 1
      }
    })
    if (await win.evaluate(() => window.api.uiScheme()) !== scheme) throw new Error('UI scheme mismatch: ' + scheme)
    if (desktop.paragraphColor !== desktop.textToken && desktop.paragraphColor.replace(/\\s/g, '') !== desktop.textToken) throw new Error('Assistant paragraph color is not the text token: ' + JSON.stringify(desktop))
    if (desktop.paragraphOpacity !== '1') throw new Error('Assistant paragraph opacity changed: ' + JSON.stringify(desktop))
    if (desktop.petSvgSize !== 72) throw new Error('Pet visual size changed unexpectedly: ' + JSON.stringify(desktop))
    if (desktop.overflow) throw new Error(scheme + ' desktop horizontal overflow')
    const contrast = await win.evaluate(() => {
      const readRgb = (color) => color.match(/[0-9.]+/g).slice(0, 3).map(Number)
      const luminance = (color) => readRgb(color).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
      const text = luminance(getComputedStyle(document.querySelector('.msg.assistant .msg-body p')).color)
      const bg = luminance(getComputedStyle(document.querySelector('.chat')).backgroundColor)
      return (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05)
    })
    if (contrast < 4.5) throw new Error(scheme + ' assistant text contrast below 4.5:1: ' + contrast)
    const density = await win.evaluate(() => {
      const root = document.documentElement
      const body = document.querySelector('.msg.assistant .msg-body')
      const messages = document.querySelector('.messages')
      root.dataset.density = 'compact'
      const compact = { line: getComputedStyle(body).lineHeight, gap: getComputedStyle(messages).gap }
      root.dataset.density = 'relaxed'
      const relaxed = { line: getComputedStyle(body).lineHeight, gap: getComputedStyle(messages).gap }
      root.dataset.density = 'standard'
      return { compact, relaxed }
    })
    if (density.compact.gap === density.relaxed.gap || density.compact.line === density.relaxed.line) throw new Error(scheme + ' density preference is not applied: ' + JSON.stringify(density))
    await win.screenshot({ path: path.join(runRoot, scheme + '-desktop.png') })
    await win.setViewportSize({ width: 390, height: 844 })
    await win.waitForFunction((activeScheme) => {
      const sidebar = document.querySelector('#sidebar')
      const pet = document.querySelector('#bloub-pet')
      if (!sidebar?.classList.contains('collapsed') || !pet?.classList.contains('pet-hidden')) return false
      const sidebarRect = sidebar.getBoundingClientRect()
      const settledWidth = activeScheme === 'd'
        ? getComputedStyle(sidebar).display === 'none'
        : Math.abs(sidebarRect.width - 48) < 1
      return settledWidth && !sidebar.matches(':hover')
    }, scheme, { timeout: 5000 })
    const mobile = await win.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector)
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: Math.round(box.width),
          cssWidth: style.width,
          inlineWidth: element.style.width,
          display: style.display
        }
      }
      return {
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        petHidden: document.querySelector('#bloub-pet').classList.contains('pet-hidden'),
        sidebarCollapsed: document.querySelector('#sidebar').classList.contains('collapsed'),
        sidebarClasses: document.querySelector('#sidebar').className,
        sidebarRules: [...document.styleSheets].flatMap((sheet) => {
          const collect = (rules) => [...rules].flatMap((rule) => rule.cssRules ? collect(rule.cssRules) : [rule])
          try { return collect(sheet.cssRules) } catch { return [] }
        }).filter((rule) => rule.selectorText && document.querySelector('#sidebar').matches(rule.selectorText) && /width|display/.test(rule.style.cssText)).map((rule) => ({ selector: rule.selectorText, css: rule.style.cssText })),
        mediaNarrow: matchMedia('(max-width: 760px)').matches,
        layout: rect('.layout'),
        sidebar: rect('.sidebar'),
        chat: rect('.chat'),
        messages: rect('.messages'),
        composer: rect('.composer'),
        composerBox: rect('.composer-box'),
        composerActions: rect('.composer-right, .composer-actions'),
        titlebarActions: rect('.titlebar-actions'),
        overflowNodes: [...document.querySelectorAll('body *')]
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            id: element.id,
            className: typeof element.className === 'string' ? element.className : '',
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width)
          }))
          .filter((element) => element.width > 0 && element.right > innerWidth + 1)
          .slice(0, 12)
      }
    })
    if (mobile.documentWidth > mobile.viewport + 1 || mobile.bodyWidth > mobile.viewport + 1) {
      throw new Error(scheme + ' mobile horizontal overflow: ' + JSON.stringify(mobile))
    }
    if (mobile.composer.right > mobile.viewport + 1 || mobile.composerActions.right > mobile.composer.right + 1) {
      throw new Error(scheme + ' mobile composer controls overflow: ' + JSON.stringify(mobile))
    }
    if (scheme === 'd' && mobile.titlebarActions.right > mobile.viewport + 1) {
      throw new Error('d mobile titlebar actions overflow: ' + JSON.stringify(mobile.titlebarActions))
    }
    await win.screenshot({ path: path.join(runRoot, scheme + '-mobile.png') })
    console.log(JSON.stringify({ scheme, desktop, mobile }))
    await app.close()
    app = null
  }
  if (errors.length) throw new Error('Page errors: ' + errors.join(' | '))
  console.log('Screenshots: ' + path.relative(root, runRoot))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  if (app) await app.close()
})
