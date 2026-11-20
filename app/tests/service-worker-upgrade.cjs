'use strict';

// Actual browser worker lifecycle on one loopback origin. The served source
// switches from the original candidate to this candidate; neither is modified.
// No real login, deployment, Firebase operation, or operating-system PWA install.
const http = require('node:http');
const { createHash } = require('node:crypto');
const { APP, SITE, assert, fs, path, makeReport, check, saveReport } = require('./offline-harness.cjs');
const OLD_SITE = require('./previous-worker-fixture.cjs')(SITE);
const report = makeReport('actual-local-service-worker-upgrade');
report.limitations.push('Loopback registration is explicit because shipped auto-registration requires HTTPS.',
  'No OS-level PWA installation or physical iPhone test; Firebase SDK/auth is an in-memory test fixture.');
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const workerVersion = root => /const CACHE_VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'))[1];
const OLD_CACHE = workerVersion(OLD_SITE), NEW_CACHE = workerVersion(SITE);
let browser, context, page, server, proxy, phase = 'original', offline = false, origin;
const requests = [], blockedExternal = [];
function playwright() {
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  try { return require('playwright'); } catch {}
  return require(path.join(process.env.USERPROFILE || process.env.HOME,
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function durableState() {
  return page.evaluate(async () => ({ operations: await HathirOfflineStore.operations('qa_worker_upgrade'),
    snapshots: await HathirOfflineStore.subjects('qa_worker_upgrade'), other: await HathirOfflineStore.operations('qa_worker_other'),
    marker: localStorage.getItem('qa-worker-preserve'), databases: await indexedDB.databases() }));
}
async function cacheHashes(urls) {
  return page.evaluate(async urls => {
    const output = {};
    for (const url of urls) {
      const response = await fetch(url), bytes = await response.arrayBuffer();
      output[url] = { status: response.status, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('') };
    }
    return output;
  }, urls);
}
async function required(label, task) {
  if (!await check(report, label, task)) throw Error('Cannot continue worker lifecycle after: ' + label);
}

(async () => {
  assert.notEqual(OLD_CACHE, NEW_CACHE, 'Upgrade must change the installed cache version');
  server = http.createServer((req, res) => {
    if (offline) { req.socket.destroy(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ phase, path: url.pathname, query: url.search });
    if (url.pathname === '/upgrade-probe.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      res.end('/* SYNTHETIC ' + phase.toUpperCase() + ' PROBE */'); return;
    }
    const root = phase === 'original' ? OLD_SITE : SITE;
    if(url.pathname.startsWith('/vendor/firebase-10.12.5/')){
      res.writeHead(200,{'content-type':'text/javascript'});res.end('/* Firebase supplied by synthetic upgrade fixture */');return;
    }
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json',
      '.png': 'image/png', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream';
    fs.readFile(file, (error, body) => {
      res.writeHead(error ? 404 : 200, { 'content-type': type, 'cache-control': 'no-store', 'service-worker-allowed': '/' });
      res.end(error ? 'missing' : body);
    });
  });
  await listen(server); origin = 'http://127.0.0.1:' + server.address().port;
  // Browser-owned service-worker fetches can bypass page routing. A local
  // rejecting proxy is the second fence: external HTTP and CONNECT never leave.
  proxy = http.createServer((req, res) => { blockedExternal.push(req.url.split('?')[0]); res.writeHead(403); res.end('External network disabled'); });
  proxy.on('connect', (req, socket) => { socket.on('error',error=>{if(error.code!=='ECONNRESET')throw error;});blockedExternal.push(req.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  await listen(proxy);
  const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await playwright().chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}),
    proxy: { server: 'http://127.0.0.1:' + proxy.address().port, bypass: '127.0.0.1,localhost' } });
  context = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: false });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    if (url.startsWith('https://www.gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '/* Local in-memory Firebase fixture; no real SDK network. */' });
    report.blockedRequests.push(url.replace(/[?].*$/, '')); return route.abort('blockedbyclient');
  });
  const harness = fs.readFileSync(path.join(__dirname, 'offline-harness.cjs'), 'utf8');
  const mock = harness.slice(harness.indexOf('function installFirebaseMock('), harness.indexOf('\nmodule.exports'));
  assert(mock.startsWith('function installFirebaseMock('));
  await context.addInitScript({ content: '(' + mock + ')({uid:"qa_worker_upgrade",email:"qa-worker@example.invalid",verified:false});' });
  context.on('page', item => item.on('pageerror', error => report.pageErrors.push({ error: error.message })));
  page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(origin); await page.waitForFunction(() => Boolean(window.HathirOfflineStore));

  await required('The original shipped worker installs and controls the original same-origin shell', async () => {
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
    await page.reload();
    const rows = await cacheHashes(['/index.html']);
    assert.equal(rows['/index.html'].hash, hash(fs.readFileSync(path.join(OLD_SITE, 'index.html'))));
    assert((await page.evaluate(() => caches.keys())).includes(OLD_CACHE));
  });

  let original;
  await required('Original storage API creates synthetic private snapshots and an outbox under the installed worker', async () => {
    await page.evaluate(async () => {
      const uid = 'qa_worker_upgrade', subjectId = 'qa_worker_subject';
      const snapshot = { key: HathirOfflineStore.key(uid, subjectId), uid, workspaceId: uid, savedAt: 1789900000000,
        session: { uid, workspaceId: uid, active: true, role: 'owner', local: false }, departments: [], stages: [],
        subject: { id: subjectId, students: [{ id: 'ORIGINAL-007', name: 'طالب اصطناعي قديم' }], attendance: {}, lectures: [], lectureMeta: {} } };
      const op = { id: 'qa-worker-original-operation', protocolVersion: 3, uid, workspaceId: uid, subjectId, studentId: 'ORIGINAL-007',
        kind: 'mark', date: '2026-09-19', createdAt: 1789900000000, preparedAt: 1789900000000, rosterResetId: '',
        record: { time: '08:10', method: 'scan', studentName: 'طالب اصطناعي قديم' }, meta: { startTime: '08:00', durationHours: 2, status: 'active' } };
      await HathirOfflineStore.enqueue(snapshot, op);
      const otherUid = 'qa_worker_other';
      await HathirOfflineStore.enqueue({ ...snapshot, key: HathirOfflineStore.key(otherUid, subjectId), uid: otherUid, workspaceId: otherUid,
        session: { ...snapshot.session, uid: otherUid, workspaceId: otherUid } }, { ...op, id: 'qa-worker-other-operation', uid: otherUid, workspaceId: otherUid });
      localStorage.setItem('qa-worker-preserve', 'Exact original local bytes');
    });
    original = await durableState();
    assert.equal(original.operations.length, 1); assert.equal(original.other.length, 1);
    assert.equal(original.operations[0].studentId, 'ORIGINAL-007');
  });

  await required('Old caches contain deliberately stale same-origin config/code and a prepared public-library sentinel', async () => {
    await page.evaluate(async oldCache => {
      const cache = await caches.open(oldCache.replace('-shell-', '-runtime-'));
      for (const url of ['/runtime-config.js', '/personal-ui.js', '/upgrade-probe.js', '/stale-only.js'])
        await cache.put(url, new Response('/* STALE_ORIGINAL_CACHE_SENTINEL */', { headers: { 'content-type': 'text/javascript' } }));
      await cache.put('https://www.gstatic.com/qa-prepared-library.js', new Response('/* SYNTHETIC_PREPARED_LIBRARY */', { headers: { 'content-type': 'text/javascript' } }));
    }, OLD_CACHE);
  });

  phase = 'candidate';
  await required('An actual worker update atomically activates the new candidate shell', async () => {
    await page.evaluate(async () => {
      window.originalWorkerController = navigator.serviceWorker.controller;
      const registration = await navigator.serviceWorker.getRegistration('/'); await registration.update();
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller !== originalWorkerController && navigator.serviceWorker.controller.state === 'activated');
    const keys = await page.evaluate(() => caches.keys()); assert(keys.includes(NEW_CACHE));
    await page.reload(); await page.waitForFunction(() => Boolean(window.HathirPersonal && window.HathirNameQR));
    const state = await page.evaluate(() => ({ configured: HATHIR_RUNTIME_CONFIG.configured, project: HATHIR_RUNTIME_CONFIG.firebaseConfig.projectId,
      compact: HathirNameQR.encode('طالب اصطناعي قديم'), authDisabled: document.getElementById('emailAuthBtn').disabled }));
    assert.equal(state.configured, true); assert.match(state.compact, /^H2:[0-9A-F]{32}$/); assert.equal(state.authDisabled, false);
    assert.equal(state.project, require('./offline-harness.cjs').EXPECTED_PROJECT);
  });

  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const codeUrls = ['/index.html', '/runtime-config.js', ...['personal-ui.js', 'name-qr.js', 'offline-store.js', 'offline-attendance.js'].map(file => {
    const match = html.match(new RegExp('(?:src|href)="(' + file.replace('.', '\\.') + '[^"]*)"')); assert(match, file); return '/' + match[1];
  })];
  const expected = Object.fromEntries(codeUrls.map(url => [url, hash(fs.readFileSync(path.join(SITE, new URL(url, origin).pathname.slice(1))))]));
  await required('Every active same-origin HTML/config/protocol/outbox script matches the candidate bytes, never stale old cache entries', async () => {
    const result = await cacheHashes(codeUrls);
    for (const url of codeUrls) { assert.equal(result[url].status, 200); assert.equal(result[url].hash, expected[url], url); }
    const probe = await page.evaluate(() => fetch('/upgrade-probe.js').then(response => response.text()));
    assert.equal(probe, '/* SYNTHETIC CANDIDATE PROBE */');
  });
  await required('Upgrade preserves private IDB/outbox data and removes obsolete application caches', async () => {
    assert.deepEqual(await durableState(), original);
    const keys = await page.evaluate(() => caches.keys()); assert(!keys.includes(OLD_CACHE)); assert(keys.includes(NEW_CACHE));
    const manifest = await page.evaluate(() => fetch('/manifest.webmanifest').then(response => response.json()));
    const oldManifest = JSON.parse(fs.readFileSync(path.join(OLD_SITE, 'manifest.webmanifest'), 'utf8'));
    for (const field of ['id', 'start_url', 'scope']) assert.equal(manifest[field], oldManifest[field], field);
  });

  await required('Browser preparation registers and claims an uncontrolled first page without requiring a reload', async () => {
    const fresh=await browser.newContext({serviceWorkers:'allow',acceptDownloads:false});
    try{
      const tab=await fresh.newPage();
      await tab.goto(origin);await tab.waitForFunction(()=>typeof ensureOfflineServiceWorker==='function');
      assert.equal(await tab.evaluate(()=>Boolean(navigator.serviceWorker.controller)),false);
      await tab.evaluate(()=>ensureOfflineServiceWorker());
      await tab.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated');
      const state=await tab.evaluate(async()=>({controlled:!!navigator.serviceWorker.controller,active:(await navigator.serviceWorker.ready).active?.state}));
      assert.deepEqual(state,{controlled:true,active:'activated'});
    }finally{await fresh.close();}
  });

  offline = true; await context.setOffline(true);
  await required('Offline new worker reuses an exact prepared public library but refuses stale-only same-origin code', async () => {
    const facts = await page.evaluate(async () => {
      const library = await fetch('https://www.gstatic.com/qa-prepared-library.js').then(response => response.text());
      let staleFailed = false; try { const response = await fetch('/stale-only.js'); staleFailed = !response.ok; } catch { staleFailed = true; }
      return { library, staleFailed };
    });
    assert.deepEqual(facts, { library: '/* SYNTHETIC_PREPARED_LIBRARY */', staleFailed: true });
  });
  await required('A new cold page opens the candidate shell and every required candidate script while the local server is disconnected', async () => {
    await page.close(); page = await context.newPage(); page.setDefaultTimeout(15000);
    const response = await page.goto(origin, { waitUntil: 'domcontentloaded' }); assert(response.ok());
    await page.waitForFunction(() => Boolean(window.HathirPersonal && window.HathirNameQR && window.HathirOfflineStore));
    const result = await cacheHashes(codeUrls);
    for (const url of codeUrls) assert.equal(result[url].hash, expected[url], url);
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    assert.equal(await page.locator('#loginPage').isVisible(), true); assert.equal(await page.locator('#emailAuthBtn').isEnabled(), true);
  });
  await required('Cold offline startup retains the exact original outbox, IDs, snapshots and account isolation', async () => assert.deepEqual(await durableState(), original));
  await check(report, 'No Firebase operations or uncaught page exceptions occur during the worker upgrade', async () => {
    assert.deepEqual(await page.evaluate(() => ({ calls: personalFixture.calls, writes: personalFixture.writes, authCalls: personalFixture.authCalls })), { calls: [], writes: [], authCalls: [] });
    assert.deepEqual(report.pageErrors, []);
  });
})().catch(error => { report.cases.push({ label: 'Actual worker lifecycle', passed: false, error: error.stack }); })
  .finally(async () => {
    if (context) await context.close(); if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    report.localRequests = requests; report.rejectedExternalHosts = [...new Set(blockedExternal)];
    saveReport(report, 'service-worker-upgrade');
  });
