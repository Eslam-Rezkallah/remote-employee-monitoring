import { Router } from "express";
import * as validators from "./auth.validation.js";
import * as registrationService from "./service/registration.service.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as loginService from "./service/login.service.js";
import * as organizationService from "./service/organization.service.js";
import { authentication } from "../../middleware/auth.middleware.js";
const router = Router();

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

// ... other imports , these are GET requests because they involve browser redirects!!

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

// router.post(
//   "/org-create",
//   authentication(),
//   validation(validators.createOrganization),
//   organizationService.createOrganizationController
// );

router.post(
  "/org-create",
  validation(validators.createOrganization),
  organizationService.createOrganizationController,
);

router.post(
  "/org-join",
  validation(validators.joinOrganization),
  organizationService.joinOrganizationController,
);

export default router;
