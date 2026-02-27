import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import * as starService from "./service/star.service.js";

const router = Router();

router.post("/", authentication(), starService.toggleStar);
router.get("/", authentication(), starService.listStars);

export default router;
