# Local candidate 150 — remove requested interface notes

Not published; live release remains 149.
Candidate: development/source/work/hathir-clean-notes-20261019/app.
Retained baseline: development/source/work/hathir-face-column-20261019/app (149), unchanged.
Candidate identifier: v2026.10.19-clean-notes-150.

Removed the requested Arabic notes and equivalent English notes from subject scheduling default help, face preference help, recovery help (including its reused location), push-notification default help, owner-only requests help, local backups help, signup-link explanation, visible teacher-search label and cloud lecture-count explanation. Empty compatibility note nodes stay hidden; removed descriptions no longer regenerate on rendering. Search keeps its placeholder and an accessible name. Actual saved schedule information and its reset button remain. Notification errors, permission/setup instructions and success states remain available; empty default notification status hides itself. Controls, validation, permissions, calculations, data and stored preferences unchanged.

Files changed: index.html, service-worker.js, settings-ui.js, personal-ui.js, subject-tools.js, notifications.js, plus admin-options-ui test assertions. No backend changes. Static search verified none of the requested note strings remain in application sources (excluding vendor files). Chromium tests: admin-options-ui 10 and subject-tools-regression 8, all passing, no browser errors; owner requests phone screenshot inspected. No production writes or publication. Full release regression, new deploy-gate manifest registration, backup/freeze and hosting asset verification remain required before a later authorized publication.
