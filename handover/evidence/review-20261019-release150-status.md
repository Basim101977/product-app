# Published release 150

Published and SHA256-verified 2026-10-19T16:19:27.133Z at https://hathir.web.app/, original alqar-student-attendance-2026 project / hathir site.

Current published source: development/source/work/hathir-clean-notes-20261019/app.
Identifier: v2026.10.19-clean-notes-150.
Retained previous source: development/source/work/hathir-face-column-20261019/app (149), unchanged.

Removed the user's specified explanatory notes from the interfaces and their equivalent English render assignments: default weekday/time scheduling, face switch, recovery, default notifications, requests owner-only explanation, local backup explanation, registration-link explanation, visible search label and lecture count explanation. Compatibility nodes remain hidden/empty. Search keeps its placeholder and accessible name. Settings controls, saved preferences, counts, actual scheduling information/reset, notifications' actionable states, validation and all operations remain available. No backend, rules, calculations, identity, data or storage changes.

Full compatibility suite: 737 passing cases, zero production data reads/writes in tests. Evidence: app/reports/local-regression-summary.json and review-20261019-qa150.log. Targeted checks previously passed 18 cases and the requests-phone screenshot was inspected. Browser fixtures do not establish physical phone/camera performance.

Fresh encrypted verified production snapshot before publishing retains current 149: C:/Users/alqar/AppData/Local/HathirBackups/release-20261019-1792426392307. 37623 Firestore documents at a fixed read time checked by independent aggregate count; 55 functions and their deployed source archives; 256 hosting files; rules/indexes. Pointer: candidate ../.private/baseline/manifest.json. Log: review-20261019-backup150.log.

Hosting-only deployment succeeded. All six changed assets matched local SHA256: index.html, notifications.js, personal-ui.js, service-worker.js, settings-ui.js, subject-tools.js. Backend comparison confirmed no changes. Evidence in app/reports: published-150.json, change-scope-150.json, retained-release-149.json, release-source-manifest-clean-notes-150.json, RELEASE-150-NOTES.md. Deployment log: review-20261019-publish150.log. This published status supersedes the earlier local-candidate status file.
