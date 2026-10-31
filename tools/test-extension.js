const { chromium } = require('../.tools/node_modules/playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');

const extensionPath = path.resolve(__dirname, '..');
const chromePath = path.resolve(__dirname, '..', '.tools', 'chrome-win64', 'chrome.exe');
const profilePath = path.resolve(__dirname, '..', '.tools', 'profile-smoke');

function serve() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>测试页面 ${req.url}</title>
      <style>body{font-family:system-ui;margin:60px;background:#f8f9ff;color:#222}h1{font-size:32px}main{max-width:760px}</style>
      </head><body><main><h1>浮笺测试页面</h1><p>当前路径：<code>${req.url}</code></p>
      <p>这是用于验证按网址保存备注、悬浮窗和多级列表的本地页面。</p>
      <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.</p>
      </main></body></html>`);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function panelText(page) {
  return page.locator('#floatnote-root').evaluate(el => {
    const card = el.shadowRoot.querySelector('.fn-card');
    return card ? card.innerText.replace(/\s+/g, ' ').trim() : 'NO CARD';
  }).catch(error => 'NO PANEL: ' + error.message);
}

async function clickShadow(page, id) {
  await page.locator('#floatnote-root').evaluate((el, targetId) => {
    const target = el.shadowRoot.getElementById(targetId);
    if (!target) throw new Error('Missing #' + targetId);
    target.click();
  }, id);
}

(async () => {
  fs.rmSync(profilePath, { recursive: true, force: true });
  const server = await serve();
  const port = server.address().port;
  const urlA = `http://127.0.0.1:${port}/notes/a`;
  const urlB = `http://127.0.0.1:${port}/notes/b?tab=1`;

  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: chromePath,
    headless: true,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });
  context.on('close', () => console.log('[context closed]'));

  let workers = context.serviceWorkers();
  if (!workers.length) {
    const worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    workers = [worker];
  }
  console.log('workers:', workers.map(w => w.url()));
  const extensionId = workers[0] ? new URL(workers[0].url()).host : null;
  console.log('extension id:', extensionId);

  const page = await context.newPage();
  page.on('pageerror', err => console.log('[pageerror]', err.message));
  page.on('close', () => console.log('[page closed]', page.url()));
  await page.goto(urlA, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  console.log('panel hosts:', await page.locator('#floatnote-root').count());
  console.log('empty panel:', await panelText(page));
  await page.screenshot({ path: path.join(__dirname, 'screenshot-page-empty.png') });

  await clickShadow(page, 'fn-start');
  await page.waitForTimeout(300);

  await page.locator('#floatnote-root').evaluate(el => {
    const root = el.shadowRoot;
    const title = root.getElementById('fn-title');
    title.value = '本周重点';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const row = root.querySelector('.fn-edit-text');
    row.focus();
    row.textContent = '整理产品需求';
    row.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('Enter');
  await page.keyboard.type('确认交互稿');
  await page.keyboard.press('Tab');
  await page.keyboard.type('移动端布局');
  await page.keyboard.press('Enter');
  await page.keyboard.type('桌面端适配');
  await page.waitForTimeout(900);
  console.log('editor rows:', await page.locator('#floatnote-root').evaluate(el =>
    Array.from(el.shadowRoot.querySelectorAll('.fn-edit-row')).map(row => ({
      depth: row.style.getPropertyValue('--fn-depth'),
      text: row.querySelector('.fn-edit-text').textContent
    }))
  ));
  await page.screenshot({ path: path.join(__dirname, 'screenshot-page-edit.png') });

  await clickShadow(page, 'fn-done');
  await page.waitForTimeout(700);
  console.log('view text:', await panelText(page));
  let shotOk = true;
  try {
    await page.screenshot({ path: path.join(__dirname, 'screenshot-page-view.png') });
  } catch (error) {
    shotOk = false;
    console.log('[view screenshot failed]', error.message.split('\n')[0]);
  }
  console.log('view screenshot ok:', shotOk);

  if (!page.isClosed()) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(700);
    console.log('after reload:', await panelText(page));

    await page.goto(urlA + '#section-2', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    console.log('hash page:', await panelText(page));

    // Drag the panel by its header and confirm the custom position is stored.
    const handle = await page.locator('#fn-drag-handle').boundingBox();
    if (handle) {
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(640, 130, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(700);
      console.log('dragged position:', await page.locator('#floatnote-root').evaluate(el => ({
        left: el.style.getPropertyValue('left'),
        top: el.style.getPropertyValue('top')
      })));
    }
  }

  if (!page.isClosed()) {
    await page.goto(urlB, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    console.log('other page:', await panelText(page));
  }

  if (extensionId && !page.isClosed()) {
    await page.goto(urlA, { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForTimeout(500);

    const popupPromise = context.waitForEvent('page');
    await workers[0].evaluate(async options => {
      await new Promise(resolve => chrome.tabs.create(options, resolve));
    }, { url: `chrome-extension://${extensionId}/src/popup.html`, active: false });
    const popup = await popupPromise;
    popup.on('pageerror', err => console.log('[popup pageerror]', err.message));
    await popup.waitForLoadState('load');
    await popup.waitForTimeout(700);
    console.log('popup title:', await popup.title());
    console.log('popup body:', (await popup.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 700));
    await popup.screenshot({ path: path.join(__dirname, 'screenshot-popup.png'), clip: { x: 0, y: 0, width: 372, height: 600 } });

    // Theme change should reach the open page immediately.
    await popup.locator('[data-theme="dark"]').click();
    await page.waitForTimeout(500);
    console.log('page theme after popup dark:', await page.locator('#floatnote-root').evaluate(el => el.getAttribute('data-theme')));
    await popup.screenshot({ path: path.join(__dirname, 'screenshot-popup-dark.png'), clip: { x: 0, y: 0, width: 372, height: 600 } });

    // Position preset should update the panel.
    await popup.locator('[data-corner="top-left"]').click();
    await page.waitForTimeout(500);
    console.log('page panel position:', await page.locator('#floatnote-root').evaluate(el => ({
      left: el.style.getPropertyValue('left'),
      right: el.style.getPropertyValue('right'),
      top: el.style.getPropertyValue('top')
    })));

    // Width slider.
    await popup.locator('#width-range').evaluate(input => {
      input.value = '420';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(700);
    console.log('page panel width:', await page.locator('#floatnote-root').evaluate(el => ({
      rect: el.getBoundingClientRect().width,
      computed: getComputedStyle(el).width,
      custom: el.style.getPropertyValue('--fn-width')
    })));
    await page.screenshot({ path: path.join(__dirname, 'screenshot-page-dark-420.png') });
    await popup.screenshot({ path: path.join(__dirname, 'screenshot-popup-dark-420.png'), clip: { x: 0, y: 0, width: 372, height: 600 } });

    // The popup's primary action should open the editor and close the popup tab.
    await popup.locator('[data-theme="light"]').click();
    await popup.locator('[data-corner="top-right"]').click();
    await page.waitForTimeout(300);
    const popupClosed = popup.waitForEvent('close', { timeout: 5000 });
    await popup.locator('#open-panel').click();
    await popupClosed;
    await page.waitForTimeout(500);
    console.log('editor open via popup:', await page.locator('#floatnote-root').evaluate(el => !el.shadowRoot.getElementById('fn-editor').hidden));
    await clickShadow(page, 'fn-done');
    await page.waitForTimeout(500);

    const optionsPromise = context.waitForEvent('page');
    await workers[0].evaluate(async options => {
      await new Promise(resolve => chrome.tabs.create(options, resolve));
    }, { url: `chrome-extension://${extensionId}/src/options.html`, active: false });
    const options = await optionsPromise;
    options.on('pageerror', err => console.log('[options pageerror]', err.message));
    await options.waitForLoadState('load');
    await options.waitForTimeout(900);
    console.log('options body:', (await options.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 700));
    await options.screenshot({ path: path.join(__dirname, 'screenshot-options.png'), fullPage: true });

    await options.locator('#search-notes').fill('not-a-real-note');
    await options.waitForTimeout(250);
    console.log('options empty search:', await options.locator('#empty-title').innerText());
    await options.locator('#search-notes').fill('本周');
    await options.waitForTimeout(250);
    console.log('options search count:', await options.locator('#result-count').innerText());
    await options.locator('#search-notes').fill('');
    await options.waitForTimeout(250);

    await options.evaluate(() => {
      const original = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        window.__floatnoteExportBlob = blob;
        return original.call(URL, blob);
      };
    });
    await options.locator('#export-data').click();
    await options.waitForTimeout(250);
    const exportText = await options.evaluate(() => window.__floatnoteExportBlob
      ? window.__floatnoteExportBlob.text()
      : 'NO BLOB');
    const exported = JSON.parse(exportText);
    console.log('export:', {
      app: exported.app,
      notes: Object.keys(exported.notes || {}).length,
      width: exported.settings && exported.settings.width
    });

    const importedUrl = `http://127.0.0.1:${port}/imported`;
    const backup = {
      app: 'floatnote',
      schemaVersion: 1,
      notes: {
        [importedUrl]: {
          url: importedUrl,
          title: '从备份导入',
          items: [
            { t: '导入的第一层', d: 0 },
            { t: '导入的第二层', d: 1 },
            { t: '导入的第三层', d: 2 }
          ],
          listStyle: 'number',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      }
    };
    await options.locator('#import-file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup), 'utf8')
    });
    await options.waitForTimeout(350);
    console.log('import dialog:', await options.locator('#confirm-dialog').evaluate(dialog => ({
      open: dialog.open,
      title: dialog.querySelector('#confirm-title').textContent,
      message: dialog.querySelector('#confirm-message').textContent
    })));
    await options.locator('#confirm-accept').click();
    await options.waitForTimeout(700);
    console.log('notes after import:', await options.locator('#stat-notes').innerText());
    console.log('imported rendered:', (await options.locator('#notes-list').innerText()).replace(/\s+/g, ' ').slice(0, 250));

    // Clear everything and verify the empty state.
    await options.locator('#clear-data').click();
    await options.waitForTimeout(200);
    await options.locator('#confirm-accept').click();
    await options.waitForTimeout(700);
    console.log('notes after clear:', await options.locator('#stat-notes').innerText());
    console.log('empty state visible:', await options.locator('#empty-state').isVisible());
  }

  await context.close();
  server.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
