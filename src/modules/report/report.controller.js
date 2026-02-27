import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import * as reportService from "./service/report.service.js";

const router = Router({ mergeParams: true });

// BE-8.3 Sprint report
// GET /org/:orgId/spaces/:spaceId/reports/sprints/:sprintId
router.get("/sprints/:sprintId", authentication(), reportService.sprintReport);

// BE-8.1 Burndown chart data
// GET /org/:orgId/spaces/:spaceId/reports/sprints/:sprintId/burndown
router.get("/sprints/:sprintId/burndown", authentication(), reportService.burndown);

export default router;
