import { Router } from "express";
import * as messageService from "./service/message.service.js";
import * as validators from "./message.validation.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import {
  uploadCloudFile,
  fileValidations,
} from "../../utils/multer/cloud.multer.js";

const router = Router({ mergeParams: true });

router.use(authentication());

const uploadAny = uploadCloudFile([
  ...fileValidations.image,
  ...fileValidations.document,
  ...fileValidations.video,
  ...fileValidations.audio,
]);

// ── Send ──────────────────────────────────────────────────────
router.post(
  "/",
  uploadAny.array("attachments", 5),
  validation(validators.sendMessage),
  messageService.sendMessage,
);

// ── ✅ NEW: Search messages in a room ─────────────────────────
// GET /chat/rooms/:roomId/messages/search?q=hello&page=1&limit=20
router.get(
  "/search",
  validation(validators.searchMessages),
  messageService.searchMessages,
);

// ── List ──────────────────────────────────────────────────────
router.get(
  "/",
  validation(validators.listMessages),
  messageService.listMessages,
);

// ── Edit ──────────────────────────────────────────────────────
router.patch(
  "/:messageId",
  validation(validators.editMessage),
  messageService.editMessage,
);

// ── Delete ────────────────────────────────────────────────────
router.delete(
  "/:messageId",
  validation(validators.deleteMessage),
  messageService.deleteMessage,
);

// ── Receipts ──────────────────────────────────────────────────
router.patch(
  "/:messageId/seen",
  validation(validators.markSeen),
  messageService.markSeen,
);

router.patch(
  "/:messageId/delivered",
  validation(validators.messageParam),
  messageService.markDelivered,
);

export default router;
