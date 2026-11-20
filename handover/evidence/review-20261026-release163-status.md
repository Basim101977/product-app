# Published163 — 2026-10-26
Live: https://hathir.web.app/
Source: development/source/work/hathir-face-preference-20261026/app
Version: v2026.10.26-face-optin-163
Verified2026-10-26T18:18:27.565Z: SHA256 of index.html, service-worker.js, settings-ui.js matches local source.
Hosting only; functions, rules, project/Auth identity and student/attendance/face records unchanged. Civil retirement guards preserved.
Face is OFF for existing legacy-ON preferences and new users until explicitly enabled from Settings. Only faceAttendanceOptInV2 true authorizes recognition; Settings saves future choice and clears legacy flag. Existing templates preserved; face column hides when OFF. Stored preference refreshes on storage/focus/pageshow/visibility and before scanner checks; unrelated settings merge latest fields to avoid stale-tab reactivation.
Devices must load update163; an old offline app cannot be remotely changed. New choice remains account/device local, not cross-device cloud setting. No real phone/camera validation.
Full796 synthetic tests pass2026-10-26T18:17:12.860Z, cloudWrites0. Tests include legacyON resetsOFF, explicitON/OFF reload, account separation, two-tabOFF plus unrelated save, hidden face column, retained templates. No production data used in tests.
Fresh encrypted backup C:/Users/alqar/AppData/Local/HathirBackups/release-20261026-1793038292584:45358Firestore docs,55functions/sourcearchives,263hostingfiles; AESGCM/hash/DPAPI verified. Auth password hashes/device-local pending excluded; full restore not performed. Prior162 source retained unchanged.
Evidence: review-20261026-qa163.log, review-20261026-backup163.log, review-20261026-publish163.log; candidate reports/published-163.json, local-regression-summary.json, release-source-manifest-face-optin-163.json, retained-release-162.json.
No announcement or faculty messages sent.
