'use strict';

// Evaluate registration metadata only. Firebase Admin is stubbed before module
// evaluation, so no ADC discovery, credentials, user data or cloud client exists.
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { APP, EXPECTED_PROJECT, assert, fs, path, makeReport, check, saveReport } = require('./offline-harness.cjs');
const entry = path.join(APP, 'functions/index.js');
const realRequire = createRequire(entry);
const expectedAccount = '687554777181-compute@developer.gserviceaccount.com';
const report = makeReport('personal-function-metadata-static');
const adminCalls = [];
function fakeAdmin(name) {
  adminCalls.push(name);
  const ref = p => ({path:p,collection:n=>ref(p+'/'+n),doc:n=>ref(p+'/'+n)});
  return name==='getFirestore' ? {collection:n=>ref(n),doc:n=>ref(n)} : {};
}
const sandbox = {
  module: { exports: {} }, exports: {}, __dirname: path.dirname(entry), __filename: entry,
  console, Buffer, setTimeout, clearTimeout,
  process: { env: { GCLOUD_PROJECT: EXPECTED_PROJECT } },
  require(name) {
    if (name === 'firebase-admin/app') return { getApps: () => [{}], initializeApp() { throw Error('Admin initialization must not run in metadata QA'); } };
    if (name === 'firebase-admin/auth') return { getAuth: () => fakeAdmin('getAuth') };
    if (name === 'firebase-admin/firestore') return { getFirestore: () => fakeAdmin('getFirestore'),
      FieldValue: { serverTimestamp: () => null, delete: () => null }, Timestamp: { now: () => null, fromDate: () => null, fromMillis: () => null } };
    if (name.startsWith('firebase-admin/')) throw Error('Unexpected Firebase Admin import during metadata QA: ' + name);
    return realRequire(name);
  }
};
sandbox.exports = sandbox.module.exports;
(async () => {
  await check(report, 'All exported functions carry the dedicated project runtime identity and bounded scaling', () => {
    new vm.Script(fs.readFileSync(entry, 'utf8'), { filename: entry }).runInNewContext(sandbox);
    const endpoints = Object.entries(sandbox.module.exports).filter(([, value]) => value?.__endpoint);
    assert.equal(endpoints.length, 54, 'Unexpected deployed function count; review every new export');
    report.endpoints = endpoints.map(([name, value]) => {
      const endpoint = value.__endpoint;
      assert.equal(endpoint.serviceAccountEmail, expectedAccount, name + ' runtime service account');
      assert.equal(endpoint.maxInstances, 2, name + ' max instances');
      assert.equal(endpoint.minInstances, 0, name + ' min instances');
      assert.equal(endpoint.platform, 'gcfv2', name + ' platform');
      assert.equal(JSON.stringify(endpoint.region), ['syncOfflineAttendanceBatch','syncOfflineAttendancePreview'].includes(name) ? '["asia-south1"]' : '["us-central1"]', name + ' deployment region');
      return { name, serviceAccountEmail: endpoint.serviceAccountEmail, maxInstances: endpoint.maxInstances,
        minInstances: endpoint.minInstances, platform: endpoint.platform, region: endpoint.region };
    });
    assert.deepEqual(adminCalls.sort(), ['getAuth', 'getFirestore']);
    return { endpointCount: endpoints.length, runtimeServiceAccount: expectedAccount };
  });
  saveReport(report, 'function-metadata-static');
})().catch(error => { report.cases.push({ label: 'Metadata inspection', passed: false, error: error.stack }); saveReport(report, 'function-metadata-static'); });
