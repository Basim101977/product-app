'use strict';

// This harness serves only this candidate's public assets over loopback. It never
// loads credentials, makes cloud calls, deploys, or writes application data.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const APP = path.resolve(__dirname, '..');
const SITE = path.join(APP, 'netlify_site');
const REPORTS = path.join(APP, 'reports');
const EXPECTED_PROJECT = 'alqar-student-attendance-2026';
const EXPECTED_SITE = 'hathir';

function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  try { return require('playwright'); } catch {}
  return require(path.join(process.env.USERPROFILE || process.env.HOME,
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}

function makeReport(suite) {
  return { suite, checkedAt: new Date().toISOString(), mode: 'synthetic-local-only',
    externalNetwork: 'blocked', cloudWrites: 0, credentialsRead: false,
    limitations: ['No deployed-service, Firebase emulator, payment-provider, camera, or physical-device verification.'],
    cases: [], pageErrors: [], blockedRequests: [], screenshots: [] };
}

async function check(report, label, task) {
  try {
    const details = await task();
    report.cases.push({ label, passed: true, ...(details || {}) });
    console.log('PASS ' + label);
    return true;
  } catch (error) {
    report.cases.push({ label, passed: false, error: error.stack || error.message });
    console.error('FAIL ' + label + ': ' + error.message);
    return false;
  }
}

function saveReport(report, name) {
  report.passed = report.cases.length > 0 && report.cases.every(row => row.passed) && !report.pageErrors.length;
  fs.mkdirSync(REPORTS, { recursive: true });
  const file = path.join(REPORTS, name + '.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: file, passed: report.passed, total: report.cases.length,
    failed: report.cases.filter(row => !row.passed).map(row => row.label), pageErrors: report.pageErrors.length }));
  if (!report.passed) process.exitCode = 1;
  return file;
}

