'use strict';

// Creates privacy-sanitized DELIVERY/TEST DERIVATIVES, never a deployment.
// No credentials, network, cloud SDK, or arbitrary recursive copy is used.
// Original production/current published files must remain untouched.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const EXPECTED_SOURCE_SHA256 = '042e8cd622e8e93bd7fdb7340868f7e5c3dae90aacff054012c1fc3574cfeffd';
const TRANSFER_ROOT = path.resolve(__dirname, '..');
const PROFILES = Object.freeze({
  historical: Object.freeze({ kind: 'privacy-sanitized-historical-test-derivative',
    original: 'work/hathir-mobile-actions-20260919/candidate/netlify_site/index.html',
    sha256: EXPECTED_SOURCE_SHA256, placeholderCount: 1 }),
  current: Object.freeze({ kind: 'privacy-sanitized-current-delivery-derivative',
    original: 'work/hathir-production-upgrade-20260922/app/netlify_site/index.html',
    sha256: 'e4ca2c9cf675175d93b354fe0bcbaf896d926ce29ed8e73a49ce40ac3b0ca216', placeholderCount: 0 })
});
const destinationFor = profile => path.join(TRANSFER_ROOT, 'source', profile.original);
const DESTINATION = destinationFor(PROFILES.historical);
const EVIDENCE = path.join(TRANSFER_ROOT, 'evidence/privacy-transform.json');
const UI_TEST = Object.freeze({ kind: 'privacy-sanitized-local-login-test-derivative',
  original: 'work/hathir-production-upgrade-20260922/app/tests/personal-ui-regression.cjs',
  sha256: '6467c4ac0b4b902e4c05a01b2d8aa9cbf8a0f563ffedc46138ca1f093801ebc4' });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function uniqueIndex(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0 && source.indexOf(marker, start + marker.length) === -1, 'Expected exactly one known source boundary');
  return start;
}

function bounded(source, startMarker, endMarker) {
  const start = uniqueIndex(source, startMarker), end = uniqueIndex(source, endMarker);
  assert(end > start, 'Unexpected source boundary order');
  return { start, end, text: source.slice(start, end) };
}

function seedRows(source, startMarker, endMarker, expectedCount) {
  const section = bounded(source, startMarker, endMarker);
  const rows = [...section.text.matchAll(/\{ name: ("(?:[^"\\]|\\.)*"), id: ("(?:[^"\\]|\\.)*") \}/g)];
  assert.equal(rows.length, expectedCount, 'Unexpected legacy seed row count');
  return { ...section, privateLiterals: rows.flatMap(row => [JSON.parse(row[1]), JSON.parse(row[2])]) };
}

function syntheticFunction(name, count, prefix, newline, kind) {
  const rows = Array.from({ length: count }, (_, index) => `        { name: "Synthetic ${prefix} student ${String(index + 1).padStart(3, '0')}", id: "QA-${prefix}-${String(index + 1).padStart(3, '0')}" }`);
  return ['    function ' + name + '() {', '      // Privacy-sanitized ' + kind + '; not original deployed bytes.', '      return [', rows.join(',' + newline), '      ];', '    }', '', ''].join(newline);
}

