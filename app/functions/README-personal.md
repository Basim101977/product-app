# Inherited Personal backend reference

This production-upgrade candidate modifies the original isolated backend.
Read `README-production-upgrade.md` first: production identity, grandfathered
access, retained legacy rosters and explicit import setup differ from the
historical reference below. The isolated-project deployment instructions below
do not apply to this candidate.

This source is for the new personal Firebase project only. It does not migrate,
share, or grant access to production or central-edition records.

All 35 exported functions/triggers use `us-central1`. Every attendance, roster,
recovery and academic-status callable requires a currently verified Auth user,
a verified ID token, approval for the same current email, and workspace ID equal
to the caller's UID. The workspace's owner pointers and member UID must match.
The compatibility member role is `owner`; granular roles do not grant rights.

Each function is capped at two instances with zero minimum instances. The
runtime identity is the new project's dedicated `hathir-runtime` service account,
separate from the build account; it needs Firestore user access and Auth viewer
access, not Auth administrator privileges. Eventarc receiver access may also be
required for event delivery. The
existing one-minute lecture-closure scheduler and weekly review scheduler are
retained. Scheduler jobs, invocations, Firestore reads/writes, storage and egress
can still incur charges; instance caps are not a monetary budget guarantee.

The only pre-approval callables are `submitPersonalRegistration` (idempotently
creates a pending request) and `getPersonalAccountStatus` (own account only).
`listPersonalRegistrations` and `approvePersonalAccount` require both the fixed
owner UID and email, plus verification. The platform owner cannot read or change
another teacher's workspace. Requests, members and pointers deny client writes.

Owner runtime settings (non-secret; align with the Firestore rules):

- `HATHIR_OWNER_UID`: defaults to `hathir-personal-owner-20260922`.
- `HATHIR_OWNER_EMAIL`: defaults to `redacted@example.invalid`.

The reserved owner account must be provisioned through a trusted Admin SDK
workflow in the new project. No browser bootstrap or email-only elevation exists.
Configure Firebase Authentication's password policy to require at least 12
characters, uppercase, lowercase, digit and symbol before deployment. An Auth
password cannot be inspected by a post-registration callable. Client validation
is not a substitute for that project policy.

## Personal API

- `submitPersonalRegistration({firstName,fatherName,grandfatherName})` validates
  three letter-only name fields, including compound names; returns status/name.
- `getPersonalAccountStatus({})` returns status, emailVerified, isPlatformOwner,
  workspaceId, email and fullName. A missing request is `unregistered`.
- `approvePersonalAccount({uid,status})` accepts `approved` or `rejected`.
  Approval requires the teacher's current registered email to be verified.
- `openIndividualWorkspace({})` creates only the caller's UID workspace and
  preserves its existing attendance data on retries.
- `importPersonalStudents({workspaceId,subjectId,names,operationId,allowDuplicateNames})`
  accepts 1–300 names. A transaction binds the operation ID to its payload,
  reserves sequence numbers and creates all rows plus its durable receipt.
  Returns the resolved `departmentPrefix` with the students/cohort metadata.
  An unchanged retry returns the same codes without recreating deleted rows;
  receipts from older releases may not contain `departmentPrefix`.
- `setPersonalAcademicStatus({workspaceId,subjectId,studentId,status})` accepts
  only empty, `مستوفي`, `غير مستوفي`, or `محمل`. It changes only the selected
  subject's `academicStatuses` map, never attendance or another subject's status.

Departments store `codePrefix`, stages store `sort` and `departmentId`, subjects
store `departmentId`, `stageId`, `departmentPrefix`, `stageNumber`, and integer
`academicYearStart`. Import cross-checks these stored values. The internal
department abbreviations are not official institutional identifiers.

Canonical defaults, in department order:

| Department ID | Prefix |
| --- | --- |
| `medical_labs` | `MLT` |
| `community_health` | `CHT` |
| `nursing` | `NT` |
| `pharmacy` | `PT` |
| `forensic_evidence` | `FET` |
| `accounting` | `AT` |
| `materials_management` | `MMT` |
| `legal_administration` | `LAT` |
| `computer_networks_software` | `CNS` |
| `electronic_techniques` | `ELC` |
| `power_mechanics` | `PMT` |
| `civil_techniques` | `CT` |
| `mechanical_techniques` | `MT` |
| `surveying_techniques` | `ST` |
| `medical_devices` | `MI` |

Existing empty workspaces do not require a bulk migration. On import, an
unallocated built-in department resolves to its canonical default even when its
saved default is old. A subject's recognized old default is normalized in the
same transaction as allocation. Empty sibling subjects can catch up after the
department locks to the canonical prefix. Custom department prefixes still
require an exact saved subject match.

An issued namespace is never renamed: `codePrefixLocked`, locked subject scope,
existing department sequence reservations, and selected-cohort metadata/student
IDs preserve the old prefix. Missing lock flags therefore do not authorize
renumbering. Conflicting or incomplete allocation evidence blocks the import
for review; no student ID, lecture, QR content, prior receipt or sequence is
migrated. A department already allocated with `MD`, for example, continues to
issue `MD` codes; only unallocated departments start `MI`. A canonical namespace
already reserved by a different/custom department blocks the import rather than
sharing or taking over its counter. Positive counters with unknown ownership,
and missing counters for an already-issued scope, likewise require review.
Normal locked imports
retain the existing parallel read pattern; only an unlocked department adds a
department-filtered sequence query to check historical allocations. No cross-
workspace lookup or global student migration is performed.

The private cohort key is
`personal_<academicYearStart>_<departmentId>_<stageNumber>[__section]` inside the
teacher's own UID workspace. Other subjects in this cohort reuse the same names
and codes. Repeated names within one import require explicit confirmation and
receive distinct codes. Course-only reset/recovery uses isolated `private_*`
cohorts without changing other subjects. Academic-status maps are backed up and
cleared with a course roster reset, and restored from the recovery snapshot.

Codes are `<prefix><academicYearStart-stageNumber+1><four-digit sequence>`.
Counters are scoped to the teacher/prefix/entry-year, never reset by deletion,
and stop at 9999. Department prefixes, stage identity and imported subject scope
become immutable after the first import. Client-created arbitrary codes and
renaming of identifiers are denied; names and face templates remain editable.

## Local verification

Run with Node 22: `npm test` from this directory. The tests use no
credentials or remote requests and cover private authorization, registration,
approval, atomic/idempotent imports, duplicate names, independent statuses,
offline replays/corrections/tombstones, lecture lifecycle, and roster recovery.
The parent app's separate tests run real Firestore Emulator rule checks.

Cloud provisioning/deployment and Auth password-policy setup are separate
required launch steps; passing local tests does not imply a live deployment.
