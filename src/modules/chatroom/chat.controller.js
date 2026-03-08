import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as chatService from "./service/chat.service.js";
import * as validators from "./chat.validation.js";

const router = Router();

router.post(
  "/",
  authentication(),
  validation(validators.createChatRoom),
  chatService.createChatRoom,
);
router.get(
  "/",
  authentication(),
  validation(validators.getChatRooms),
  chatService.getChatRooms,
);
router.get(
  "/:chatRoomId/messages",
  authentication(),
  validation(validators.getMessages),
  chatService.getMessages,
);
router.post(
  "/message",
  authentication(),
  validation(validators.sendMessage),
  chatService.sendMessage,
);
router.patch(
  "/message",
  authentication(),
  validation(validators.editMessage),
  chatService.editMessage,
);
router.delete(
  "/message",
  authentication(),
  validation(validators.deleteMessage),
  chatService.deleteMessage,
);
router.patch(
  "/pin",
  authentication(),
  validation(validators.pinMessage),
  chatService.pinMessage,
);
router.post(
  "/reaction",
  authentication(),
  validation(validators.addReaction),
  chatService.addReaction,
);
router.get(
  "/search",
  authentication(),
  validation(validators.searchMessages),
  chatService.searchMessages,
);
router.patch("/:chatRoomId/seen", authentication(), chatService.markAsSeen);

export default router;