function sanitize(sourceBytes) {
  const inputHash = sha256(sourceBytes);
  const profile = Object.values(PROFILES).find(item => item.sha256 === inputHash);
  assert(profile, 'Source is not either reviewed pinned index; refusing transformation');
  const source = sourceBytes.toString('utf8');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const primary = seedRows(source, '    function defaultStudents() {', '    function extraStudents() {', 30);
  const extra = seedRows(source, '    function extraStudents() {', '    function clone(value) {', 4);
  const defaults = bounded(source, '    function defaultLocalData() {', '    function cacheElements() {');
  const userStart = defaults.text.indexOf('      const users = {');
  const userEnd = defaults.text.indexOf('      };' + newline + newline + '      return {', userStart);
  assert(userStart >= 0 && userEnd > userStart, 'Expected bounded default account block');
  const users = defaults.text.slice(userStart, userEnd);
  const secrets = [...users.matchAll(/\bpassword: ("(?:[^"\\]|\\.)*")/g)].map(row => JSON.parse(row[1]));
  const emails = [...users.matchAll(/\bemail: ("(?:[^"\\]|\\.)*")/g)].map(row => JSON.parse(row[1]));
  const displayNames = [...users.matchAll(/\bdisplayName: ("(?:[^"\\]|\\.)*")/g)].map(row => JSON.parse(row[1]));
  assert.equal(secrets.length, 7); assert.equal(emails.length, 7); assert.equal(displayNames.length, 7);
  assert(emails.every(email => email.endsWith('.local')), 'Historical default account is not local-only');
  const counts = { password: 0, email: 0, displayName: 0 };
  const cleanUsers = users.replace(/\b(password|email|displayName): ("(?:[^"\\]|\\.)*")/g, (_, field) => {
    const index = ++counts[field];
    const value = field === 'password' ? `SYNTHETIC_FIXTURE_ONLY_${index}` : field === 'email' ? `synthetic-${index}@fixture.local` : `Synthetic local fixture ${index}`;
    return field + ': ' + JSON.stringify(value);
  });
  const replacements = [
    { start: primary.start, end: primary.end, text: syntheticFunction('defaultStudents', 30, 'PRIMARY', newline, profile.kind) },
    { start: extra.start, end: extra.end, text: syntheticFunction('extraStudents', 4, 'EXTRA', newline, profile.kind) },
    { start: defaults.start + userStart, end: defaults.start + userEnd, text: cleanUsers }
  ];
  // Historical HTML repeats an ID in one placeholder; current HTML already
  // uses a name-based placeholder. Both exact counts are reviewed/pinned.
  const oldPlaceholder = 'placeholder="' + primary.privateLiterals[1] + '"';
  assert.equal(source.split(oldPlaceholder).length - 1, profile.placeholderCount, 'Unexpected old-ID placeholder count');
  if (profile.placeholderCount) {
    const placeholderStart = uniqueIndex(source, oldPlaceholder);
    replacements.push({ start: placeholderStart, end: placeholderStart + oldPlaceholder.length, text: 'placeholder="QA-PRIMARY-001"' });
  }
  const ordered = [...replacements].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index++) assert(ordered[index - 1].end <= ordered[index].start, 'Transformation boundaries overlap');
  let clean = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) clean = clean.slice(0, replacement.start) + replacement.text + clean.slice(replacement.end);
  // A residual match fails closed without displaying its sensitive value.
  for (const [category, values] of Object.entries({ primary: primary.privateLiterals, extra: extra.privateLiterals, passwords: secrets, emails, displayNames })) {
    // Generic role words legitimately remain in role checks and UI labels;
    // account displayName properties themselves were all replaced above.
    const residualCount = [...new Set(values)].filter(value => !(category === 'displayNames' && /^(owner|admin)$/i.test(value)) && clean.includes(value)).length;
    assert.equal(residualCount, 0, 'Historical seed values remain outside reviewed replacement boundaries: ' + category);
  }
  const functionBlock = bounded(clean, '    function defaultStudents() {', '    function clone(value) {').text;
  const rows = vm.runInNewContext(functionBlock + '\n[defaultStudents(), extraStudents()]', Object.create(null), { timeout: 1000 });
  assert.equal(rows[0].length, 30); assert.equal(rows[1].length, 4);
  assert(rows.flat().every(row => /^QA-(PRIMARY|EXTRA)-\d{3}$/.test(row.id) && row.name.startsWith('Synthetic ')));
  let previousSource = 0, previousOutput = 0;
  for (const replacement of ordered) {
    const unchanged = source.slice(previousSource, replacement.start);
    assert.equal(clean.slice(previousOutput, previousOutput + unchanged.length), unchanged, 'Unapproved source segment changed');
    previousOutput += unchanged.length + replacement.text.length;
    previousSource = replacement.end;
  }
  assert.equal(clean.slice(previousOutput), source.slice(previousSource), 'Unapproved trailing source changed');
  let inlineScriptsParsed = 0;
  for (const match of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(match[1]) && match[2].trim()) new vm.Script(match[2], { filename: 'sanitized-inline-' + (++inlineScriptsParsed) });
  }
  return { bytes: Buffer.from(clean, 'utf8'), profile, report: { kind: profile.kind,
    originalSource: profile.original, destination: 'source/' + profile.original,
    originalSourceSha256: inputHash, sanitizedSha256: sha256(clean), sanitizedStudentRows: 34,
    sanitizedLocalAccounts: 7, replacedLocalAccountFields: counts,
    sanitizedOldIdPlaceholders: profile.placeholderCount, reviewedReplacementRanges: replacements.length,
    unchangedOutsideReviewedRanges: true, residualPrivateSeedValues: 0, inlineScriptsParsed,
    preservedWorkerAndStorageCode: true, originalAndCurrentSourcesModified: false } };
}

