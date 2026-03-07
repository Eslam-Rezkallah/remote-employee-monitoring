import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { activityLogging } from "../../middleware/activity.middleware.js";
import * as starService from "./service/star.service.js";

const router = Router();

router.post("/", authentication(), activityLogging(), starService.toggleStar);
router.get("/", authentication(), starService.listStars);
router.get("/search", authentication(), starService.searchStars);

export default router;
