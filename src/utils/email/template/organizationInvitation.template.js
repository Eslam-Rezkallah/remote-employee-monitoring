export const organizationInvitationTemplate = ({
  orgName = "",
  role = "member",
  invitationLink = "",
  expiresAt = "",
} = {}) => `
  <div style="font-family: Arial, sans-serif; line-height:1.5; color:#1f2937;">
    <h2>You have been invited to join ${orgName}</h2>
    <p>You were invited as <b>${role}</b>.</p>
    <p>This invitation expires at: <b>${expiresAt}</b></p>
    <p>
      <a href="${invitationLink}" style="display:inline-block;padding:10px 14px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">
        Accept Invitation
      </a>
    </p>
    <p>If the button does not work, use this link:</p>
    <p>${invitationLink}</p>
  </div>
`;
