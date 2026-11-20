"use strict";

// The first session keeps the original date key. Later sessions on that day
// have an immutable suffix; never truncate a key used for storage or fencing.
function safeLectureId(value) {
  const key = typeof value === "string" ? value : "";
  if (!/^\d{4}-\d{2}-\d{2}(?:__[a-f0-9]{32})?$/.test(key)) return "";
  const date = key.slice(0, 10), time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? key : "";
}
const calendarDate = value => safeLectureId(value).slice(0, 10);
module.exports = { safeLectureId, calendarDate };
