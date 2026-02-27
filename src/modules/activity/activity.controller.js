import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import * as activityService from "./service/activity.service.js";

const router = Router({ mergeParams: true });

// GET /org/:orgId/activity?spaceId=&from=&to=&limit=
router.get("/", authentication(), activityService.getOrgActivity);

export default router;
