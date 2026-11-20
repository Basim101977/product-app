"use strict";

// Keep deployed names so cached clients receive an explicit migration response,
// not a missing endpoint. Shared-role grants and identifier changes are not
// part of the private, names-only application and perform no writes here.
module.exports = ({ onCall, HttpsError, authorisedWorkspaceOwner }) => Object.fromEntries([
  "provisionAttendanceMember", "renameOfficialStudentIdentifier", "revokeAttendanceMember", "updateAttendanceMemberProfile"
].map(name => [name, onCall({ region: "us-central1", invoker: "public" }, async request => {
  await authorisedWorkspaceOwner(request);
  throw new HttpsError("failed-precondition", "Refresh the application to use the private-account edition. Shared-role administration and student identifier changes are no longer supported; no data was changed.");
})]));
