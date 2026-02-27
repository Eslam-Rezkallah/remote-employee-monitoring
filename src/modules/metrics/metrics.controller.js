import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import * as metricsService from "./service/metrics.service.js";

const router = Router({ mergeParams: true });

// BE-8.4 Velocity
// GET /org/:orgId/spaces/:spaceId/metrics/velocity?last=5
router.get("/velocity", authentication(), metricsService.velocity);

export default router;
