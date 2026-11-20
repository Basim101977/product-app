'use strict';
const { chromium } = require(require('node:path').join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error).slice(0, 300)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
  try {
    await page.goto('https://hathir--beginner-ui-34-4dww7a27.web.app/?release=v2026.09.26-profile-sync-close-65', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const result = await page.evaluate(async () => {
      const current = document.querySelector('#beginnerMenuVersion')?.textContent || '';
      try {
        const registration = await navigator.serviceWorker.register('service-worker.js');
        await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(Error('ready timeout')), 25000))]);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { current, active: registration.active?.scriptURL || '', waiting: registration.waiting?.scriptURL || '', controller: navigator.serviceWorker.controller?.scriptURL || '', caches: await caches.keys() };
      } catch (error) {
        return { current, failure: String(error), caches: await caches.keys() };
      }
    });
    console.log(JSON.stringify({ ...result, errors }, null, 2));
    if (result.failure || errors.length) process.exitCode = 1;
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