function ensureNoSymlinkAncestors(destination) {
  let current = destination;
  while (true) {
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'Symlink destination path is not permitted');
    if (current === TRANSFER_ROOT) break;
    const parent = path.dirname(current);
    assert(parent !== current && (parent === TRANSFER_ROOT || parent.startsWith(TRANSFER_ROOT + path.sep)), 'Destination escaped transfer root');
    current = parent;
  }
}

function sanitizeUiRegression(sourceBytes, originalIndexBytes) {
  assert.equal(sha256(sourceBytes), UI_TEST.sha256, 'UI regression input is not the reviewed original');
  assert.equal(sha256(originalIndexBytes), PROFILES.current.sha256, 'Current index input is not the reviewed original');
  const source = sourceBytes.toString('utf8');
  const accounts = bounded(originalIndexBytes.toString('utf8'), '    function defaultLocalData() {', '    function cacheElements() {').text;
  const emails = [...accounts.matchAll(/\bemail: ("(?:[^"\\]|\\.)*")/g)].map(row => JSON.parse(row[1]));
  const passwords = [...accounts.matchAll(/\bpassword: ("(?:[^"\\]|\\.)*")/g)].map(row => JSON.parse(row[1]));
  assert.equal(emails.length, 7); assert.equal(passwords.length, 7);
  const affected = source.split(/\r?\n/).map((line, index) => ({ line, index })).filter(({ line }) =>
    line.includes("page.locator('#authEmail').fill(") && line.includes("page.locator('#authPassword').fill(") && emails.some(email => line.includes("'" + email + "'")));
  assert.equal(affected.length, 1, 'Expected exactly one historical local-login input fixture');
  assert.equal(affected[0].index, 324, 'Pinned UI fixture moved unexpectedly');
  const accountIndex = emails.findIndex(email => affected[0].line.includes("'" + email + "'"));
  const oldEmailLiteral = "'" + emails[accountIndex] + "'", oldPasswordLiteral = "'" + passwords[accountIndex] + "'";
  assert(affected[0].line.includes(oldPasswordLiteral), 'Local-login fixture does not match the known local seed');
  const replacements = [
    { old: oldEmailLiteral, replacement: `'synthetic-${accountIndex + 1}@fixture.local'` },
    { old: oldPasswordLiteral, replacement: `'SYNTHETIC_FIXTURE_ONLY_${accountIndex + 1}'` }
  ].map(change => ({ ...change, start: uniqueIndex(source, change.old) })).sort((a, b) => b.start - a.start);
  let clean = source;
  for (const change of replacements) clean = clean.slice(0, change.start) + change.replacement + clean.slice(change.start + change.old.length);
  let recovered = clean;
  for (const change of [...replacements].reverse()) {
    const index = uniqueIndex(recovered, change.replacement);
    recovered = recovered.slice(0, index) + change.old + recovered.slice(index + change.replacement.length);
  }
  assert.equal(recovered, source, 'UI test changed outside the two fixture literals');
  new vm.Script(clean, { filename: 'sanitized-personal-ui-regression.cjs' });
  return { source: UI_TEST.original, original: sourceBytes, bytes: Buffer.from(clean), profile: UI_TEST,
    report: { kind: UI_TEST.kind, originalSource: UI_TEST.original, destination: 'source/' + UI_TEST.original,
      originalSourceSha256: UI_TEST.sha256, sanitizedSha256: sha256(clean), changedLine: 325,
      replacedFixtureFields: { localEmail: 1, localPassword: 1 }, reviewedReplacementRanges: 2,
      unchangedOutsideReviewedRanges: true, originalLocalCredentialLiteralsRemaining: 0,
      javascriptParsed: true, testAssertionsAndControlFlowUnchanged: true, originalSourceModified: false } };
}

function validateDestination(destination, bytes, allowedPrevious) {
  ensureNoSymlinkAncestors(destination);
  if (fs.existsSync(destination)) {
    const existing = fs.readFileSync(destination);
    assert(existing.equals(bytes) || (allowedPrevious && existing.equals(allowedPrevious)), 'Refusing to overwrite an existing different destination');
  }
}

function writeNew(destination, bytes, allowedPrevious) {
  validateDestination(destination, bytes, allowedPrevious);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx' });
  else if (!fs.readFileSync(destination).equals(bytes)) fs.writeFileSync(destination, bytes);
}

function run(sourceFiles, { checkOnly = false } = {}) {
  const inputs = Array.isArray(sourceFiles) ? sourceFiles : [sourceFiles];
  assert(inputs.length === 2 && inputs.every(Boolean), 'Supply both original current and historical index paths');
  const results = inputs.map(sourceFile => {
    const source = path.resolve(sourceFile);
    assert(!source.toLowerCase().startsWith(TRANSFER_ROOT.toLowerCase() + path.sep), 'Input must be an external original, never a delivery derivative');
    const original = fs.readFileSync(source), result = sanitize(original);
    return { source, original, ...result };
  });
  assert.equal(new Set(results.map(result => result.profile.kind)).size, 2, 'Both distinct reviewed sources are required');
  results.sort((a, b) => a.profile.kind.localeCompare(b.profile.kind));
  const priorReport = { schemaVersion: 1, purpose: 'User-approved delivery-only privacy sanitization; not a deployment',
    originalSourcesModified: false, cloudAccessed: false, changedFilesPerSourceTree: ['netlify_site/index.html'],
    files: results.map(result => result.report) };
  const current = results.find(result => result.profile === PROFILES.current);
  const testPath = path.resolve(path.dirname(current.source), '../tests/personal-ui-regression.cjs');
  const test = sanitizeUiRegression(fs.readFileSync(testPath), current.original);
  test.source = testPath;
  results.push(test);
  const report = { schemaVersion: 2, purpose: priorReport.purpose,
    originalSourcesModified: false, cloudAccessed: false,
    changedFilesBySourceTree: {
      current: ['netlify_site/index.html', 'tests/personal-ui-regression.cjs'],
      historical: ['netlify_site/index.html']
    },
    scannerRationale: { originalShortPasswordCategory: 'four-digit numeric local-demo password',
      unrelatedSubstringMatches: { backendSyntheticOperationIdentifier: 3, offlineHarnessSyntheticTimestamp: 1 },
      rule: 'Only numeric-only four-digit password candidates require no adjacent digit; all other seed categories retain full substring checks.',
      actualQuoteDelimitedLocalLoginFixtureReplaced: true },
    files: results.map(result => result.report) };
  const evidenceBytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  const priorEvidenceBytes = Buffer.from(JSON.stringify(priorReport, null, 2) + '\n');
  // Validate all outputs before any write. Originals are never write targets.
  for (const result of results) validateDestination(destinationFor(result.profile), result.bytes, result.profile === UI_TEST ? result.original : undefined);
  validateDestination(EVIDENCE, evidenceBytes, priorEvidenceBytes);
  if (!checkOnly) {
    for (const result of results) writeNew(destinationFor(result.profile), result.bytes, result.profile === UI_TEST ? result.original : undefined);
    writeNew(EVIDENCE, evidenceBytes, priorEvidenceBytes);
  }
  for (const result of results) assert(fs.readFileSync(result.source).equals(result.original), 'Original source bytes changed unexpectedly');
  return { ...report, checkOnly, evidence: 'evidence/privacy-transform.json' };
}

module.exports = { sanitize, sanitizeUiRegression, run, PROFILES, UI_TEST, EXPECTED_SOURCE_SHA256, DESTINATION, EVIDENCE };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    assert(args.length >= 2 && args.length <= 3 && (!args[2] || args[2] === '--check-only'), 'Usage: node sanitize-legacy-fixture.cjs <current-original-index> <historical-original-index> [--check-only]');
    process.stdout.write(JSON.stringify(run(args.slice(0, 2), { checkOnly: args[2] === '--check-only' }), null, 2) + '\n');
  } catch (error) {
    // Assertion messages are authored above and never contain original literals.
    process.stderr.write('Legacy fixture sanitization failed: ' + error.message.split('\n')[0] + '\n');
    process.exitCode = 1;
  }
}
