# Published release 149

Published and SHA256-verified 2026-10-19T16:02:24.315Z on https://hathir.web.app/, existing project alqar-student-attendance-2026 / site hathir.

Current published source: development/source/work/hathir-face-column-20261019/app.
Identifier: v2026.10.19-face-column-149.
Retained previous published source: development/source/work/hathir-admin-options-20261019/app (148), unchanged.

The face attendance setting now also hides/restores the roster face header and cells on phone, desktop and print. Saved templates and physical column indexes remain intact. Disabling clears only the now-hidden face filter and closes its popup. Empty-row column spans follow the visible columns, including on preference changes. No backend, rules, recognition thresholds, identity, outbox namespace or data changes.

Initial full QA identified an empty-row colspan regression in four phone/desktop Arabic/English cases. Corrected in personal-ui.js and roster-filters.js; targeted name-only suite passed all 34 cases, then the full suite was rerun and passed all 736 cases with zero production data access or writes. Initial failure log retained: review-20261019-qa149.log; final passing log: review-20261019-qa149-final.log. Additional WebKit feature checks passed locally before publication; synthetic browser checks do not certify physical phone/camera behavior.

Fresh verified encrypted production snapshot retains release 148 before this deployment: C:/Users/alqar/AppData/Local/HathirBackups/release-20261019-1792425187574; 37623 Firestore documents at fixed read time checked against an independent aggregate count, 55 functions and their deployed source archives, 256 hosting files, rules/indexes. Complete at 2026-10-19T15:58:07.761Z. Pointer: candidate ../.private/baseline/manifest.json.

Hosting-only deployment succeeded. All five changed assets matched local SHA256: index.html, personal-ui.js, roster-filters.js, service-worker.js, settings-ui.js. Backend comparison confirmed unchanged. Evidence in app/reports: published-149.json, change-scope-149.json, retained-release-148.json, release-source-manifest-face-column-149.json, local-regression-summary.json, RELEASE-149-NOTES.md. Deployment log: review-20261019-publish149.log. The earlier face-column149-local-status.md is historical; this record supersedes its unpublished status.
