import { Router } from "express";
import * as validators from "./auth.validation.js";
import * as registrationService from "./service/registration.service.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as loginService from "./service/login.service.js";
import * as organizationService from "./service/organization.service.js";
import * as sessionService from "./service/session.service.js";
import { authentication } from "../../middleware/auth.middleware.js";
const router = Router();

router.post(
  "/signup",
  validation(validators.signup),
  registrationService.signup
);

router.patch(
  "/confirm-email",
  validation(validators.confirmEmail),
  registrationService.confirmEmail
);



// ... other imports , these are GET requests because they involve browser redirects!!
router.get("/loginWithGmail", loginService.loginWithGmail); // Step 1: Redirects to Google
router.get("/google/callback", loginService.googleCallback); // Step 2: Google sends the user here

router.post("/login", validation(validators.login), loginService.login);
router.post("/loginWithGmail", loginService.loginWithGmail);
router.post(
  "/validate-login-otp",
  validation(validators.validateLoginOTP),
  loginService.validateLoginOTP
);
router.post(
  "/verify-2step-verification",
  validation(validators.verify2StepVerification),
  loginService.verifyEnableTwoStepVerification
);
router.patch(
  "/forget-password",
  validation(validators.forgetPassword),
  loginService.forgetPassword
);
router.patch(
  "/validate-forget-password",
  validation(validators.validateForgetPassword),
  loginService.validateForgetPassword
);
router.patch(
  "/reset-password",
  validation(validators.resetPassword),
  loginService.resetPassword
);

// router.post(
//   "/org-create",
//   authentication(),
//   validation(validators.createOrganization),
//   organizationService.createOrganizationController
// );

router.post(
  "/org-create",
  validation(validators.createOrganization),
  organizationService.createOrganizationController
);

router.post(
  "/org-join",
  validation(validators.joinOrganization),
  organizationService.joinOrganizationController
);

// ── Session Management (BE-2.2) ───────────────────────────────────────────────

// Exchange a refresh token for a new access token
router.post("/refresh-token", sessionService.refreshToken);

// Logout from current device (revokes the provided refresh token)
router.post("/logout", authentication(), sessionService.logout);

// Logout from ALL devices (revokes all sessions for this user)
router.post("/logout-all", authentication(), sessionService.logoutAll);

// Get all active sessions for the logged-in user
router.get("/sessions", authentication(), sessionService.getSessions);

// Revoke a specific session by ID (kick a device)
router.delete(
  "/sessions/:sessionId",
  authentication(),
  sessionService.revokeSession
);

export default router;
