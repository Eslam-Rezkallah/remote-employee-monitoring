import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import * as metricsService from "./service/metrics.service.js";

const router = Router({ mergeParams: true });

// BE-8.4 Velocity
// GET /org/:orgId/spaces/:spaceId/metrics/velocity?last=5
router.get("/velocity", authentication(), metricsService.velocity);

// BE-8.7 Cycle time
// GET /org/:orgId/spaces/:spaceId/metrics/cycle-time?from=&to=&days=&sprintId=&type=&assigneeId=
router.get("/cycle-time", authentication(), metricsService.cycleTime);

// BE-8.8 DevOps metrics
// GET /org/:orgId/spaces/:spaceId/metrics/devops/deployment-frequency?from=&to=&days=
router.get(
  "/devops/deployment-frequency",
  authentication(),
  metricsService.deploymentFrequency
);

// GET /org/:orgId/spaces/:spaceId/metrics/devops/change-failure-rate?from=&to=&days=
router.get(
  "/devops/change-failure-rate",
  authentication(),
  metricsService.changeFailureRate
);

// GET /org/:orgId/spaces/:spaceId/metrics/devops/mttr?from=&to=&days=
router.get("/devops/mttr", authentication(), metricsService.mttr);

// GET /org/:orgId/spaces/:spaceId/metrics/devops/lead-time?from=&to=&days=
router.get("/devops/lead-time", authentication(), metricsService.leadTime);

// GET /org/:orgId/spaces/:spaceId/metrics/devops/summary?from=&to=&days=
router.get("/devops/summary", authentication(), metricsService.devopsSummary);

// AI-8.1 Predict sprint completion
// GET /org/:orgId/spaces/:spaceId/metrics/ai/sprint-completion?sprintId=
router.get(
  "/ai/sprint-completion",
  authentication(),
  metricsService.predictSprintCompletion
);

// AI-8.2 Bottleneck detection
// GET /org/:orgId/spaces/:spaceId/metrics/ai/bottlenecks?sprintId=&from=&to=&days=
router.get(
  "/ai/bottlenecks",
  authentication(),
  metricsService.detectBottlenecks
);

export default router;
