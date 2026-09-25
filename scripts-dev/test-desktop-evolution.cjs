'use strict'
/* 桌面演化回归 · 三套界面（classic / proto / d）。
 *
 * 界面方案只走正式通道：main.cjs 的 readUiScheme() 只读 app.getPath('userData')/ui-scheme.json，
 * 不认 SIXWORLDS_UI_SCHEME 环境变量。旧写法靠该环境变量会三套界面实际全跑 classic、覆盖失真。
 * 现在：每套方案独立 workspace/output 下的 profile（SIXWORLDS_TEST_USER_DATA），启动后调正式
 * API window.api.setUiScheme(scheme)，等实际 /ui/<scheme>/index.html 落地并断言 api 值一致。
 * 业务断言（调色板/主题对比度矩阵、存档创建、焦点与导航、窄屏工具）原样保留。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron } = require('playwright')
const root = path.join(__dirname, '..')
const output = path.join(root, 'output', 'desktop-evolution')
fs.mkdirSync(output, { recursive: true })
/* 每轮独立 profile：profilesRoot 下 mkdtempSync 出唯一 run 根，每套方案各自一个子目录，
 * 落在 workspace/output 下（不写真实 userData、不复用历史数据）。 */
const profilesRoot = path.join(root, 'output', 'desktop-evolution-profiles')
fs.mkdirSync(profilesRoot, { recursive: true })
const runRoot = fs.mkdtempSync(path.join(profilesRoot, 'run-'))
const palettes = ['classic','paper','forest','violet','ocean','rose','contrast']
let app
async function main() {
  for (const scheme of ['classic','proto','d']) {
    const profile = path.join(runRoot, scheme, 'profile')
    const appdata = path.join(runRoot, scheme, 'appdata'), temp = path.join(runRoot, scheme, 'tmp')
    for (const dir of [profile, appdata, temp]) fs.mkdirSync(dir, { recursive: true })
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS:'true', SIXWORLDS_TEST:'1', SIXWORLDS_TEST_USER_DATA: profile, APPDATA: appdata, TEMP: temp, TMP: temp, TMPDIR: temp }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ executablePath: require('electron'), args:['.'], cwd:root, env })
    const win = await app.firstWindow()
    await win.waitForSelector('#btn-archives', { timeout: 30000 })
    await win.waitForTimeout(1500)
    /* 先等待导航，再调正式切换，避免 IPC 返回前当前上下文已销毁。 */
    const current = await win.evaluate(() => window.api.uiScheme())
    if (current !== scheme) {
      const navigation = win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 30000 })
      await win.evaluate((s) => { setTimeout(() => { void window.api.setUiScheme(s) }, 0) }, scheme)
      await navigation
    }
    await win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 30000 })
    await win.waitForSelector('#btn-archives', { timeout: 30000 })
    assert.equal(await win.evaluate(() => window.api.uiScheme()), scheme, 'api.uiScheme() 必须等于目标方案')
    assert.ok((await win.evaluate(() => location.pathname.replace(/\\/g, '/'))).includes('/ui/' + scheme + '/index.html'), '实际入口必须是 ui/' + scheme + '/index.html')
    const errors=[]; win.on('pageerror', (e)=>errors.push(e.message))
    await win.evaluate(() => { localStorage.clear(); localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({skipSplash:true,theme:'dark',palette:'classic'})) })
    await win.reload(); await win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 30000 }); await win.waitForSelector('#btn-archives'); await win.waitForTimeout(1500)
    await win.setViewportSize({width:1200,height:800})
    for(const palette of palettes) for(const theme of ['light','dark']) {
      await win.evaluate(({palette,theme})=>{ document.documentElement.dataset.palette=palette; document.documentElement.dataset.theme=theme },{palette,theme})
      await win.click('#btn-kernel-hub')
      const audit=await win.evaluate(()=>{
        const r=getComputedStyle(document.documentElement),hub=getComputedStyle(document.getElementById('kernel-hub'))
        function rgb(value){ const div=document.createElement('div');div.style.color=value;document.body.append(div);const out=getComputedStyle(div).color.match(/[0-9.]+/g).slice(0,3).map(Number);div.remove();return out }
        const luminance=(color)=>rgb(color).map(v=>v/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)
        const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
        return {text:ratio(r.getPropertyValue('--text'),r.getPropertyValue('--panel')),muted:ratio(r.getPropertyValue('--text-dim'),r.getPropertyValue('--panel-2')),button:ratio(r.getPropertyValue('--accent'),r.getPropertyValue('--on-accent')),hub:hub.backgroundColor,bg:rgb(r.getPropertyValue('--bg')).join(','),accent:r.getPropertyValue('--accent').trim(),hubAccent:hub.getPropertyValue('--kh-brand').trim(),overflow:document.documentElement.scrollWidth>innerWidth+1}
      })
      assert.ok(audit.text>=4.5,JSON.stringify({palette,theme,audit}))
      assert.ok(audit.muted>=4.5,JSON.stringify({palette,theme,audit}))
      assert.ok(audit.button>=4.5,JSON.stringify({palette,theme,audit}))
      assert.equal(audit.accent,audit.hubAccent,'workspace follows palette')
      assert.equal(audit.overflow,false)
      await win.screenshot({path:path.join(output,scheme+'-'+palette+'-'+theme+'-kernel.png')})
      await win.click('#btn-content-area')
      await win.click('#btn-archives')
      await win.waitForSelector('.product-panel')
      await win.screenshot({path:path.join(output,scheme+'-'+palette+'-'+theme+'-archives.png')})
      await win.keyboard.press('Escape')
      assert.equal(await win.locator('.product-panel').count(),0)
    }
    await win.click('#btn-archives')
    await win.fill('.product-toolbar input','恢复测试')
    await win.getByRole('button',{name:'创建存档',exact:true}).click()
    await win.waitForFunction(()=>document.querySelector('.product-list')?.textContent.includes('恢复测试'))
    await win.keyboard.press('Escape')
    await win.click('#btn-story-memory')
    await win.getByRole('tab',{name:'伏笔',exact:true}).click()
    assert.equal(await win.getByRole('tab',{name:'伏笔',exact:true}).getAttribute('aria-selected'),'true')
    await win.keyboard.press('ArrowRight')
    assert.equal(await win.getByRole('tab',{name:'修正记录',exact:true}).getAttribute('aria-selected'),'true')
    await win.keyboard.press('Escape')
    await win.setViewportSize({width:700,height:720})
    await win.click('#btn-story-chapters')
    const fit=await win.locator('.product-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})
    assert.equal(fit,true)
    await win.screenshot({path:path.join(output,scheme+'-narrow-chapters.png')})
    await win.keyboard.press('Escape')
    assert.deepEqual(errors,[])
    console.log('PASS '+scheme+' ('+(await win.evaluate(() => location.pathname.replace(/\\/g, '/'))).replace(/^.*\/ui\//, 'ui/')+'): 14 palette/mode combinations, archive creation, focus/navigation, narrow tools')
    await app.close();app=null
  }
  console.log('（本轮 profile：'+path.relative(root,runRoot)+'）')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close()})
