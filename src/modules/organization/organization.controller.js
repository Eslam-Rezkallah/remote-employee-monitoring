import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as validators from "./organization.validation.js";
import * as orgService from "./service/organization.service.js";
import * as invitationService from "./service/invitation.service.js";
import spaceController from "../space/space.controller.js";
import activityController from "../activity/activity.controller.js";
import {
  uploadFileDisk,
  fileValidations,
} from "../../utils/multer/local.multer.js";

const router = Router();

router.get(
  "/invitations/validate",
  validation(validators.validateInvitation),
  invitationService.validateInvitation
);

router.post(
  "/invitations/accept",
  authentication(),
  validation(validators.acceptInvitation),
  invitationService.acceptInvitation
);

router.post(
  "/:orgId/invitations",
  authentication(),
  validation(validators.createInvitation),
  invitationService.createInvitation
);

router.use("/:orgId/spaces", spaceController);

router.post(
  "/",
  authentication(),
  uploadFileDisk("organization/profile", fileValidations.image).single("logo"),
  validation(validators.createOrg),
  orgService.createOrg
);

router.patch(
  "/:orgId",
  authentication(),
  uploadFileDisk("organization/profile", fileValidations.image).single("logo"),
  validation(validators.updateOrg),
  orgService.updateOrg
);

router.delete(
  "/:orgId",
  authentication(),
  validation(validators.orgIdParam),
  orgService.deleteOrg
);
router.use("/:orgId/activity", activityController);

export default router;
