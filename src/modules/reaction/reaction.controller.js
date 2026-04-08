
import { Router } from "express";
import * as reactionService from "./service/reaction.service.js";
import * as validators from "./reaction.validation.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";

// mergeParams: inherits :roomId and :messageId from parent routers
const router = Router({ mergeParams: true });

router.use(authentication());

// ── Reactions ─────────────────────────────────────────────────

// POST /chat/rooms/:roomId/messages/:messageId/reactions
router.post(
  "/",
  validation(validators.addReaction),
  reactionService.addReaction,
);

// DELETE /chat/rooms/:roomId/messages/:messageId/reactions
router.delete(
  "/",
  validation(validators.removeReaction),
  reactionService.removeReaction,
);

// GET /chat/rooms/:roomId/messages/:messageId/reactions
router.get(
  "/",
  validation(validators.listReactions),
  reactionService.listReactions,
);

export default router;
