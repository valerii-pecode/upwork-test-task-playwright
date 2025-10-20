import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('e2e: load extension, open UI, download video and verify welcome_to_insightai_acadmey file', async () => {
  const extensionPath = path.resolve('C:\\Users\\L0000166\\VS projects\\upwork-test-task-playwright\\release\\loom-downloader');
  const extensionId = 'ickdkaamkgfcdaflgombpihjpkcblgmp';
  const targetUrl = 'https://www.skool.com/insightai-academy-3338/about';
  const downloadsKeyword = 'welcome_to_insightai_acadmey';

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    acceptDownloads: true,
  });
// navigate to target page
  try {
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    const ui = await context.newPage();
    await ui.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
    await ui.screenshot({ path: `extension-ui.png`, fullPage: true });

    // auth to extension
    try {
      await ui.fill('input[type="email"]', 'test@serp.co', { timeout: 1000 });
      await ui.fill('input[name="license"], input[type="text"]', 'test', { timeout: 1000 });
      const submit = await ui.$('button:has-text("Activate"), button:has-text("Login"), button:has-text("Authorize")');
      await ui.screenshot({ path: `extension-login.png`, fullPage: true });
      if (submit) await submit.click();
      await ui.waitForTimeout(800);
    } catch {}

    // back to target page and trigger download
    await page.bringToFront();
    await page.waitForTimeout(500);

    const selectors = [
      'button:has-text("Download")',
    ];

    let clicked = false;
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) { await el.scrollIntoViewIfNeeded(); await el.click({ force: true }); clicked = true; break; }
    }
    if (!clicked) {
      const first = await page.$('button');
      if (first) { await first.scrollIntoViewIfNeeded(); await first.click({ force: true }); clicked = true; }
    }
    if (!clicked) throw new Error('Download trigger not found on page.');

    // wait for the extension's in-page download manager to appear and complete
    try {
      await page.waitForSelector('#loom-download-manager', { timeout: 120_000, state: 'visible' });
      await ui.screenshot({ path: `download-manager-appeared.png`, fullPage: true });
      await page.waitForFunction(() => {
        const percent = document.querySelector('#loom-download-manager [data-role="percent"]')?.textContent ?? '';
        const m = percent.match(/(\d{1,3})\s*%/);
        if (m && Number(m[1]) >= 99) return true;
        const fill = (document.querySelector('#loom-download-manager [data-role="progress-fill"]') as HTMLElement | null)?.style?.width ?? '';
        if (fill.includes('100')) return true;
        const manager = document.querySelector('#loom-download-manager');
        if (!manager) return true;
        return false;
      }, { timeout: 120_000 });
    } catch {
      
    }

    // poll Downloads folder for the expected file name and stable size
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    const deadline = Date.now() + 120_000;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    let foundPath: string | null = null;

    while (Date.now() < deadline) {
      if (fs.existsSync(downloadsDir)) {
        for (const name of fs.readdirSync(downloadsDir)) {
          if (!name.toLowerCase().includes(downloadsKeyword.toLowerCase())) continue;
          const full = path.join(downloadsDir, name);
          try {
            const s1 = fs.statSync(full);
            if (!s1.isFile() || s1.size === 0) continue;
            await sleep(500);
            const s2 = fs.statSync(full);
            if (s2.size === s1.size) { foundPath = full; break; }
          } catch {}
        }
      }
      if (foundPath) break;
      await sleep(1000);
    }

    if (!foundPath) throw new Error(`No downloaded file containing "${downloadsKeyword}" found in Downloads.`);

    const tmpDir = path.resolve(__dirname, '..', '..', '..', 'tmp-downloads');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const dest = path.join(tmpDir, path.basename(foundPath));
    fs.copyFileSync(foundPath, dest);

    try { await page.screenshot({ path: `after-download.png`, fullPage: true }); } catch {}

    const stats = fs.statSync(dest);
    expect(stats.size).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});