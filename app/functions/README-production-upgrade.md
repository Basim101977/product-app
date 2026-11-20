# Production compatibility candidate

This source targets the existing attendance project without copying Auth users,
moving rosters, deleting history, or claiming email verification that did not
occur. Deployment and administrator-created cutover evidence are separate
approved operations; unit/emulator tests never perform cloud writes.

## Access

`attendanceLegacyAccess/{uid}` is a frozen administrator-owned allowlist. Each
entry contains the exact `uid`, lowercase current `email`,
`approvedAtCutover: true`, and recorded `cutoverAt`. Browser reads and writes are
denied. Nonowner grandfather access additionally requires the account's CURRENT
matching-email `attendanceIndividualRequests/{uid}` to remain `approved`.

The existing platform owner has no approval request. Its one allowlist entry
also requires `platformOwner: true`, and both backend and rules pin the actual
production UID and email. That flag cannot elevate another UID. New accounts
still require real email verification and owner approval. Backend requests check
the current Auth user, disabled state, email, and token email; new verified access
also requires a verified token. Firestore rules use Firebase token validity,
not an unavailable live Auth-user lookup.

`getPersonalAccountStatus` returns honest `emailVerified` and a separate
`emailVerificationRequired` flag. The latter is false only for eligible frozen
accounts. Client-side status does not grant server access. Existing workspace
owner pointers and member identity must already match; mismatches are never
automatically repaired.

## Existing roster identity

Subjects lacking both `academicYearStart` and `stageNumber` retain the original
`cohort_<departmentId>__<stageId>[__section]` key. Version-1 legacy subjects and
server-controlled stored cohort pointers retain that identity after explicit
setup. New personal subjects use year-specific cohort keys. Private reset
cohorts remain isolated. Partial personal metadata fails closed.

A versioned cohort, explicit pointer, reset fence, or nonempty central roster is
authoritative. Missing cohort parent documents do not hide existing children.
Only absent/unversioned empty central rosters fall back to per-subject student
documents, then embedded rows. A deleted subject is never recreated from its
orphaned descendants. All current IDs, biometric links, marks and receipts stay
at their saved paths.

`updateLegacyEmbeddedRoster` accepts at most 300 existing-row edits/removals,
cannot insert or renumber IDs, and preserves untouched saved fields in a
transaction. It rejects stale fallback writes if another source is authoritative.
Biometric vectors are stored as the canonical descriptor/map, not nested arrays.

## Explicit future import setup

`configureLegacySubjectScope({workspaceId,subjectId,academicYearStart,stageNumber,
departmentPrefix?})` requires an explicitly supplied year and stage matching the
saved stage. It pins the old cohort path and records server-only
`rosterSchemaVersion:1` and `legacyImportConfigured:true`. It does not infer
historical years or alter existing student identifiers. The cohort's import scope
is immutable; sibling legacy subjects must choose the same scope. Different years
need separate year-specific subjects.

The callable refuses source migration from per-subject/embedded rosters. Setup
and every import check active body identifiers, actual document identifiers,
and archived identifiers against the namespace counter. Missing, malformed, or
below-observed-maximum reservations fail closed; they are never guessed or
silently advanced. Rows lacking a body identifier retain their document ID in
name matching and receipts without modifying the saved row. Existing current
production namespace inventory is separately established from the full backup.
After setup, names already in the saved roster reuse their IDs; only new names
receive new counter-backed identifiers. Counters survive deletions and resets.

## Deployment boundaries

All 41 candidate endpoints retain the existing runtime service account.
`syncOfflineAttendanceBatch` remains in `asia-south1`; other candidate endpoints
remain in `us-central1`. Deploy explicit function names. Four legacy endpoint
names remain as guarded retirement wrappers: `provisionAttendanceMember`,
`renameOfficialStudentIdentifier`, `revokeAttendanceMember`, and
`updateAttendanceMemberProfile`. They authenticate with current private-owner
authorization, then return an explicit refresh/unsupported error without any
write. No function resource is deleted. Cached attendance recording, correction,
closure and offline synchronization endpoints remain functional; only removed
shared-role and identifier-renaming workflows are deliberately retired.

Run `node --test test/*.test.js test/*.test.cjs` here, and the real local
Firestore rules test `node tests/personal-rules-emulator.cjs` from the app root.
The metadata report lists the exact candidate endpoint names and regions.
