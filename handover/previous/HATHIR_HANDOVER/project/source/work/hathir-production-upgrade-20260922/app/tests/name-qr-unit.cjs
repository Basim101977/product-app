'use strict';

// Pure synthetic tests. This suite neither loads the app/Firebase nor uses the
// network, credentials, browser storage, or real students. Only its QA report is
// written, outside the hosted site.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const qr = require('../netlify_site/name-qr.js');
const PREFIX = 'HATHIR-NAME:1:';
const report = { suite: 'name-qr-pure-unit', mode: 'synthetic-local-only', checkedAt: new Date().toISOString(),
  externalNetwork: 'unused', cloudWrites: 0, credentialsRead: false, cases: [] };

function check(label, task) {
  try { task(); report.cases.push({ label, passed: true }); console.log('PASS ' + label); }
  catch (error) { report.cases.push({ label, passed: false, error: error.stack || String(error) }); console.error('FAIL ' + label + ': ' + error.message); }
}
function pair(id, name, subject = { id: 'synthetic-subject' }) { return { subject, student: { id, name } }; }
function legacyEncode(name) { return PREFIX + encodeURIComponent(qr.normalizeName(name)); }
function referenceFingerprint(name) {
  return createHash('sha256').update('HATHIR-NAME:2:' + qr.normalizeName(name), 'utf8')
    .digest('hex').slice(0, 32).toUpperCase();
}

