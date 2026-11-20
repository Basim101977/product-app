# Latest state: PUBLISHED — release 143

Published v2026.10.15-scope-sharing-143 to https://hathir.web.app/ on 2026-10-15. Final full QA: 704 cases passed, zero cloud writes from tests. All existing production backup/freeze/deploy guards passed. Hosting only; no functions/rules/data migration deployed. Six changed public assets independently matched local SHA-256 after deployment.

Published candidate: development/source/work/hathir-sharing-20261015/app. Evidence: reports/published-143.json, reports/local-regression-summary.json, reports/release-source-manifest-scope-sharing-143.json and reports/sharing-change-scope.json inside that candidate. Original development tree remains intact with unpublished changes; do not deploy it as though it were this release. Read reports/RELEASE-143-NOTES.md in the candidate before further release work.

Verified local source backup (688 files): C:/Users/alqar/AppData/Local/HathirBackups/local-before-sharing-20261015-140211.
Verified encrypted production backup: C:/Users/alqar/AppData/Local/HathirBackups/release-20260927-1792062134642 (29,324 Firestore documents, 55 deployed functions snapshotted, 252 hosting files). Backup manifest records limitations, including no Auth password hashes or device-local pending data and no complete restore drill.

The entries below are historical attempts, superseded by this successful release; their logs remain preserved.

---
# Sharing name equivalence — local only

Follow-up: local name addition/import now distributes to matching private courses through an atomic plan preserving each course's IDs/history. New-course creation seeds from existing peer rosters as well as accepted scope registries and fills peer gaps during creation/addition. Archived identities, deliberate device roster resets, history-share copies, different stages/departments/periods are excluded. Canonical face deletion is respected while seeding names. No automatic background restoration of deleted rows. 18 unit tests and 10 browser integration cases pass after this change, including local additions without a registry and creation of a new matching course. JS syntax checks pass for all three modified runtime files. Additional runtime changes: device-workspace.js and personal-ui.js. Deployment remains blocked as described below.

Implemented restricted Arabic spelling equivalence for private scope invitation acceptance (NFKC, hamza carriers, taa marbuta/haa, alif maqsura/yaa, diacritics, tatweel and repeated whitespace). No edit-distance matching. Existing recipient IDs/names/history remain unchanged. Existing faces under differing IDs are retained; missing faces may be supplied. Duplicate normalized names, reused IDs for different names, and archived matching identities stop the plan before mutation.

Changed files: netlify_site/private-scope-roster.js; functions/test/private-scope-roster.test.cjs; tests/private-scope-ui.cjs in the authoritative development source.

Verification: 16 unit tests passed; 9 synthetic browser integration cases passed including actual acceptance button for differing IDs and Arabic spelling, preserving attendance. Reports: app/reports/share-name-matching-unit.log and app/reports/private-scope-ui.json. No real invitations or student records modified.

NOT DEPLOYED. Live service worker remains release 141; local tree has other unpublished release-142 changes. Existing deploy-check rejected with `Local compatibility suite has not passed`. The newly attempted full suite reproduced failures in beginner UI, onboarding and trial reset; logs retained at review-20261015-sharing-regression.log. Full run stopped after confirming unrelated release blockers; no passing summary fabricated. Production read-only encrypted backup attempt was stopped incomplete after gate failure (log review-20261015-sharing-backup.log); it is NOT a verified fresh snapshot. Existing baseline manifest was not replaced by this incomplete attempt. No release freeze/version bump or cloud deployment was performed.

Next release requires resolving compatibility failures against the intended release tree, completing a verified fresh backup, assigning a new release and passing the existing freeze/deploy gate. Do not bypass the guard or overwrite historical manifests to claim success.

## Final publish attempt — 2026-10-15
Full compatibility run completed, checked at 2026-10-15 10:29:13 UTC: 24 suites, 559 cases reported, overall FAILED. Passing suites include backend (167), isolated security rules emulator (131), static safety (7), service-worker upgrades (11), profile QR, student profile, record expansion and stability. Failures include old centralized sharing API, outdated help catalog/support expectations, incomplete closedLectureWorkspace mocks, legacy synchronization tests and responsive UI assertions. These are not all established application defects; they remain unresolved compatibility evidence. No tests were removed or marked passed, and deployment guards were not bypassed.
Additional current-architecture tests executed successfully: device-workspace 21, device-live 13, private-scope UI 10. Previous private-scope unit 18 passed. This does not substitute for a passing release gate.
Live service-worker was checked directly and still reports v2026.10.06-name-tooltip-141. No deployment occurred. The second read-only backup attempt was stopped after the release gate failed; last progress 19100 documents, no completion/verification message. It is not a verified fresh backup and must not authorize a release. Existing source edits remain local.
Logs: review-20261015-release-full.log and review-20261015-sharing-backup-final.log. Full QA report: development/source/work/hathir-production-upgrade-20260922/app/reports/local-regression-summary.json.


## Compatibility repair follow-up
No deployment or cloud writes. Fixed the synthetic harness to await its initial signed-out callback before manual-workspace setup. QR verification now permits only the separate read-only supportChat/announcements background request; all other cloud calls from QR remain forbidden. All 50 QR browser cases pass (review-20261015-qr-final.log).
The legacy sync transport tests now explicitly select the retained legacy path after normal startup (the shipped device adapter intentionally disables that path). Added device-workspace, device-live and private-scope suites to the full runner so current transport/migration/share coverage is mandatory, not replaced by legacy coverage. Legacy sync now passes 26/28 cases; visibility/offline wake cases remain failed (review-20261015-sync-compat-final.log). No failed checks removed or forced passed. Full suite has NOT been rerun after these test repairs; release remains blocked.
An attempted pre-start legacy script exclusion was rejected and fully reverted because bootstrap requires the device adapter. No such harness mode remains. No runtime application files were changed in this follow-up.
