const { chromium } = require('../.tools/node_modules/playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');

const extensionPath = process.env.EXT_PATH
  ? path.resolve(process.env.EXT_PATH)
  : path.resolve(__dirname, '..');
const chromePath = path.resolve(__dirname, '..', '.tools', 'chromium-102', 'chrome-win', 'chrome.exe');
const profilePath = path.resolve(__dirname, '..', '.tools', 'profile-102');

function panelQuery(page, fn, arg) {
  return page.evaluate(({ source, arg }) => {
    const host = document.querySelector('#floatnote-root');
    if (!host) return null;
    const root = host.shadowRoot;
    return (new Function('root', 'host', 'return (' + source + ')(root, host, arguments[2])'))(root, host, arg);
  }, { source: fn.toString(), arg });
}

(async () => {
  fs.rmSync(profilePath, { recursive: true, force: true });
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Chrome 102 test</title><style>body{font-family:system-ui;margin:60px;background:#f8f9ff;color:#222}</style><h1>Chrome 102.0.5005</h1><p>Extension smoke test page.</p>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 1100, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });
  let workers = context.serviceWorkers();
  if (!workers.length) {
    workers = [await context.waitForEvent('serviceworker', { timeout: 8000 })];
  }
  const worker = workers[0];
  console.log('worker:', worker.url());
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();
  page.on('pageerror', err => console.log('[pageerror]', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[console error]', msg.text());
  });
  await page.goto(url);
  await page.waitForTimeout(1200);
  const hostCount = await page.evaluate(() => document.querySelectorAll('#floatnote-root').length);
  console.log('panel count:', hostCount);
  console.log('initial panel:', (await panelQuery(page, (root) => root.querySelector('.fn-card').innerText)).replace(/\s+/g, ' '));
  await page.screenshot({ path: path.join(__dirname, 'screenshot-102-empty.png') });

  await panelQuery(page, (root) => root.getElementById('fn-start').click());
  await page.waitForTimeout(250);
  await panelQuery(page, (root) => {
    const title = root.getElementById('fn-title');
    title.value = 'Chrome 102 验证';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const row = root.querySelector('.fn-edit-text');
    row.focus();
  });
  await page.keyboard.type('第一层项目');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.type('第二层项目');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  await page.keyboard.type('第三层项目');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  await page.keyboard.type('第四层项目');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(120);
  await page.keyboard.type('（回到二级）');
  await page.waitForTimeout(900);

  console.log('editor rows:', await panelQuery(page, (root) => Array.from(root.querySelectorAll('.fn-edit-row')).map(row => ({
    depth: row.style.getPropertyValue('--fn-depth'),
    text: row.querySelector('.fn-edit-text').textContent
  }))));
  await page.screenshot({ path: path.join(__dirname, 'screenshot-102-edit.png') });

  await panelQuery(page, (root) => root.getElementById('fn-done').click());
  await page.waitForTimeout(600);
  console.log('view panel:', (await panelQuery(page, (root) => root.querySelector('.fn-card').innerText)).replace(/\s+/g, ' '));
  console.log('font computed:', await panelQuery(page, (root) => ({
    width: getComputedStyle(root.host).width,
    font: getComputedStyle(root.querySelector('.fn-view-text')).fontFamily,
    theme: root.host.getAttribute('data-theme')
  })));
  await page.screenshot({ path: path.join(__dirname, 'screenshot-102-view.png') });

  // Numbered list and collapse behavior.
  await panelQuery(page, (root) => root.getElementById('fn-edit').click());
  await page.waitForTimeout(250);
  await panelQuery(page, (root) => root.getElementById('fn-style-number').click());
  await page.waitForTimeout(300);
  console.log('number markers:', await panelQuery(page, (root) => Array.from(root.querySelectorAll('.fn-edit-marker')).map(marker => marker.textContent)));
  await panelQuery(page, (root) => root.getElementById('fn-done').click());
  await page.waitForTimeout(600);
  console.log('number view markers:', await panelQuery(page, (root) => Array.from(root.querySelectorAll('.fn-view-marker')).map(marker => marker.textContent)));
  await panelQuery(page, (root) => root.getElementById('fn-collapse').click());
  await page.waitForTimeout(200);
  console.log('collapsed:', await panelQuery(page, (root) => ({
    collapsed: root.querySelector('.fn-card').classList.contains('is-collapsed'),
    height: root.host.getBoundingClientRect().height
  })));
  await panelQuery(page, (root) => root.getElementById('fn-collapse').click());
  await page.waitForTimeout(200);

  const storage = await worker.evaluate(() => new Promise(resolve => chrome.storage.local.get(null, resolve)));
  console.log('storage notes:', Object.keys(storage['floatnote.notes.v1'] || {}));
  console.log('stored note:', storage['floatnote.notes.v1'] && storage['floatnote.notes.v1'][Object.keys(storage['floatnote.notes.v1'])[0]]);

  await page.reload();
  await page.waitForTimeout(900);
  console.log('after reload:', (await panelQuery(page, (root) => root.querySelector('.fn-card').innerText)).replace(/\s+/g, ' '));

  const dragBox = await page.evaluate(() => {
    const host = document.querySelector('#floatnote-root');
    const handle = host.shadowRoot.getElementById('fn-drag-handle');
    const rect = handle.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await page.mouse.move(dragBox.x + 40, dragBox.y + 15);
  await page.mouse.down();
  await page.mouse.move(600, 170, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  console.log('dragged:', await panelQuery(page, (root) => ({
    left: root.host.style.getPropertyValue('left'),
    top: root.host.style.getPropertyValue('top')
  })));

  if (extensionId) {
    await page.bringToFront();
    const popupPromise = context.waitForEvent('page');
    await worker.evaluate(async options => {
      await new Promise(resolve => chrome.tabs.create(options, resolve));
    }, { url: `chrome-extension://${extensionId}/src/popup.html`, active: false });
    const popup = await popupPromise;
    popup.on('pageerror', err => console.log('[popup pageerror]', err.message));
    await popup.waitForLoadState('load');
    await popup.waitForTimeout(700);
    console.log('popup body:', (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 500));
    await popup.screenshot({ path: path.join(__dirname, 'screenshot-102-popup.png'), clip: { x: 0, y: 0, width: 372, height: 600 } });
    await popup.evaluate(() => document.querySelector('[data-theme="dark"]').click());
    await popup.evaluate(() => document.querySelector('[data-corner="top-left"]').click());
    await popup.evaluate(() => {
      const input = document.getElementById('width-range');
      input.value = '400';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(700);
    console.log('page after popup settings:', await panelQuery(page, (root) => ({
      theme: root.host.getAttribute('data-theme'),
      left: root.host.style.getPropertyValue('left'),
      top: root.host.style.getPropertyValue('top'),
      width: getComputedStyle(root.host).width
    })));

    const popupClosed = popup.waitForEvent('close', { timeout: 5000 });
    await popup.evaluate(() => document.getElementById('open-panel').click());
    await popupClosed;
    await page.waitForTimeout(500);
    console.log('editor opened from popup:', await panelQuery(page, (root) => !root.getElementById('fn-editor').hidden));
    await panelQuery(page, (root) => root.getElementById('fn-done').click());
    await page.waitForTimeout(500);
  }

  if (extensionId) {
    const options = await context.newPage();
    options.on('pageerror', err => console.log('[options pageerror]', err.message));
    await options.goto(`chrome-extension://${extensionId}/src/options.html`);
    await options.waitForTimeout(800);
    console.log('options title:', await options.title());
    console.log('options body:', (await options.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300));
    await options.screenshot({ path: path.join(__dirname, 'screenshot-102-options.png'), fullPage: true });
  }

  await context.close();
  server.close();
})().catch(error => { console.error(error); process.exit(1); });
