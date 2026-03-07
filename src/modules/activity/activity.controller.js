import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as activityService from "./service/activity.service.js";
import * as validators from "./activity.validation.js";

const router = Router({ mergeParams: true });

// GET /org/:orgId/activity?spaceId=&from=&to=&limit=
router.get("/", authentication(), validation(validators.getOrgActivity), activityService.getOrgActivity);

export default router;
