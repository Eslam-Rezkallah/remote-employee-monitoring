/**
 * Canonical audit action names.
 *
 * One source of truth — every audit log entry should use a constant
 * from this file. Dashboard filters and alerting rules subscribe to
 * these strings, so renaming any of them is a breaking change.
 *
 * Convention: `<domain>.<entity>.<verb>[.<outcome>]`
 */
export const auditActions = Object.freeze({
  // ── Auth ──────────────────────────────────────────────────
  AUTH_LOGIN_SUCCESS: "auth.login.success",
  AUTH_LOGIN_FAILURE: "auth.login.failure",
  AUTH_LOGOUT: "auth.logout",
  AUTH_LOGOUT_ALL: "auth.logout_all",
  AUTH_PASSWORD_RESET_REQUEST: "auth.password.reset_request",
  AUTH_PASSWORD_RESET_COMPLETE: "auth.password.reset_complete",
  AUTH_PASSWORD_CHANGE: "auth.password.change",
  AUTH_2FA_ENABLE: "auth.2fa.enable",
  AUTH_2FA_DISABLE: "auth.2fa.disable",
  AUTH_2FA_FAILURE: "auth.2fa.failure",
  AUTH_REFRESH_REUSE: "auth.refresh.reuse_detected",

  // ── Organization ──────────────────────────────────────────
  ORG_CREATE: "org.create",
  ORG_UPDATE: "org.update",
  ORG_DELETE: "org.delete",
  ORG_MEMBER_INVITE: "org.member.invite",
  ORG_MEMBER_JOIN: "org.member.join",
  ORG_MEMBER_REMOVE: "org.member.remove",
  ORG_MEMBER_LEAVE: "org.member.leave",
  ORG_MEMBER_ROLE_CHANGE: "org.member.role_change",

  // ── Team ──────────────────────────────────────────────────
  TEAM_CREATE: "team.create",
  TEAM_UPDATE: "team.update",
  TEAM_DELETE: "team.delete",
  TEAM_MEMBER_ADD: "team.member.add",
  TEAM_MEMBER_REMOVE: "team.member.remove",
  TEAM_MANAGER_PROMOTE: "team.manager.promote",
  TEAM_MANAGER_DEMOTE: "team.manager.demote",
});