check('NFKC, Arabic Alef variants, marks, tatweel and whitespace normalize deterministically', () => {
  const expected = 'احمدعبداللهفاطمه';
  for (const name of ['أَحْمَد عَبْدُ اللَّه فَاطِمَة', 'إحمد عبدالله فاطمه', 'آحمد عبد الله فاطمة',
    'ٱحمد  عبد الله  فاطمة', '  احمد\u00a0عبد\u2003الله فاطمه  ', 'أحــمد عبد الـله فاطـمة']) {
    assert.equal(qr.normalizeName(name), expected, name);
  }
});
check('Arabic presentation forms use NFKC', () => {
  assert.equal(qr.normalizeName('ﻓﺎﻃﻤﺔ ﻋﺒﺪ ﷲ'), qr.normalizeName('فاطمة عبد الله'));
});
check('Canonicalization is idempotent', () => {
  for (const name of ['فَاطِمَة عبد الله', 'ÉLODIE SMITH', 'İbrahim Ali', 'عبد الرحمن أحمد', 'A\u0301 B']) {
    const key = qr.normalizeName(name); assert(key); assert.equal(qr.normalizeName(key), key);
  }
});
check('Latin comparison is locale-independent and preserves non-Arabic accents', () => {
  assert.equal(qr.normalizeName('ALICE SMITH'), 'alicesmith');
  assert.equal(qr.normalizeName('ÉLODIE SMITH'), 'élodiesmith');
  assert.notEqual(qr.normalizeName('Elodie Smith'), qr.normalizeName('Élodie Smith'));
});
check('Arabic combining annotations are removed without removing distinct Arabic letters', () => {
  assert.equal(qr.normalizeName('احمد\u06D6 علي'), 'احمدعلي');
  assert.notEqual(qr.normalizeName('يحيى علي'), qr.normalizeName('يحيي علي'));
  assert.notEqual(qr.normalizeName('مؤمن علي'), qr.normalizeName('مومن علي'));
  assert.notEqual(qr.normalizeName('رائد علي'), qr.normalizeName('رايد علي'));
});
check('Existing one-word and two-word names do not require three tokens', () => {
  assert.equal(qr.normalizeName('علي'), 'علي');
  assert.equal(qr.decode(qr.encode('علي أحمد')).key, qr.fingerprint('علياحمد'));
  assert.deepEqual(qr.decode(legacyEncode('علي أحمد')), { ok: true, key: 'علياحمد' });
});
check('Empty, non-string, numbers and punctuation are invalid names', () => {
  for (const value of ['', '   ', null, undefined, 123, {}, ['Ali'], '123', 'Ali2', 'Ali-Smith',
    'Ali.Smith', 'أحمد/علي', 'أحمد،علي', '<script>', 'https://example.test', 'َََ']) {
    assert.equal(qr.normalizeName(value), '', String(value));
    assert.throws(() => qr.encode(value), TypeError);
    assert.throws(() => qr.fingerprint(value), TypeError);
  }
});
check('Control characters, invisible formatting and line separators are rejected', () => {
  for (const control of ['\n', '\r', '\t', '\u0000', '\u001b', '\u200b', '\u200c', '\u200d', '\u202e', '\ufeff', '\u2028', '\u2029']) {
    const name = 'علي' + control + 'احمد';
    assert.equal(qr.normalizeName(name), '', JSON.stringify(control));
    assert.equal(qr.decode(PREFIX + encodeURIComponent(name)).ok, false);
  }
});
check('Name length is bounded and excessive input is rejected', () => {
  assert.equal(qr.normalizeName('ا'.repeat(150)).length, 150);
  assert.equal(qr.normalizeName('ا'.repeat(151)), '');
  assert.equal(qr.normalizeName('ا'.repeat(100000)), '');
  assert.equal(qr.encode('ا'.repeat(150)).length, 35);
  assert.throws(() => qr.fingerprint('ا'.repeat(151)), TypeError);
  assert.throws(() => qr.fingerprint('ا'.repeat(100000)), TypeError);
  assert.equal(qr.decode(PREFIX + encodeURIComponent('ا'.repeat(151))).reason, 'too-long');
  assert.equal(qr.decode(PREFIX + 'A'.repeat(2000)).reason, 'too-long');
});
check('Compact ASCII envelope synchronously round-trips the normalized name fingerprint', () => {
  const name = 'فاطِمة عبد الله أحمد';
  const payload = qr.encode(name);
  assert.equal(typeof payload, 'string');
  assert.equal(payload.length, 35);
  assert.match(payload, /^H2:[0-9A-F]{32}$/);
  assert.deepEqual(qr.decode(payload), { ok: true, key: referenceFingerprint(name), version: 2 });
  assert.equal(payload, qr.encode('فاطمه عبدالله احمد'));
});
check('Fixed protocol vectors agree with independent Node SHA-256, including maximum Unicode length', () => {
  const vectors = [
    ['a', '273C95DFA9B86C0CD50FF4AF573D5415'],
    ['abc', '7C047F09E2527B833873861315095DFC'],
    ['أحمد محمد عبد الله حسن', '0CD04A1E30C2F4CC41A8D32F49C4B202'],
    ['عبدالرحمن محمد إبراهيم محمود', '67AC6B1112FC7A2D1DC12170F924A051'],
    ['ÉLODIE SMITH', '5DEEAEA9A0B40A965D38638711F5388E'],
    ['ا'.repeat(150), 'F07365EA5B19553608EC8B0392B98233'],
    ['𐐀'.repeat(150), 'D855C90C233DDDE41AC1706119130281']
  ];
  for (const [name, expected] of vectors) {
    assert.equal(referenceFingerprint(name), expected);
    assert.equal(qr.fingerprint(name), expected);
    assert.equal(qr.encode(name), 'H2:' + expected);
  }
});
check('SHA-256 padding and UTF-8 widths agree with Node for 750 bounded vectors', () => {
  // All lengths exercise the 55/56, 63/64 and later block boundaries, with
  // one-, two-, three-, and four-byte UTF-8 characters after normalization.
  for (const letter of ['a', 'ا', 'é', '漢', '𐐀']) {
    for (let length = 1; length <= 150; length++) {
      const name = letter.repeat(length);
      assert.equal(qr.fingerprint(name), referenceFingerprint(name), letter + ':' + length);
    }
  }
  for (const name of ['A\u0301 B', 'İbrahim Ali', 'فَاطِمَة عبد الله', 'ﻓﺎﻃﻤﺔ ﻋﺒﺪ ﷲ', 'ALICE 漢 𐐀 علي']) {
    assert.equal(qr.fingerprint(name), referenceFingerprint(name), name);
  }
});
check('Fingerprint uses the versioned namespace and never internal IDs or roster metadata', () => {
  const name = 'أحمد محمد عبد الله حسن';
  const canonical = qr.normalizeName(name);
  const rawHash = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32).toUpperCase();
  assert.notEqual(qr.fingerprint(name), rawHash);
  assert.equal(qr.fingerprint(name), qr.fingerprint(canonical));
  const first = pair('PRIVATE-ID-A', name, { id: 'SUBJECT-A', department: 'A' });
  const second = pair('PRIVATE-ID-B', 'احمد محمد عبدالله حسن', { id: 'SUBJECT-B', department: 'B' });
  assert.equal(qr.encode(first.student.name), qr.encode(second.student.name));
  assert(!qr.encode(name).includes('PRIVATE-ID'));
  assert.notEqual(qr.fingerprint(name), qr.fingerprint('أحمد محمد عبد الله حسين'));
});
check('Compact payloads require exactly 32 uppercase hexadecimal characters', () => {
  const valid = qr.encode('أحمد محمد');
  for (const payload of ['H2:', 'H2:' + 'A'.repeat(31), 'H2:' + 'A'.repeat(33),
    'H2:' + 'g'.repeat(32), 'H2:' + 'a'.repeat(32), 'H2:' + 'A'.repeat(31) + 'a',
    valid + ' ', valid + '\n', valid + '\u0000', 'H2:' + 'ا'.repeat(32),
    'H2:%41' + 'A'.repeat(29), 'H2:' + 'A'.repeat(100000)]) {
    assert.equal(qr.decode(payload).ok, false, payload.slice(0, 80));
  }
  assert.equal(qr.decode('H2:' + 'A'.repeat(33)).reason, 'too-long');
  assert.equal(qr.decode('H2:' + 'A'.repeat(31)).reason, 'invalid-encoding');
  assert.deepEqual(qr.decode('H2:' + '0'.repeat(32)), { ok: true, key: '0'.repeat(32), version: 2 });
});
check('Percent-decoded names are normalized and canonical output is stable', () => {
  assert.deepEqual(qr.decode(PREFIX + encodeURIComponent('أحمد محمد')), { ok: true, key: 'احمدمحمد' });
  assert.deepEqual(qr.decode(PREFIX + 'ALICE'), { ok: true, key: 'alice' });
});
check('Unsupported versions, raw names, legacy IDs and external URLs are rejected', () => {
  for (const value of ['MI20250001', 'علي احمد', 'https://example.test/a', 'HATHIR-NAME:2:ali',
    'HATHIR-NAME:01:ali', 'hathir-name:1:ali', '{"name":"علي احمد"}', '\n' + qr.encode('Ali'),
    'H3:' + 'A'.repeat(32), 'h2:' + 'A'.repeat(32), 'H02:' + 'A'.repeat(32), qr.fingerprint('Ali')]) {
    assert.deepEqual(qr.decode(value), { ok: false, key: '', reason: 'unsupported-format' });
  }
});
check('Previously printed literal version 1 cards retain their exact decoder and matching contract', () => {
  const fixtures = [
    ['HATHIR-NAME:1:%D8%B9%D9%84%D9%8A%D8%A7%D8%AD%D9%85%D8%AF', 'علي أحمد', 'علياحمد'],
    ['HATHIR-NAME:1:%D9%81%D8%A7%D8%B7%D9%85%D9%87%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D9%84%D9%87', 'فاطمة عبد الله', 'فاطمهعبدالله'],
    ['HATHIR-NAME:1:alicesmith', 'ALICE SMITH', 'alicesmith']
  ];
  for (const [payload, name, key] of fixtures) {
    assert.deepEqual(qr.decode(payload), { ok: true, key });
    const entry = pair('UNCHANGED-PRIVATE-ID', name);
    assert.deepEqual(qr.match(payload, [entry]), { status: 'match', key, ...entry });
    assert.equal(qr.match(payload, [entry, entry]).status, 'ambiguous');
    assert.equal(qr.match(qr.encode(name), [entry]).student, entry.student);
  }
});
check('Malformed UTF-8, malformed escapes, raw Unicode and empty envelopes are rejected', () => {
  for (const value of ['', '%', '%D8', '%ZZ', '%C0%AF', 'علي', 'Ali Smith', '%ED%A0%80']) {
    assert.equal(qr.decode(PREFIX + value).ok, false, value);
  }
  assert.equal(qr.decode(null).reason, 'invalid-type');
});
check('Encoded punctuation, controls, digits and double-encoded names never match', () => {
  for (const value of ['%3Cscript%3E', '%00Ali', '123', encodeURIComponent(encodeURIComponent('علي احمد'))]) {
    assert.equal(qr.decode(PREFIX + value).ok, false, value);
  }
});
check('A unique complete name returns the original subject and immutable student record', () => {
  const entry = pair('PRIVATE-ID-7', 'فاطمه عبدالله أحمد');
  const before = JSON.stringify(entry);
  const result = qr.match(qr.encode('فاطمة عبد الله احمد'), [pair('OTHER-ID', 'مريم عبد الله احمد'), entry]);
  assert.equal(result.status, 'match'); assert.equal(result.subject, entry.subject); assert.equal(result.student, entry.student);
  assert.equal(result.student.id, 'PRIVATE-ID-7'); assert.equal(JSON.stringify(entry), before);
});
check('The same name QR resolves to each supplied teacher roster without sharing IDs', () => {
  const payload = qr.encode('أحمد عبد الله محمد');
  const teacherA = pair('TEACHER-A-1', 'احمد عبدالله محمد', { id: 'A' });
  const teacherB = pair('TEACHER-B-99', 'أحمد عبد الله محمد', { id: 'B' });
  assert.equal(qr.match(payload, [teacherA]).student.id, 'TEACHER-A-1');
  assert.equal(qr.match(payload, [teacherB]).student.id, 'TEACHER-B-99');
});
check('Exact-name duplicates and normalization collisions are always ambiguous', () => {
  const payload = qr.encode('فاطمة عبد الله');
  for (const entries of [[pair('A', 'فاطمة عبد الله'), pair('B', 'فاطمة عبد الله')],
    [pair('A', 'فاطمة عبد الله'), pair('B', 'فاطمه عبدالله')]]) {
    assert.deepEqual(qr.match(payload, entries), { status: 'ambiguous', key: qr.fingerprint('فاطمة عبد الله'), count: 2 });
    assert.deepEqual(qr.match(legacyEncode('فاطمة عبد الله'), entries), { status: 'ambiguous', key: 'فاطمهعبدالله', count: 2 });
  }
});
check('Every pair is examined and roster ordering never changes uniqueness', () => {
  const entry = pair('MATCH', 'علي أحمد');
  const other = pair('OTHER', 'مريم أحمد');
  const invalid = [null, {}, { subject: {} }, pair('INVALID', ''), pair('INVALID', '123')];
  for (const payload of [qr.encode('علي أحمد'), legacyEncode('علي أحمد')]) {
    assert.equal(qr.match(payload, [entry, ...invalid, other]).student, entry.student);
    assert.equal(qr.match(payload, [other, ...invalid, entry]).student, entry.student);
    assert.equal(qr.match(payload, [entry, other, ...invalid, pair('LATE-COLLISION', 'علي احمد')]).status, 'ambiguous');
  }
});
check('A deliberately injected fingerprint collision remains ambiguous for distinct names', () => {
  // Instrument only this isolated in-memory copy to exercise the extremely
  // unlikely collision branch without changing the shipped hash or source file.
  const source = fs.readFileSync(path.join(__dirname, '../netlify_site/name-qr.js'), 'utf8');
  const original = "function fingerprintKey(key) { return sha256(HASH_DOMAIN + key).slice(0, 32).toUpperCase(); }";
  assert(source.includes(original));
  const context = vm.createContext({});
  vm.runInContext(source.replace(original, "function fingerprintKey(key) { return 'A'.repeat(32); }"), context);
  const result = context.HathirNameQR.match('H2:' + 'A'.repeat(32), [pair('A', 'علي أحمد'), pair('B', 'مريم أحمد')]);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.count, 2);
  assert.equal(result.key, 'A'.repeat(32));
  assert.equal(result.student, undefined);
});
check('Matching rows across subjects are not deduplicated by ID or object identity', () => {
  const first = pair('SAME-ID', 'علي أحمد', { id: 'A' });
  const second = pair('SAME-ID', 'علي أحمد', { id: 'B' });
  assert.equal(qr.match(qr.encode('علي أحمد'), [first, second]).status, 'ambiguous');
  assert.equal(qr.match(qr.encode('علي أحمد'), [first, first]).status, 'ambiguous');
});
check('No prefix, partial-name, reordered-token or edit-distance matches are accepted', () => {
  const entries = [pair('A', 'علي أحمد محمد')];
  for (const name of ['علي', 'علي أحمد', 'محمد علي أحمد', 'علي احمد محمود']) {
    assert.equal(qr.match(qr.encode(name), entries).status, 'missing', name);
  }
});
check('Missing and invalid inputs never return a student or fall back to its ID', () => {
  const entry = pair('MI20250001', 'علي أحمد');
  assert.equal(qr.match('MI20250001', [entry]).status, 'invalid');
  assert.deepEqual(qr.match(qr.encode('مريم أحمد'), [entry]), { status: 'missing', key: qr.fingerprint('مريم أحمد') });
  assert.deepEqual(qr.match(legacyEncode('مريم أحمد'), [entry]), { status: 'missing', key: 'مريماحمد' });
  assert.equal(qr.match(qr.encode('علي أحمد'), []).status, 'missing');
  assert.equal(qr.match(qr.encode('علي أحمد'), null).status, 'invalid');
});
check('Fresh roster renames and added collisions change matching without stale caches', () => {
  for (const payload of [qr.encode('علي أحمد'), legacyEncode('علي أحمد')]) {
    const entry = pair('A', 'علي أحمد'); const entries = [entry];
    assert.equal(qr.match(payload, entries).status, 'match');
    entry.student.name = 'مريم أحمد'; assert.equal(qr.match(payload, entries).status, 'missing');
    entry.student.name = 'علي أحمد'; entries.push(pair('B', 'علي احمد'));
    assert.equal(qr.match(payload, entries).status, 'ambiguous');
    entries[1].student.name = 'مريم أحمد'; assert.equal(qr.match(payload, entries).status, 'match');
    entries[0] = pair('REPLACED-ID', 'علي أحمد');
    assert.equal(qr.match(payload, entries).student.id, 'REPLACED-ID');
  }
});
check('Browser global is installed without CommonJS, DOM, storage or network dependencies', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../netlify_site/name-qr.js'), 'utf8'), context);
  assert.equal(typeof context.HathirNameQR.normalizeName, 'function');
  assert.equal(typeof context.HathirNameQR.fingerprint, 'function');
  assert.equal(context.HathirNameQR.fingerprint('علي أحمد'), referenceFingerprint('علي أحمد'));
  assert.equal(context.HathirNameQR.decode(context.HathirNameQR.encode('علي أحمد')).key, referenceFingerprint('علي أحمد'));
  assert.equal(typeof context.TextEncoder, 'undefined');
  assert.equal(typeof context.crypto, 'undefined');
  assert(Object.isFrozen(context.HathirNameQR));
});

report.passed = report.cases.every(test => test.passed);
const output = path.join(__dirname, '../reports/name-qr-unit.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: output, passed: report.passed, total: report.cases.length,
  failed: report.cases.filter(test => !test.passed).map(test => test.label) }));
if (!report.passed) process.exitCode = 1;
