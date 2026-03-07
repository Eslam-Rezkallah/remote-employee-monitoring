import { sendEmail } from "./send.email.js";
import { organizationInvitationTemplate } from "./template/organizationInvitation.template.js";

export const sendOrganizationInvitationEmail = async ({
  to,
  orgName,
  role,
  invitationLink,
  expiresAt,
} = {}) => {
  const html = organizationInvitationTemplate({
    orgName,
    role,
    invitationLink,
    expiresAt,
  });

  return sendEmail({
    to,
    subject: `Invitation to join ${orgName}`,
    html,
  });
};
