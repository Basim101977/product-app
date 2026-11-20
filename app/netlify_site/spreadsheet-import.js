'use strict';
window.HathirSpreadsheetImport = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  async read(file, { timeout = 15000 } = {}) {
    if (!file || file.size > this.maxBytes) throw Error('FILE_TOO_LARGE');
    if (typeof Worker !== 'function') throw Error('WORKER_UNAVAILABLE');
    let readTimer;
    const buffer = await Promise.race([
      file.arrayBuffer(),
      new Promise((_,reject)=>{readTimer=setTimeout(()=>reject(Error('FILE_READ_TIMEOUT')),timeout);})
    ]).finally(()=>clearTimeout(readTimer));
    return new Promise((resolve, reject) => {
      const worker = new Worker('spreadsheet-worker.js?v=20260923-stability1');
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); worker.terminate();
        error ? reject(Error(error)) : resolve(value);
      };
      const timer = setTimeout(() => finish('PARSE_TIMEOUT'), timeout);
      worker.onerror = () => finish('INVALID_FILE');
      worker.onmessage = ({ data }) => {
        if (data?.error) return finish(data.error);
        if (!Array.isArray(data?.rows)) return finish('INVALID_FILE');
        finish(null, data.rows);
      };
      try { worker.postMessage(buffer, [buffer]); } catch { finish('INVALID_FILE'); }
    });
  }
});