async function launch(report, { legacyCloud = false } = {}) {
  report.runtimeUnderTest = legacyCloud ? 'retained-legacy-cloud-path' : 'current-device-first';
  const server = http.createServer((req, res) => {
    // Exercise the candidate's shared Hosting security headers in every UI test.
    for (const rule of JSON.parse(fs.readFileSync(path.join(APP, 'firebase.json'), 'utf8')).hosting.headers || []) {
      if (rule.source === '**') for (const header of rule.headers) res.setHeader(header.key, header.value);
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
    catch { res.writeHead(400); res.end(); return; }
    const file = path.resolve(SITE, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(SITE + path.sep)) { res.writeHead(403); res.end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.readFile(file, (error, body) => { res.statusCode = error ? 404 : 200; res.end(error ? 'missing' : body); });
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const engine = process.env.HATHIR_TEST_BROWSER || 'chromium';
  const browser = await loadPlaywright()[engine].launch({ headless: true,
    ...(engine === 'chromium' && fs.existsSync(chrome) ? { executablePath: chrome } : engine === 'webkit' && process.env.WEBKIT_PATH ? { executablePath: process.env.WEBKIT_PATH } : {}) });
  return { browser, origin,
    async page({ width = 1440, fixture = {}, runtime = 'synthetic', touch = false } = {}) {
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 },
        serviceWorkers: 'block', acceptDownloads: false, hasTouch: touch });
      await context.route('**/*', route => {
        const url = route.request().url();
        if (runtime !== 'actual' && url.startsWith(origin + '/runtime-config.js')) return route.fulfill({ contentType: 'text/javascript',
          body: 'window.HATHIR_RUNTIME_CONFIG=' + JSON.stringify({
            firebaseConfig: runtime === 'unprovisioned' ? null : { projectId: EXPECTED_PROJECT, apiKey: 'synthetic-local-only', authDomain: EXPECTED_PROJECT + '.firebaseapp.com' },
            configured: runtime !== 'unprovisioned',
            ownerUid: 'HATHIR_OWNER_UID_REQUIRED', ownerEmail: 'redacted@example.invalid',
            environment: 'production', supportEmail: 'redacted@example.invalid', supportEnabled: true
          }) + ';' });
        if (runtime !== 'actual' && url.startsWith(origin + '/vendor/firebase-10.12.5/')) return route.fulfill({contentType:'text/javascript',body:'/* synthetic Firebase fixture */'});
        if (url.startsWith(origin + '/')) return route.continue();
        if (url.startsWith('https://www.gstatic.com/firebasejs/'))
          return route.fulfill({ contentType: 'text/javascript', body: '/* SDK replaced by local in-memory fixture. */' });
        report.blockedRequests.push(url.replace(/[?].*$/, ''));
        return route.abort('blockedbyclient');
      });
      await context.addInitScript(installFirebaseMock, {...fixture, legacyCloud});
      // Non-tour suites deliberately dismiss the new entry welcome, just as a user would.
      // Tour suites exercise it without this fixture convenience.
      if (report.suite !== 'guided-audio-onboarding') await context.addInitScript(() => {
        new MutationObserver(() => {
          const panel=document.getElementById('tourPanel');
          if(panel&&!panel.hidden&&panel.dataset.step==='welcome')document.getElementById('tourClose')?.click();
        }).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-step']});
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.pageErrors.push({ width, error: error.message }));
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.fixtureAuth === 'object' && document.readyState === 'complete');
      // Manual-workspace tests must not race the initial signed-out callback.
      if (!fixture.rememberedUser && !fixture.authDelay && runtime !== 'unprovisioned')
        await page.waitForFunction(() => window.personalFixture.initialAuthDelivered === true);
      if (legacyCloud) await page.evaluate(() => { window.HathirDeviceWorkspace = null; });
      return { page, context };
    },
    async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  };
}

function installFirebaseMock(initial) {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const fixture = window.personalFixture = { calls: [], reads: [], writes: [], authCalls: [], persistenceCalls: [],
    records: initial.records || {}, uid: initial.uid || 'qa_personal_a',
    email: initial.email || 'qa-personal-a@example.test', verified: initial.verified === true,
    accountStatus: initial.accountStatus || 'pending', failNext: '', ...initial };
  const authCallbacks = new Set();
  const user = () => ({ uid: fixture.uid, email: fixture.email, emailVerified: fixture.verified,
    displayName: fixture.fullName || 'طالب اختبار محلي',
    async updateProfile(data) { fixture.authCalls.push({ name: 'updateProfile', data: clone(data) }); Object.assign(this, data); },
    async sendEmailVerification() { fixture.authCalls.push({ name: 'sendEmailVerification' }); },
    async reload() { this.emailVerified = fixture.verified; },
    async getIdToken() { return 'synthetic-token-never-transmitted'; },
    async getIdTokenResult() { return { token: 'synthetic-token-never-transmitted', claims: { email_verified: fixture.verified } }; }
  });
  const emit = async () => { for (const callback of authCallbacks) await callback(window.fixtureAuth.currentUser); };
  window.fixtureAuth = {
    currentUser: initial.rememberedUser ? user() : null,
    async setPersistence(mode) { fixture.persistenceCalls.push(mode); if(initial.persistenceFails) throw Object.assign(Error('Storage unavailable'), { code:'auth/web-storage-unsupported' }); },
    onAuthStateChanged(callback) { authCallbacks.add(callback); const initialUser=this.currentUser; setTimeout(async () => { try {
      // Select the retained pre-device migration path only after normal boot.
      // Current device startup, storage and live sync use separate mandatory suites.
      if (initial.legacyCloud) window.HathirDeviceWorkspace = null;
      await callback(initialUser);
    } finally { fixture.initialAuthDelivered = true; } }, initial.authDelay || 0); return () => authCallbacks.delete(callback); },
    async signOut() { fixture.authCalls.push({ name: 'signOut' }); this.currentUser = null; },
    async createUserWithEmailAndPassword(email) { fixture.authCalls.push({ name: 'createUserWithEmailAndPassword', email }); fixture.email = email; this.currentUser = user(); return { user: this.currentUser }; },
    async signInWithEmailAndPassword(email) { fixture.authCalls.push({ name: 'signInWithEmailAndPassword', email }); fixture.email = email; this.currentUser = user(); setTimeout(() => emit(), 0); return { user: this.currentUser }; },
    async sendPasswordResetEmail(email) { fixture.authCalls.push({ name: 'sendPasswordResetEmail', email }); }
  };
  window.fixtureUser = user;
  window.fixtureEmitAuth = emit;
  const docSnapshot = name => ({ id: name.split('/').pop(), exists: Object.hasOwn(fixture.records, name),
    data: () => clone(fixture.records[name]), ref: ref(name) });
  const ref = (name, filters = []) => ({ path: name, id: name.split('/').pop(),
    collection: child => ref(name + '/' + child), doc: child => ref(name + '/' + (child || 'qa_generated')),
    where: (field, op, value) => ref(name, [...filters, { field, op, value }]),
    orderBy: () => ref(name, filters), limit: () => ref(name, filters),
    async get() {
      fixture.reads.push(name);
      if (name.split('/').length % 2 === 0) return docSnapshot(name);
      const docs = Object.keys(fixture.records).filter(key => key.startsWith(name + '/') && key.split('/').length === name.split('/').length + 1)
        .filter(key => filters.every(({ field, op, value }) => op === '==' ? fixture.records[key][field] === value : op === 'in' ? value.includes(fixture.records[key][field]) : true)).map(docSnapshot);
      return { docs, empty: !docs.length, size: docs.length, forEach: fn => docs.forEach(fn) };
    },
    async set(value, options) { fixture.writes.push({ path: name, value: clone(value) }); fixture.records[name] = options?.merge ? { ...fixture.records[name], ...clone(value) } : clone(value); },
    async update(value) { return this.set(value, { merge: true }); },
    async delete() { fixture.writes.push({ path: name, deleted: true }); delete fixture.records[name]; },
    onSnapshot(callback) { this.get().then(callback); return () => {}; }
  });
  const firestore = () => ({ collection: name => ref(name), doc: name => ref(name),
    async runTransaction(work) {const jobs=[];const result=await work({get:r=>r.get(),set:(r,v,o)=>jobs.push(()=>r.set(v,o)),update:(r,v)=>jobs.push(()=>r.update(v)),delete:r=>jobs.push(()=>r.delete())});await Promise.all(jobs.map(job=>job()));return result;},
    batch: () => { const jobs = []; return { set: (r, v, o) => jobs.push(() => r.set(v, o)), update: (r, v) => jobs.push(() => r.update(v)), delete: r => jobs.push(() => r.delete()), commit: () => Promise.all(jobs.map(fn => fn())) }; } });
  firestore.FieldValue = { serverTimestamp: () => 123456, delete: () => null, arrayUnion: (...items) => items };
  window.fixtureInvoke = async (name, data) => {
    fixture.calls.push({ name, data: clone(data) });
    if (fixture.failNext === name) { fixture.failNext = ''; throw Object.assign(new Error('Synthetic unavailable'), { code: 'unavailable' }); }
    if (fixture.responses && Object.hasOwn(fixture.responses, name)) return clone(fixture.responses[name]);
    throw new Error('Unconfigured synthetic callable: ' + name);
  };
  const functions = () => ({ httpsCallable: name => async data => {
    if (initial.legacyCloud && name==='supportChat' && data?.action==='announcements') {
      // A passive new-feature read must not be mistaken for a legacy attendance
      // write/receipt. Keep it observable independently; never exempt mutations.
      (fixture.backgroundCalls ||= []).push({name,data:clone(data)});
      return {data:{announcements:[],announcementsUnread:0,supportUnread:0,before:null}};
    }
    return { data: await window.fixtureInvoke(name, data) };
  } });
  window.firebase = { apps: [{}], auth: () => window.fixtureAuth, firestore, functions,
    app: () => ({ functions }), initializeApp: () => ({ functions }) };
}

module.exports = { APP, SITE, REPORTS, EXPECTED_PROJECT, EXPECTED_SITE, assert, fs, path, makeReport, check, saveReport, launch };

