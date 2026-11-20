# Face preference correction — local only, 2026-10-26
Baseline: published162, development/source/work/hathir-department-labels-20261025/app (unchanged).
Candidate: development/source/work/hathir-face-preference-20261026/app.
Confirmed defect: settings-ui caches prefs per page without storage/focus/resume invalidation; an old tab can keep face ON after another tab saves OFF and can overwrite it on unrelated preference saves.
Fix: refresh cached preference only when stored raw value changes, merge only explicit changed fields with latest saved preferences, refresh on storage/focus/pageshow/visible resume; faceEnabled checks current stored preference. No saved choice still defaults OFF; explicit ON preserved. Storage exceptions retain session preference and existing warning. Account boundaries unchanged. No student/face data or cloud writes/deployment.
Regression: new two-tab OFF + unrelated RFID save + reload test FAILS on original162 settings-ui (timeout waiting for OFF) and PASSES with correction. admin-options-ui: 11/11 pass, including defaults, reload, account isolation, face-column/filter and retained templates. local-owner-requests: 5/5 pass.
No real iPhone/camera test and no production publication performed. Full release suite/backup/freeze required before future publication. Reproduction and correction script: review-20261026-face-fix.cjs.

## Explicit default-OFF reset requested by owner
New faceAttendanceOptInV2 preference is the sole activation authority. Old faceAttendance:true is ignored, so every existing workspace/device starts OFF on updating, without removing saved templates. Only Settings switch writes the new flag, retains future explicit choice, and also writes legacy faceAttendance:false. This separate flag prevents stale legacy ON from granting activation in updated code. Devices still running old offline code cannot be remotely changed until they update. No cloud account/data migration or publication performed.
Verification: admin-options-ui now 12/12 pass, including seeded legacy ON -> OFF, reload still OFF, explicit Settings ON persists, OFF persists, independent accounts, two-tab updates and column visibility. Previous device-workspace21/21 and owner-settings5/5 were run before this narrow opt-in follow-up; not rerun after it. Full release suite still required before publishing.

Published163; authoritative final evidence: review-20261026-release163-status.md. Full796 cases passed, public3assets verified.
