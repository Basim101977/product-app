# Local candidate 149 — face column follows recognition preference

Not published. Current live release remains 148.

Candidate: development/source/work/hathir-face-column-20261019/app.
Retained baseline: development/source/work/hathir-admin-options-20261019/app (published 148), unchanged.
Candidate identifier: v2026.10.19-face-column-149.

Changes: index.html starts with faceAttendanceOff and hides only roster face header/cells through CSS, preserving physical column indices and underlying data. settings-ui.js synchronizes the body class on preference/account rendering and emits hathir-face-preference only on changes. roster-filters.js reapplies on that event, removes the hidden face column from available filters, clears its active filter and closes its popup, while retaining all other filters. service-worker.js version updated for a future release. No backend or student/face data changes.

Verified: admin-options-ui 9 passing cases in Chromium and 9 in WebKit; roster700-ui 6 passing Chromium cases. Added assertions cover hidden default header/cells, immediate restoration when enabled, clearing an invisible face filter when disabled, retained templates, phone/desktop and print. Phone screenshot visually inspected. No physical camera/phone testing and no production writes.

No full regression suite or deploy-check/freeze for 149 yet. Before any later authorized publication: run the full local suite against this candidate, register the new release manifest in the existing deployment gate without weakening it, use a fresh verified encrypted snapshot (148 snapshot may still be under 24 hours; check its age), retain 148 hashes, deploy hosting only (backend unchanged) and verify changed asset hashes. Do not redeploy the 148 folder to deliver this change.
