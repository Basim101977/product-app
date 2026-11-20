# Civil branch defaults — local candidate2026-10-25
Source development/source/work/hathir-civil-branches-20261025/app
Not published; production remains158.
User requested exact default labels التقنيات المدنية-بناء and التقنيات المدنية-طرق. Added stable IDs civil_building/civil_roads with frontendCTB/CTR, English names and5stage presets each. No backend prefix mapping modified; legacycivilCT retained.
Existing authenticated cloud workspace: create-only transaction adds missing2departments and missing associated stages; requires existing workspace, same session/current auth and original management permission. Existing rows/settings never overwritten. Fresh workspace default catalog17.
Device-first existing workspace: ensureCivilBranchDefaults adds missing branch rows/stages into copied local data at install/live refresh; uses original serialized save and live diff queue, baseline computed from durable original row. Existing IDs/names/student/history untouched. Normal save failure rollback remains intact. Original civil department records retained and protected.
Tests passed90synthetic cases:2civil-defaults durable old-device/idempotence;44prefix/catalog cloud partial-stage and no duplicate transaction;21device-workspace;13device-live;10department-tools. No physical device/cloud production write test. No deployment requested on this final clarification; ready for publication workflow.
`nPublished159 subsequently; see review-20261025-release159-status.md.
