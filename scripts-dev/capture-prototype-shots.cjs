// Capture zcode-platform-v2 prototype screenshots for visual verification.
// Usage: node scripts-dev/capture-prototype-shots.cjs
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PROTOTYPE = path.join(ROOT, 'design-prototypes', 'zcode-platform-v2', 'prototype', 'index.html');
const OUT = path.join(ROOT, 'output', 'prototype-v2-features');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PROTO_BROWSER || 'msedge' });
  const errors = [];

  async function shot(name, { width = 1440, height = 900, actions, mobile = false } = {}) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (err) => errors.push(`[${name}] pageerror: ${err.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[${name}] console: ${msg.text()}`); });
    await page.goto(`file:///${PROTOTYPE.replace(/\\/g, '/')}`);
    await page.waitForTimeout(1700);
    if (actions) await actions(page);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await page.close();
  }

  await shot('01-content-desktop');
  await shot('02-world-menu', { actions: async (page) => { await page.click('[data-open="world-menu"]'); await page.waitForTimeout(400); } });
  await shot('03-design-desktop', { actions: async (page) => { await page.click('#tab-design'); await page.waitForTimeout(400); } });
  await shot('04-library', { actions: async (page) => { await page.click('[data-open="library"]'); await page.waitForTimeout(450); } });
  await shot('05-library-row-menu', { actions: async (page) => { await page.click('[data-open="library"]'); await page.waitForTimeout(450); await page.click('.kernel-row:first-child [data-row-menu]'); await page.waitForTimeout(350); } });
  await shot('06-library-archived-filter', { actions: async (page) => { await page.click('[data-open="library"]'); await page.waitForTimeout(450); await page.click('[data-filter="archived"]'); await page.waitForTimeout(300); } });
  await shot('07-source', { actions: async (page) => { await page.click('#tab-design'); await page.waitForTimeout(300); await page.click('.design-actions [data-open="source"]'); await page.waitForTimeout(450); } });
  await shot('08-gallery', { actions: async (page) => { await page.click('[data-open="gallery"]'); await page.waitForTimeout(450); } });
  await shot('09-settings-appearance', { actions: async (page) => { await page.click('[data-open="settings"]'); await page.waitForTimeout(450); } });
  await shot('10-settings-models', { actions: async (page) => { await page.click('[data-open="settings"]'); await page.waitForTimeout(450); await page.click('[data-settings-tab="models"]'); await page.waitForTimeout(300); } });
  await shot('11-model-chip-menu', { actions: async (page) => { await page.click('[data-model-menu="text"]'); await page.waitForTimeout(350); } });
  await shot('12-version-pop', { actions: async (page) => { await page.click('#tab-design'); await page.waitForTimeout(300); await page.click('#version-chip'); await page.waitForTimeout(350); } });
  await shot('13-story-search', { actions: async (page) => { await page.keyboard.press('Control+f'); await page.waitForTimeout(250); await page.fill('#story-search-input', '印章'); await page.waitForTimeout(500); } });
  await shot('14-rail-pop', { actions: async (page) => { await page.click('#rail-track'); await page.waitForTimeout(350); } });
  await shot('15-manage-sessions', { actions: async (page) => { await page.click('[data-open="world-menu"]'); await page.waitForTimeout(300); await page.click('[data-manage="session"]'); await page.waitForTimeout(350); } });
  await shot('16-guide', { actions: async (page) => { await page.click('[data-open="world-menu"]'); await page.waitForTimeout(300); await page.click('[data-open="guide"]'); await page.waitForTimeout(400); } });
  await shot('17-settings-models-detail', { actions: async (page) => { await page.click('[data-open="settings"]'); await page.waitForTimeout(400); await page.click('[data-settings-tab="models"]'); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('#setting-illust-size').scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); } });

  await shot('20-content-mobile', { width: 390, height: 844 });
  await shot('21-library-mobile', { width: 390, height: 844, actions: async (page) => { await page.click('.command-dock [data-open="library"]'); await page.waitForTimeout(450); } });
  await shot('22-settings-mobile', { width: 390, height: 844, actions: async (page) => { await page.click('#theme-toggle'); await page.waitForTimeout(200); await page.keyboard.press('Control+Comma'); await page.waitForTimeout(450); } });

  // Interaction smoke checks
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (err) => errors.push(`[smoke] pageerror: ${err.message}`));
  await page.goto(`file:///${PROTOTYPE.replace(/\\/g, '/')}`);
  await page.waitForTimeout(1700);
  const results = [];
  const origClick = page.click.bind(page);
  page.click = async (...args) => {
    try { return await origClick(...args); } catch (err) { await page.screenshot({ path: path.join(OUT, 'debug-fail.png') }); throw err; }
  };

  // multi-select
  await page.click('.choice-row.multi[aria-pressed="false"]');
  results.push(['multi-select count updates', (await page.textContent('#multi-count')).includes('2')]);

  // pending dismiss
  await page.click('#pending-dismiss');
  results.push(['pending banner hides', await page.isHidden('#pending-banner')]);

  // model chip select
  await page.click('[data-model-menu="text"]');
  await page.waitForTimeout(200);
  await page.click('#model-menu-pop [data-option="深流 v3"]');
  results.push(['model chip updates', (await page.textContent('[data-model-menu="text"] span')).includes('深流 v3')]);

  // world line switch
  await page.click('[data-open="world-menu"]');
  await page.waitForTimeout(200);
  await page.click('[data-worldline="白霜航道"]');
  results.push(['world line switch', (await page.textContent('.brand-copy span')).includes('白霜航道')]);

  // command palette entries
  await page.keyboard.press('Control+p');
  await page.waitForTimeout(200);
  const cmdText = await page.textContent('#command-list');
  results.push(['palette has gallery/settings', cmdText.includes('打开画廊') && cmdText.includes('打开设置')]);
  await page.keyboard.press('Escape');

  // settings theme switch
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(400);
  await page.click('[data-setting="theme"][data-value="light"]');
  results.push(['light theme applies', (await page.getAttribute('html', 'data-theme')) === 'light']);
  await page.click('[data-setting="accent"][data-value="rose"]');
  results.push(['accent applies', (await page.getAttribute('html', 'data-accent')) === 'rose']);
  await page.keyboard.press('Escape');

  // archive + delete via row menu
  await page.keyboard.press('Control+Shift+l');
  await page.waitForTimeout(450);
  await page.click('.kernel-row[data-status="draft"] [data-row-menu]');
  await page.waitForTimeout(250);
  await page.click('[data-row-action="archive"]');
  await page.waitForTimeout(250);
  results.push(['archive moves row', (await page.getAttribute('.kernel-row[data-name*="无名草稿"]', 'data-status')) === 'archived']);
  await page.click('.kernel-row[data-name*="雾港之谜"] [data-row-menu]');
  await page.waitForTimeout(250);
  await page.click('[data-row-action="delete"]');
  await page.waitForTimeout(250);
  await page.click('#confirm-ok');
  await page.waitForTimeout(250);
  results.push(['delete removes row', (await page.$$eval('#kernel-list .kernel-row', (rows) => rows.length)) === 4]);
  results.push(['library count updates', (await page.textContent('#library-count')).trim().startsWith('4')]);

  // publish
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await page.click('#publish-kernel');
  results.push(['publish updates chip', (await page.textContent('#version-chip-text')).includes('已发布')]);

  // quick prompt
  await page.click('.prompt-row .prompt-chip:nth-of-type(2)');
  results.push(['quick prompt fills input', (await page.inputValue('#design-input')).includes('规则骨架')]);

  // story search
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(200);
  await page.fill('#story-search-input', '印章');
  await page.waitForTimeout(500);
  results.push(['story search counts hits', (await page.textContent('#story-search-count')).trim() === '1 / 1']);
  results.push(['story search highlights', (await page.$$('.story-copy mark.search-hit.current')).length === 1]);
  await page.click('#story-search-close');
  results.push(['story search clears', (await page.$$('.story-copy mark.search-hit')).length === 0]);

  // choices collapse
  await page.click('#choices-toggle');
  results.push(['choices collapse hides rows', await page.isHidden('#choice-rows')]);
  results.push(['collapse toggle label', (await page.textContent('#choices-toggle')).trim() === '展开']);
  await page.click('#choices-toggle');
  results.push(['choices expand restores', !(await page.isHidden('#choice-rows'))]);

  // status rail
  await page.click('#rail-track');
  await page.waitForTimeout(250);
  results.push(['rail popover opens', !(await page.isHidden('#rail-pop'))]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(400);
  await page.click('.switch[data-setting="statusrail"]');
  await page.waitForTimeout(200);
  results.push(['status rail hide setting', await page.isHidden('#story-rail')]);
  await page.keyboard.press('Escape');

  // session manage: rename + delete
  await page.click('[data-open="world-menu"]');
  await page.waitForTimeout(250);
  await page.click('[data-manage="session"]');
  await page.waitForTimeout(250);
  await page.click('[data-mi="rename"][data-index="1"]');
  await page.waitForTimeout(250);
  await page.fill('#confirm-input', '第 11 幕 · 雾河夜航');
  await page.click('#confirm-ok');
  await page.waitForTimeout(250);
  results.push(['session renamed in menu', await page.locator('[data-session="第 11 幕 · 雾河夜航"]').count() === 1]);
  await page.click('[data-open="world-menu"]');
  await page.waitForTimeout(250);
  await page.click('[data-manage="session"]');
  await page.waitForTimeout(250);
  await page.click('[data-mi="delete"][data-index="2"]');
  await page.waitForTimeout(250);
  await page.click('#confirm-ok');
  await page.waitForTimeout(250);
  results.push(['session deleted', (await page.$$eval('[data-session]', (els) => els.length)) === 2]);

  // worldline bind entry
  await page.click('[data-open="world-menu"]');
  await page.waitForTimeout(250);
  await page.click('[data-manage="worldline"]');
  await page.waitForTimeout(250);
  await page.click('[data-mi="bind"][data-index="1"]');
  await page.waitForTimeout(400);
  results.push(['bind opens library', await page.$eval('#library-sheet', (el) => el.classList.contains('open'))]);
  await page.keyboard.press('Escape');

  // guide
  await page.click('[data-open="world-menu"]');
  await page.waitForTimeout(250);
  await page.click('[data-open="guide"]');
  await page.waitForTimeout(350);
  results.push(['guide opens', await page.$eval('#guide-layer', (el) => el.classList.contains('open'))]);
  await page.click('#guide-next');
  await page.click('#guide-next');
  results.push(['guide last step label', (await page.textContent('#guide-next')).includes('开始体验')]);
  await page.click('#guide-next');
  await page.waitForTimeout(250);
  results.push(['guide closes at end', await page.$eval('#guide-layer', (el) => !el.classList.contains('open'))]);

  // gallery lightbox
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(400);
  await page.click('#gallery-grid .gallery-tile img');
  await page.waitForTimeout(250);
  results.push(['lightbox opens', !(await page.isHidden('#gallery-lightbox'))]);
  results.push(['lightbox caption', (await page.textContent('#lightbox-caption')).includes('雾灯')]);
  await page.click('#lightbox-close');
  results.push(['lightbox closes', await page.isHidden('#gallery-lightbox')]);
  await page.keyboard.press('Escape');

  for (const [name, pass] of results) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  await page.close();
  await browser.close();

  if (errors.length) {
    console.log('\nBROWSER ERRORS:');
    errors.forEach((e) => console.log('  ' + e));
  }
  const failed = results.filter(([, p]) => !p).length;
  console.log(`\n${failed === 0 && errors.length === 0 ? 'ALL PASS' : `${failed} FAILED, ${errors.length} ERRORS`} · screenshots in ${OUT}`);
  process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
