'use strict';
// Parsing is isolated from the page and terminated by the caller on timeout.
importScripts('vendor/xlsx-0.20.3.full.min.js');
self.onmessage = event => {
  try {
    const buffer = event.data;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > 5 * 1024 * 1024) throw Error('FILE_TOO_LARGE');
    const book = XLSX.read(buffer, { type: 'array', cellDates: false, sheetRows: 1002, sheets: 0 });
    if (!book.SheetNames.length) throw Error('EMPTY_SHEET');
    const sheet = book.Sheets[book.SheetNames[0]];
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
    if (range.e.r >= 1001 || range.e.c >= 32) throw Error('SHEET_TOO_LARGE');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    self.postMessage({ rows });
  } catch (error) { self.postMessage({ error: ['FILE_TOO_LARGE', 'EMPTY_SHEET', 'SHEET_TOO_LARGE'].includes(error.message) ? error.message : 'INVALID_FILE' }); }
};
