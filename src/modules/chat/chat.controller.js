import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import * as chatService from "./service/chat.service.js";
const router = Router();

router.get("/:receiverId", authentication(), chatService.getChatHistory);
router.get("/", authentication(), chatService.getMyChats);

export default router;
