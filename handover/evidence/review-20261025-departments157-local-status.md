# Local candidate157 — department dropdown management

Not published; production156 remains at https://hathir.web.app/. Baseline development/source/work/hathir-consolidation-plain-20261023/app retained unchanged. Candidate development/source/work/hathir-department-tools-20261025/app, version v2026.10.25-department-tools-157.

Adds in-row Edit/Delete SVG icon buttons and bottom-sticky Create department to the department dropdown inside the current subject editor. Retains native subjectDept field and original change handler for existing subject save/stage logic. Existing subject department remains fixed; management can rename departments without changing identifiers or moving the subject. Dropdown selection is disabled in existing-subject edit mode. Lists inactive departments as nonselectable; their existing status is not changed.

Reuses addDepartment, saveDepartment, deleteDepartment and existing canAdministerDepartments role guard. No new permissions or backend/rules/schema change. Existing built-in department delete protection and referenced-subject block are retained (disabled trash icons with explanatory title). Original delete confirmation reused. Creation retains automatic stage presets; rename retains selected stage and source ID; deleting selected unused custom department refreshes selection/stages. Local failures restore department/stage maps; identity/session fences avoid applying stale UI updates. Rejects normalized duplicate names before save. No attendance/roster/subject identifiers changed.

Public changes index.html, service-worker.js, subject-tools.js; added department-tools.css, department-tools.js. subject-tools change is one custom editor-open event; index/service-worker add/version/cache entries. New CSS/JS are self contained.

Checks:10 cases each Chromium/WebKit (390/1280px), covering create/default stages, retained draft, rename identity/stage, duplicate rejection, confirmation cancel/accept, custom department-only deletion, local storage failure rollback, built-in/referenced department protection and role isolation. Original8 subject-tools cases also passed, including history and schedule preservation. No browser errors or real cloud writes in tests; cloud branch not end-to-end tested. Two bounded visual batches inspected phone and desktop; creation command remains visible at bottom of the list. No physical-device claim. Logs review-20261025-departments157-ui.log, -webkit.log, -subjects.log.

Preview http://127.0.0.1:4196/; helper review-20261025-departments157-preview.cjs, session71064, synthetic teacher/local data, Firebase boot removed and connect-src none. Opens new subject department list for review. Before later publication: include department-tools test in full run-local, fresh encrypted original backup, register157/freeze/final full QA and hosting verification.

Published157 verified 2026-10-25T10:19:52.732Z. Earlier local-only text is history; see review-20261025-release157-status.md.
