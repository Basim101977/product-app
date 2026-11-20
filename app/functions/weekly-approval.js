"use strict";

const { calendarDate } = require("./lecture-session");
const DAY = 24 * 60 * 60 * 1000;
// Baghdad observes UTC+03:00 throughout the attendance application's dates.
const BAGHDAD_OFFSET = 3 * 60 * 60 * 1000;

function latestWeeklyCutoff(value = Date.now()) {
  const millis = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(millis)) throw new TypeError("Invalid weekly review time.");
  const local = new Date(millis + BAGHDAD_OFFSET);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const sinceFriday = (local.getUTCDay() + 2) % 7;
  const reviewCutoffMillis = midnight - sinceFriday * DAY - BAGHDAD_OFFSET;
  const nextReviewMillis = reviewCutoffMillis + 7 * DAY;
  return { reviewCutoffMillis, reviewCutoffAt: new Date(reviewCutoffMillis).toISOString(),
    nextReviewMillis, nextReviewAt: new Date(nextReviewMillis).toISOString() };
}

function timestampMillis(value) {
  if (typeof value?.toMillis === "function") return Number(value.toMillis());
  if (value && Number.isFinite(Number(value.seconds ?? value._seconds))) return Number(value.seconds ?? value._seconds) * 1000;
  if (typeof value === "string") return Date.parse(value);
  return Number(value) || 0;
}

function lectureAssessmentEndMillis(lecture) {
  const date = calendarDate(lecture.id || lecture.date), time = /^(\d{1,2}):(\d{2})$/.exec(String(lecture.startTime || ""));
  if (!date) return Infinity;
  const duration = Number(lecture.durationMinutes), midnight = Date.parse(date + "T00:00:00+03:00");
  if (time && Number(time[1]) < 24 && Number(time[2]) < 60 && Number.isFinite(duration) && duration > 0) {
    const start = midnight + (Number(time[1]) * 60 + Number(time[2])) * 60000;
    const plannedEnd = start + duration * 60000;
    const closed = Number(lecture.closedAtMillis);
    // completedAt is a server/upload timestamp, NOT when an offline lecture
    // actually ended. Only an explicit manual close can shorten eligibility.
    if (lecture.closeReason === "manual" && Number.isFinite(closed) && closed >= start) return Math.min(plannedEnd, closed);
    return plannedEnd;
  }
  const end = timestampMillis(lecture.endAt);
  return Number.isFinite(end) && end > 0 ? end : midnight + DAY;
}

async function queueWeeklyReviews({ db, queueSubjectSummary, cutoff = latestWeeklyCutoff() }) {
  // Resolve at invocation time to avoid the calculator/helper module cycle.
  const { MODEL, SCHEMA } = require("./cumulative-attendance");
  let cursor = null, scanned = 0, queued = 0;
  do {
    let query = db.collectionGroup("subjects").orderBy("__name__").limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (!page.docs.length) break;
    scanned += page.docs.length;
    const subjects = page.docs.filter(doc => {
      const workspace = doc.ref.parent.parent, data = doc.data() || {};
      return workspace?.parent?.id === "attendanceWorkspaces" && !data.rosterOperationId && !data.attendanceClearInProgress &&
        !(data.summaryState === "ready" && data.summaryReviewCutoffMillis >= cutoff.reviewCutoffMillis &&
          data.summarySchemaVersion === SCHEMA && data.summaryCalculationModel === MODEL);
    });
    // Queue durably; the existing bounded minute worker performs the rebuilds.
    // A retry can revisit pages safely and does not need any teacher online.
    for (let index = 0; index < subjects.length; index += 20) {
      await Promise.all(subjects.slice(index, index + 20).map(doc => queueSubjectSummary(doc.ref)));
      queued += Math.min(20, subjects.length - index);
    }
    cursor = page.docs.at(-1);
    if (page.docs.length < 200) break;
  } while (cursor);
  return { scanned, queued, ...cutoff };
}

module.exports = { latestWeeklyCutoff, lectureAssessmentEndMillis, queueWeeklyReviews };
