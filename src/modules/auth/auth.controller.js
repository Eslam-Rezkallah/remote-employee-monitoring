import { Router } from "express";
import * as validators from "./auth.validation.js";
import * as registrationService from "./service/registration.service.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as loginService from "./service/login.service.js";
// FIX: imports from its OWN service folder — NOT from organization module
import * as organizationService from "./service/organization.service.js";
import { authentication } from "../../middleware/auth.middleware.js";
import * as refreshService from "./service/refresh.service.js";
import * as logoutService from "./service/logout.service.js";

const router = Router();

// ── Registration ──────────────────────────────────────────────
router.post(
  "/signup",
  validation(validators.signup),
  registrationService.signup,
);

router.patch(
  "/confirm-email",
  validation(validators.confirmEmail),
  registrationService.confirmEmail,
);

router.post("/signupWithGoogle", registrationService.signupWithGoogle);

// ── Login ─────────────────────────────────────────────────────
router.post("/login", validation(validators.login), loginService.login);

router.post("/loginWithGmail", loginService.loginWithGoogle);

router.post(
  "/validate-login-otp",
  validation(validators.validateLoginOTP),
  loginService.validateLoginOTP,
);

router.post(
  "/verify-2step-verification",
  validation(validators.verify2StepVerification),
  loginService.verifyEnableTwoStepVerification,
);

// ── Password reset ────────────────────────────────────────────
router.patch(
  "/forget-password",
  validation(validators.forgetPassword),
  loginService.forgetPassword,
);

router.patch(
  "/validate-forget-password",
  validation(validators.validateForgetPassword),
  loginService.validateForgetPassword,
);

router.patch(
  "/reset-password",
  validation(validators.resetPassword),
  loginService.resetPassword,
);

// ── Organization onboarding ───────────────────────────────────

router.post(
  "/org-join",
  validation(validators.joinOrganization),
  organizationService.joinOrganizationController,
);
// ── Token refresh ─────────────────────────────────────────────
router.post(
  "/refresh",
  validation(validators.refreshToken),
  refreshService.refreshAccessToken,
);

// ── Logout ────────────────────────────────────────────────────
router.post(
  "/logout",
  authentication(),
  validation(validators.refreshToken),
  logoutService.logout,
);

router.post(
  "/logout-all",
  authentication(),
  logoutService.logoutAll,
);
export default router;
