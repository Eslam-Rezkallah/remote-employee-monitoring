import { Router } from "express";
import * as messageService from "./service/message.service.js";
import * as validators from "./message.validation.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import {
  uploadCloudFile,
  fileValidations,
} from "../../utils/multer/cloud.multer.js";

// mergeParams: true allows access to :roomId from parent router
const router = Router({ mergeParams: true });

router.use(authentication());

// Multer: accept images, documents, video, audio
const uploadAny = uploadCloudFile([
  ...fileValidations.image,
  ...fileValidations.document,
  ...fileValidations.video,
  ...fileValidations.audio,
]);

// ── Send ──────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/messages
router.post(
  "/",
  uploadAny.array("attachments", 5), // up to 5 files
  validation(validators.sendMessage),
  messageService.sendMessage,
);

// ── Read ──────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/messages
router.get(
  "/",
  validation(validators.listMessages),
  messageService.listMessages,
);

// ── Edit ──────────────────────────────────────────────────────
// PATCH /chat/rooms/:roomId/messages/:messageId
router.patch(
  "/:messageId",
  validation(validators.editMessage),
  messageService.editMessage,
);

// ── Delete ────────────────────────────────────────────────────
// DELETE /chat/rooms/:roomId/messages/:messageId
router.delete(
  "/:messageId",
  validation(validators.deleteMessage),
  messageService.deleteMessage,
);

// ── Receipts ──────────────────────────────────────────────────
// PATCH /chat/rooms/:roomId/messages/:messageId/seen
router.patch(
  "/:messageId/seen",
  validation(validators.markSeen),
  messageService.markSeen,
);

// PATCH /chat/rooms/:roomId/messages/:messageId/delivered
router.patch(
  "/:messageId/delivered",
  validation(validators.messageParam),
  messageService.markDelivered,
);

export default router;
