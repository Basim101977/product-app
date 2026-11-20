# Published release 147

Published 18 October 2026 to https://hathir.web.app/, project alqar-student-attendance-2026.

Current published source: development/source/work/hathir-roster700-20261018/app.
Identifier: v2026.10.18-roster700-147.
Retained previous source: development/source/work/hathir-page-scroll-local-20261016/app (146), unchanged.

700-student private scope roster cap, 100-row paging for large lists with global search/column filtering/filtered printing, bounded legacy import batches/receipts, lossless compressed share transport and bounded inflation/transaction size, increased full-copy chunk capacity, Arabic QR name preflight and per-page canvas release. Existing IDs, names, attendance, outbox and face values are preserved; no migration or rules changes.

Final compatibility suite: 722 passing cases. Additional WebKit roster checks passed. UI benchmarks and synthetic measurements are not physical-phone performance guarantees.

Fresh encrypted snapshot completed: 32632 Firestore documents (full-descendant fixed-read-time query, paginated by name and checked against an independent same-read-time aggregate count), 55 deployed functions with original source archives, 256 hosting files, rules/indexes. Snapshot directory: C:/Users/alqar/AppData/Local/HathirBackups/release-20261018-1792313240611. Original slower recursive snapshot attempt was stopped after the full counted query succeeded; its partial output is not treated as a complete backup.

Three existing functions verified ACTIVE with fresh update timestamps: importPersonalStudents, privateRosterShare, closedLectureWorkspace. Firebase CLI reported each update successful, then exited on an unrelated asia-south1 artifact-cleanup policy setup. No cleanup policy was changed. review-20261018-finish147.cjs verified all three updates and reran the mandatory deployment gate before hosting-only publication.

All nine changed public assets matched local SHA256 after publication. Evidence: app/reports/published-147.json, change-scope-147.json, retained-release-146.json, release-source-manifest-roster700-147.json, local-regression-summary.json, and ../.private/baseline/manifest.json. Workspace logs retain the original CLI cleanup-policy exit and successful hosting completion.
