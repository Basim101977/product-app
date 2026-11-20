'use strict';

// End-to-end camera path with Chromium's fake capture device: the shipped
// "start scanner" control calls getUserMedia, the scan loop reads real video
// frames of a card drawn by the app, and attendance is queued locally.
// Synthetic students only; loopback Firebase mock; no cloud calls. This is not
// a physical camera: optics, focus, glare and real lighting remain untested.
const vm = require('node:vm');
const { REPORTS, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('camera-fake-stream');
report.limitations.push('Chromium fake capture device plays a generated Y4M file; no physical camera, autofocus, glare or real lighting.',
  'Dim variant is a synthetic brightness/contrast/noise reduction, not a measured low-light capture.');
const source = fs.readFileSync(path.join(__dirname, 'name-qr-regression.cjs'), 'utf8');
const { installWorkspace } = vm.runInNewContext(source.slice(source.indexOf('async function installWorkspace'),
  source.indexOf('async function currentState')) + ';({installWorkspace})');

const WIDTH = 960, HEIGHT = 540, CARD_W = 360, CARD_H = 480;
const STUDENT = 'فاطمه عبدالله احمد';

// Convert one RGBA card into 4 Y4M (I420) frames, centred on a grey desk.
function writeY4m(file, rgba, { gain = 1, offset = 0, noise = 0 } = {}) {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const y = Buffer.alloc(WIDTH * HEIGHT), u = Buffer.alloc(WIDTH * HEIGHT / 4, 128), v = Buffer.alloc(WIDTH * HEIGHT / 4, 128);
    const left = (WIDTH - CARD_W) / 2, top = (HEIGHT - CARD_H) / 2;
    let seed = 1234567 + f;
    const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - .5; };
    for (let row = 0; row < HEIGHT; row++) for (let col = 0; col < WIDTH; col++) {
      let luma = 150;
      const cx = col - left, cy = row - top;
      if (cx >= 0 && cy >= 0 && cx < CARD_W && cy < CARD_H) {
        const i = (cy * CARD_W + cx) * 4;
        luma = .299 * rgba[i] + .587 * rgba[i + 1] + .114 * rgba[i + 2];
      }
      y[row * WIDTH + col] = Math.max(0, Math.min(255, Math.round(luma * gain + offset + random() * noise)));
    }
    frames.push(Buffer.from('FRAME\n'), y, u, v);
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`), ...frames]));
}

async function renderCards() {
  const harness = await launch(report);
  try {
    const { page, context } = await harness.page({ width: 390 });
    try {
      await installWorkspace(page);
      return await page.evaluate(async ({ name, w, h }) => {
        await loadOptionalLibrary('qrcode');
        const draw = async scope => {
          const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
          await drawStudentQrCard(canvas.getContext('2d'), { name, id: 'SYNTHETIC-CARD' }, 0, 0, w, h, { subject: scope });
          return Array.from(canvas.getContext('2d').getImageData(0, 0, w, h).data);
        };
        const s = getSubject();
        return {
          matching: await draw(s), matchingPayload: HathirNameQR.encodeScoped(name, s.departmentId, s.stageId),
          other: await draw({ departmentId: 'synthetic_other_department', stageId: s.stageId }),
          otherPayload: HathirNameQR.encodeScoped(name, 'synthetic_other_department', s.stageId)
        };
      }, { name: STUDENT, w: CARD_W, h: CARD_H });
    } finally { await context.close(); }
  } finally { await harness.close(); }
}

async function withCamera(file, task) {
  const harness = await launch(report, { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--use-file-for-fake-video-capture=' + file] });
  try {
    const { page, context } = await harness.page({ width: 390 });
    try { await installWorkspace(page); return await task(page); }
    finally { await context.close(); }
  } finally { await harness.close(); }
}

const startCamera = page => page.evaluate(async () => {
  await startScanner();
  return { live: Boolean(cameraStream), size: [els.qrVideo.videoWidth, els.qrVideo.videoHeight],
    label: cameraStream?.getVideoTracks()[0]?.label || '' };
});
const queued = page => page.evaluate(async () => (await HathirOfflineStore.operations(personalFixture.uid))
  .map(op => ({ studentId: op.studentId, method: op.record?.method, subjectId: op.subjectId })));
const stopCamera = page => page.evaluate(() => { stopScanner(); return { live: Boolean(cameraStream), src: els.qrVideo.srcObject }; });

(async () => {
  const cards = await renderCards();
  const directory = path.join(REPORTS, 'camera-fake-stream'); fs.mkdirSync(directory, { recursive: true });
  const files = { normal: path.join(directory, 'card-normal.y4m'), dim: path.join(directory, 'card-dim.y4m'), other: path.join(directory, 'card-other-scope.y4m') };
  writeY4m(files.normal, cards.matching);
  writeY4m(files.dim, cards.matching, { gain: .42, offset: 18, noise: 14 });
  writeY4m(files.other, cards.other);

  for (const [variant, label] of [['normal', 'clear card'], ['dim', 'dim, low-contrast, noisy card']]) {
    await check(report, `Start scanner → fake camera ${label} → one local scan mark, no duplicate while the card stays in view`, () => withCamera(files[variant], async page => {
      const camera = await startCamera(page);
      assert.equal(camera.live, true, 'getUserMedia must deliver the fake capture device');
      assert(camera.label.endsWith(path.basename(files[variant])), 'The live track is the generated capture file');
      assert.deepEqual(camera.size, [WIDTH, HEIGHT]);
      // Poll from Node: an async waitForFunction predicate returns a truthy Promise.
      const deadline = Date.now() + 20000, started = Date.now();
      while (!(await queued(page)).length) {
        assert(Date.now() < deadline, 'No scan mark within 20 s of the camera going live');
        await page.waitForTimeout(100);
      }
      const firstMarkMs = Date.now() - started;
      await page.waitForTimeout(2500);
      const ops = await queued(page);
      assert.deepEqual(ops, [{ studentId: 'MI20250001', method: 'scan', subjectId: 'qa_name_a' }]);
      const state = await page.evaluate(() => ({ last: lastScanValue, feedback: nameQrFeedback.slice(), writes: personalFixture.writes.length,
        shown: document.getElementById('lastScanId').textContent }));
      assert.equal(state.last, cards.matchingPayload, 'The camera decoded the scoped H4 card payload');
      assert(state.feedback.includes('ok')); assert.equal(state.writes, 0);
      assert.equal(state.shown, STUDENT);
      assert.deepEqual(await stopCamera(page), { live: false, src: null });
      return { variant, camera: camera.label, firstMarkMs, operations: ops.length };
    }));
  }

  await check(report, 'Fake camera card from another department is decoded but rejected without any mark', () => withCamera(files.other, async page => {
    const camera = await startCamera(page);
    assert.equal(camera.live, true);
    await page.waitForFunction(payload => lastScanValue === payload, cards.otherPayload, { timeout: 20000 });
    await page.waitForTimeout(1500);
    assert.deepEqual(await queued(page), []);
    const state = await page.evaluate(() => ({ feedback: nameQrFeedback.slice(), attendance: subjects.map(s => s.attendance), writes: personalFixture.writes.length }));
    assert(!state.feedback.includes('ok'));
    assert(state.attendance.every(a => Object.values(a).every(marks => Object.keys(marks).length === 0)));
    assert.equal(state.writes, 0);
    assert.deepEqual(await stopCamera(page), { live: false, src: null });
  }));
})().catch(error => report.cases.push({ label: 'setup', passed: false, error: error.stack }))
  .finally(() => { saveReport(report, 'camera-fake-stream'); if (!report.passed) process.exitCode = 1; });
