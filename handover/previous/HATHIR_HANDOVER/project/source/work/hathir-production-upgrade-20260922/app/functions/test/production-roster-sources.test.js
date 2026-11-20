"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cohortIdForSubject } = require("../personal-workspace");

// Evaluate only the actual read-only roster functions. No Firebase SDK, token,
// production credentials, module initialization, or network is involved.
const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const rosterCode = source.slice(source.indexOf("async function rosterForSubject("), source.indexOf("async function studentExistsInSubject("));
const studentCode = source.slice(source.indexOf("async function studentExistsInSubject("), source.indexOf("exports.getSubjectRosterCount ="));
function harness() {
  const rows = new Map();
  const snap = ref => ({ id: ref.id, ref, exists: rows.has(ref.path), data: () => rows.get(ref.path) });
  const doc = name => ({ path: name, id: name.split("/").at(-1), collection: key => collection(name + "/" + key), get: async () => snap(doc(name)) });
  const collection = (name, filters = [], limit = Infinity) => ({
    doc: id => doc(name + "/" + id), where: (key, op, value) => collection(name, [...filters, [key, value]], limit),
    limit: n => collection(name, filters, n), get: async () => {
      const docs = [...rows].filter(([key, value]) => key.startsWith(name + "/") && key.split("/").length === name.split("/").length + 1 && filters.every(([field, match]) => value[field] === match))
        .slice(0, limit).map(([key]) => snap(doc(key)));
      return { docs, empty: !docs.length };
    }
  });
  const db = { collection };
  return { rows,
    roster: new Function("db", "cohortIdForSubject", rosterCode + ";return rosterForSubject;")(db, cohortIdForSubject),
    student: new Function("db", "cohortIdForSubject", studentCode + ";return studentExistsInSubject;")(db, cohortIdForSubject) };
}
const subject = { id: "old", departmentId: "dept", stageId: "stage", students: [{ id: "STALE", name: "Old embedded row" }] };
const root = "attendanceWorkspaces/teacher", cohort = root + "/cohorts/cohort_dept__stage", old = root + "/subjects/old/students";

test("backend reads legacy cohort children even without a parent and ignores stale subject copies", async () => {
  for (const parent of [false, true]) {
    const h = harness(); if (parent) h.rows.set(cohort, { rosterVersion: 1 });
    h.rows.set(cohort + "/students/ACTIVE", { id: "ACTIVE", name: "Current row" });
    h.rows.set(old + "/STALE", { id: "STALE", name: "Stale subject row" });
    assert.deepEqual(await h.roster("teacher", subject), [{ id: "ACTIVE", name: "Current row" }]);
    assert.equal((await h.student("teacher", subject, "ACTIVE")).id, "ACTIVE");
    assert.equal(await h.student("teacher", subject, "STALE"), null);
  }
});

test("empty authoritative old cohort and reset fences never resurrect old fallback students", async () => {
  for (const mode of ["version", "pointer", "reset"]) {
    const h = harness(), selected = { ...subject };
    h.rows.set(old + "/STALE", { id: "STALE", name: "Stale subject row" });
    if (mode === "version") h.rows.set(cohort, { rosterVersion: 1 });
    if (mode === "pointer") selected.rosterCohortId = "cohort_dept__stage";
    if (mode === "reset") selected.lastRosterResetId = "saved-reset";
    assert.deepEqual(await h.roster("teacher", selected), []);
    assert.equal(await h.student("teacher", selected, "STALE"), null);
  }
});

test("subject fallback preserves auto-document IDs and is authoritative over embedded arrays", async () => {
  const h = harness(); h.rows.set(old + "/auto_document", { id: "ACTUAL", name: "Real legacy row" });
  assert.deepEqual(await h.roster("teacher", subject), [{ id: "ACTUAL", name: "Real legacy row" }]);
  assert.equal((await h.student("teacher", subject, "ACTUAL")).id, "ACTUAL");
  assert.equal(await h.student("teacher", subject, "STALE"), null);
  h.rows.clear(); assert.deepEqual(await h.roster("teacher", subject), [{ id: "STALE", name: "Old embedded row" }]);
  assert.equal((await h.student("teacher", subject, "STALE")).id, "STALE");
});
