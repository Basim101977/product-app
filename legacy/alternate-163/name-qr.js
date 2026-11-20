/*
 * Compact name-only QR protocol, version 2; version 1 cards remain readable.
 * No storage, network, DOM, or attendance writes. The name fingerprint is a lookup
 * key, NEVER a replacement for an internal student ID, authentication, or secrecy.
 * Names can be guessed and hashed, so a digest does not anonymize the name.
 * Callers must supply complete, authorized current-roster { subject, student }
 * pairs, then revalidate both the scan scope and uniqueness immediately before
 * committing attendance. Never deduplicate these pairs by name or student ID.
 * An invalid, missing, or ambiguous result must not fall back to an ID lookup.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HathirNameQR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PREFIX = 'H2:';
  const LEGACY_PREFIX = 'HATHIR-NAME:1:';
  const HASH_DOMAIN = 'HATHIR-NAME:2:';
  const MAX_NAME_LENGTH = 150; // Unicode code points, after whitespace cleanup.
  const MAX_SOURCE_LENGTH = MAX_NAME_LENGTH * 16; // Bound work before normalization.
  const MAX_PAYLOAD_LENGTH = LEGACY_PREFIX.length + MAX_NAME_LENGTH * 12;
  const ARABIC_MARK = /\p{Script_Extensions=Arabic}/u;
  const NAME = /^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*(?: (?:[2-9]|[1-9][0-9]+))?$/u;
  const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

  function normalizeName(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_SOURCE_LENGTH || CONTROL.test(value)) return '';
    // Space separators include ordinary, nonbreaking, and other Unicode spaces;
    // line breaks and invisible format/control characters are deliberately invalid.
    const name = value.normalize('NFKC').replace(/\p{Zs}+/gu, ' ').trim();
    if (!name || Array.from(name).length > MAX_NAME_LENGTH || !NAME.test(name)) return '';
    const key = name
      .replace(/\u0640/gu, '') // Arabic tatweel.
      .replace(/\p{M}/gu, mark => ARABIC_MARK.test(mark) ? '' : mark)
      .replace(/[\u0622\u0623\u0625\u0671]/gu, '\u0627') // آ أ إ ٱ -> ا.
      .replace(/\u0629/gu, '\u0647') // ة -> ه.
      .replace(/ (?![0-9]+$)/g, '') // Keep the explicit duplicate suffix; join compound names.
      .toLowerCase(); // Locale-independent; Latin uppercase/lowercase agree.
    return key && Array.from(key).length <= MAX_NAME_LENGTH && /^\p{L}[\p{L}\p{M}]*(?: (?:[2-9]|[1-9][0-9]+))?$/u.test(key) ? key : '';
  }

  // Standard SHA-256, kept synchronous for existing card/canvas callers. These
  // fixed constants and operations implement the 32-bit SHA-256 compression;
  // this is a deterministic identifier, not a security/authentication primitive.
  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  function rotateRight(value, bits) { return (value >>> bits) | (value << (32 - bits)); }
  function sha256(text) {
    // Validated names contain no unpaired surrogates. Explicit UTF-8 encoding
    // also works in offline browsers without TextEncoder or WebCrypto.
    const bytes = [];
    for (const character of text) {
      const code = character.codePointAt(0);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
      else if (code < 0x10000) bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
      else bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3f), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const bitLength = bytes.length * 8;
    view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(padded.length - 4, bitLength >>> 0, false);
    const hash = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    const words = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const x = words[i - 15], y = words[i - 2];
        const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
        const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
        words[i] = (words[i - 16] + sigma0 + words[i - 7] + sigma1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let i = 0; i < 64; i++) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temp1 = (h + sum1 + choice + SHA256_K[i] + words[i]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (sum0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      const block = [a, b, c, d, e, f, g, h];
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + block[i]) >>> 0;
    }
    return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('');
  }
  function fingerprintKey(key) { return sha256(HASH_DOMAIN + key).slice(0, 32).toUpperCase(); }
  function fingerprint(name) {
    const key = normalizeName(name);
    if (!key) throw new TypeError('A valid full student name of at most 150 characters is required.');
    return fingerprintKey(key);
  }
  function encode(name) {
    // Exactly 35 ASCII characters, compatible with QR Alphanumeric mode.
    return PREFIX + fingerprint(name);
  }

  function decode(payload) {
    const invalid = reason => ({ ok: false, key: '', reason });
    if (typeof payload !== 'string') return invalid('invalid-type');
    if (payload.startsWith(PREFIX)) {
      if (payload.length > PREFIX.length + 32) return invalid('too-long');
      const key = payload.slice(PREFIX.length);
      return /^[0-9A-F]{32}$/.test(key) ? { ok: true, key, version: 2 } : invalid('invalid-encoding');
    }
    if (!payload.startsWith(LEGACY_PREFIX)) return invalid('unsupported-format');
    if (payload.length > MAX_PAYLOAD_LENGTH) return invalid('too-long');
    const encoded = payload.slice(LEGACY_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9%]+$/.test(encoded)) return invalid('invalid-encoding');
    let name;
    try { name = decodeURIComponent(encoded); }
    catch (_) { return invalid('invalid-encoding'); }
    if (Array.from(name).length > MAX_NAME_LENGTH) return invalid('too-long');
    const key = normalizeName(name);
    return key ? { ok: true, key } : invalid('invalid-name');
  }

  function match(payload, pairs) {
    const decoded = decode(payload);
    if (!decoded.ok) return { status: 'invalid', key: '', reason: decoded.reason };
    if (!Array.isArray(pairs)) return { status: 'invalid', key: decoded.key, reason: 'invalid-roster' };
    // Recompute against every current pair: no stale name cache, ID-based
    // deduplication, or acceptance of the first matching digest in a collision.
    const matches = pairs.filter(pair => {
      if (!pair || !pair.subject || !pair.student) return false;
      const key = normalizeName(pair.student.name);
      return key && (decoded.version === 2 ? fingerprintKey(key) : key) === decoded.key;
    });
    if (!matches.length) return { status: 'missing', key: decoded.key };
    if (matches.length !== 1) return { status: 'ambiguous', key: decoded.key, count: matches.length };
    return { status: 'match', key: decoded.key, subject: matches[0].subject, student: matches[0].student };
  }

  return Object.freeze({ normalizeName, fingerprint, encode, decode, match });
});
