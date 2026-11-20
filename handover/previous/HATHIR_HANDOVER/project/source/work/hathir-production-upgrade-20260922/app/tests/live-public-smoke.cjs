'use strict';

// READ-ONLY: GETs on the personal Hosting origin plus the sync CORS preflight. No Auth
// calls, user creation, Firestore reads, callables, or writes of any kind.
const vm = require('node:vm');
const crypto = require('node:crypto');
const { SITE, EXPECTED_PROJECT, EXPECTED_SITE, fs, path, assert, makeReport, check, saveReport } = require('./offline-harness.cjs');
const ORIGIN = 'https://' + EXPECTED_SITE + '.web.app';
const report = makeReport('personal-live-public-assets-readonly');
report.externalNetwork = 'GET personal Hosting assets; OPTIONS personal sync endpoint only';
report.mode = 'live-public-assets-readonly';
report.origin = ORIGIN;
report.limitations = ['Public static assets only; no live authentication, email delivery, Firestore user data, callable execution, camera, or physical-device verification.'];
const bodies = new Map();
const bytes = new Map();
async function get(name) {
  const url = new URL(name, ORIGIN); assert.equal(url.origin, ORIGIN);
  const response = await fetch(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, name + ' status');
  const binary = Buffer.from(await response.arrayBuffer()); bytes.set(name, binary);
  const body = binary.toString('utf8'); bodies.set(name, body); return body;
}
(async () => {
  await check(report, 'Personal login shell and required personal integration assets are published', async () => {
    const html = await get('/');
    assert(/personal-ui\.js/.test(html)); assert(/runtime-config\.js/.test(html)); assert(/authFirstName/.test(html));
    assert(!/organization-client\.js/.test(html));
    for (const asset of ['/personal-ui.js', '/personal-ui.css', '/name-qr.js', '/offline-attendance.js', '/runtime-config.js', '/guide.html', '/manifest.webmanifest', '/service-worker.js']) await get(asset);
  });
  await check(report, 'Live config points only to the authorized personal Firebase project', () => {
    const context = { window: {} }; vm.runInNewContext(bodies.get('/runtime-config.js'), context);
    const config = context.window.HATHIR_RUNTIME_CONFIG;
    assert.equal(config.configured, true); assert.equal(config.firebaseConfig.projectId, EXPECTED_PROJECT);
    assert.equal(config.ownerUid, 'HATHIR_OWNER_UID_REQUIRED');
    assert.equal(config.environment, 'production');
    assert.equal(config.supportEnabled, true);
    return { projectId: config.firebaseConfig.projectId, configured: true, supportEnabled: true };
  });
  await check(report, 'Live manifest and guide identify the personal app', () => {
    const manifest = JSON.parse(bodies.get('/manifest.webmanifest'));
    assert.equal(manifest.name, 'Hathir');
    assert.equal(manifest.id, '/'); assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/');
    assert(/التحقق|تحقق/.test(bodies.get('/guide.html')));
    assert(/موافقة/.test(bodies.get('/guide.html')));
  });
  await check(report, 'Published browser outbox targets the existing callable with working CORS', async () => {
    const source=bodies.get('/offline-attendance.js');
    const match=source.match(/\.functions\(['"]([^'"]+)['"]\)\.httpsCallable\(window\.HathirLiveSync \? ['"]syncOfflineAttendancePreview['"] : ['"]syncOfflineAttendanceBatch['"]/);
    assert(match,'Shipped outbox must name both Firebase callable paths');
    assert.equal(match[1],'asia-south1');
    for (const name of ['syncOfflineAttendanceBatch','syncOfflineAttendancePreview']) {
      const endpoint=`https://${match[1]}-${EXPECTED_PROJECT}.cloudfunctions.net/${name}`;
      const response=await fetch(endpoint,{method:'OPTIONS',redirect:'error',headers:{Origin:ORIGIN,
        'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,authorization'},signal:AbortSignal.timeout(20000)});
      assert.equal(response.status,204,`${name} must exist and accept a preflight`);
      assert.equal(response.headers.get('access-control-allow-origin'),ORIGIN);
    }
    return {region:match[1],preflightStatus:204};
  });
  await check(report, 'Published name QR emits compact tokens and still matches legacy name cards', () => {
    const context = {}; vm.runInNewContext(bodies.get('/name-qr.js'), context);
    const qr = context.HathirNameQR, name = 'أحمد محمد عبد الله حسن';
    const token = qr.encode(name);
    assert.match(token, /^H2:[0-9A-F]{32}$/);
    assert.equal(qr.encode('احمد محمد عبدالله حسن'), token);
    const pairs = [{ subject: { id: 'synthetic-public-check' }, student: { id: 'PRIVATE-SYNTHETIC', name } }];
    const legacy = 'HATHIR-NAME:1:' + encodeURIComponent(qr.normalizeName(name));
    assert.equal(qr.match(token, pairs).student.id, 'PRIVATE-SYNTHETIC');
    assert.equal(qr.match(legacy, pairs).student.id, 'PRIVATE-SYNTHETIC');
    assert.equal(qr.match(token, [pairs[0], pairs[0]]).status, 'ambiguous');
    return { compactCharacters: token.length, legacyNameCardsAccepted: true, syntheticOnly: true };
  });
  await check(report, 'Published HTML, runtime config, guide and integration assets match local release byte-for-byte', () => {
    const sha = value => crypto.createHash('sha256').update(value).digest('hex');
    const assets = [];
    for (const [name, binary] of bytes) {
      const relative = name === '/' ? 'index.html' : name.slice(1);
      const localHash = sha(fs.readFileSync(path.join(SITE, relative)));
      const publishedHash = sha(binary);
      assert.equal(publishedHash, localHash, 'Published asset differs from local release: ' + relative);
      assets.push({ path: name, localFile: relative, sha256: publishedHash, matchesLocal: true });
    }
    assert.equal(assets.length, 9, 'All expected public assets must be included');
    return { assets };
  });
})().catch(error => { report.cases.push({ label: 'Live read-only asset smoke', passed: false, error: error.stack }); })
  .finally(() => saveReport(report, 'live-public-smoke'));
