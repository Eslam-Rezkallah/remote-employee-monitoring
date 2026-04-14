import { Router } from "express";
import * as userService from "./service/user.service.js";
import * as validators from "./user.validation.js";
import {
  authentication,
  authorization,
} from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import {
  uploadCloudFile,
  fileValidations,
} from "../../utils/multer/cloud.multer.js";
import { roleTypes } from "../../DB/Model/user.model.js";

const router = Router();

// Get own profile
router.get("/profile", authentication(), userService.profile);

// Get dashboard statistics
router.get("/profile/dashboard", authentication(), userService.dashboard);

// View another user's profile
router.get(
  "/profile/:profileId",
  authentication(),
  validation(validators.shareProfile),
  userService.shareProfile,
);

// share profile
router.post(
  "/profile/share/:profileId",
  authentication(),
  validation(validators.shareProfile),
  userService.shareProfile,
);

// Update profile info
router.patch(
  "/profile",
  authentication(),
  validation(validators.updateProfile),
  userService.updateProfile,
);

// Update profile image
router.patch(
  "/profile/image",
  authentication(),
  uploadCloudFile(fileValidations.image).single("attachment"),
  validation(validators.profileImage),
  userService.updateProfileImage,
);

// Update email (send verification codes)
router.patch(
  "/profile/email",
  authentication(),
  validation(validators.updateEmail),
  userService.updateEmail,
);

// Reset email (verify codes and update)
router.patch(
  "/profile/reset-email",
  authentication(),
  validation(validators.resetEmail),
  userService.resetEmail,
);

// Update password
router.patch(
  "/profile/password",
  authentication(),
  validation(validators.updatePassword),
  userService.updatePassword,
);

// Enable two-step verification
router.patch(
  "/twoStepVerification",
  authentication(),
  validation(validators.enableTwoStepVerification),
  userService.enableTwoStepVerification,
);

// Disable two-step verification
router.patch(
  "/disableTwoStepVerification",
  authentication(),
  validation(validators.disabledTwoStepVerification),
  userService.disabledTwoStepVerification,
);

// Toggle read receipts
router.patch(
  "/profile/read-receipts",
  authentication(),
  validation(validators.toggleReadReceipts),
  userService.toggleReadReceipts,
);

// Change user role (Admin only)
router.patch(
  "/:userId/role",
  authentication(),
  authorization([roleTypes.Admin]),
  validation(validators.changeRole),
  userService.changeRoles,
);

router.get("/members", authentication(), userService.getProjectMembers);

export default router;
