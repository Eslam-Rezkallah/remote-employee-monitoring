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

// BE-8.2 Burnup chart data
// GET /org/:orgId/spaces/:spaceId/reports/sprints/:sprintId/burnup
router.get("/sprints/:sprintId/burnup", authentication(), reportService.burnup);

// BE-8.5 Cumulative flow data
// GET /org/:orgId/spaces/:spaceId/reports/sprints/:sprintId/cumulative-flow
router.get(
  "/sprints/:sprintId/cumulative-flow",
  authentication(),
  reportService.cumulativeFlow
);

export default router;
