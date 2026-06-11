import { Router } from "express";
import * as callService from "./service/call.service.js";
import * as validators from "./call.validation.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";

// mergeParams: true → inherits :roomId from parent router
const router = Router({ mergeParams: true });

router.use(authentication());

// GET /chat/rooms/:roomId/calls — call history
router.get(
  "/",
  validation(validators.getCallHistory),
  callService.getCallHistory,
);

// GET /chat/rooms/:roomId/calls/active — check for active call
router.get(
  "/active",
  validation(validators.getActiveCall),
  callService.getActiveCall,
);

// GET /chat/rooms/:roomId/calls/:callId — single call details
router.get(
  "/:callId",
  validation(validators.getCall),
  callService.getCall,
);

// POST /chat/rooms/:roomId/calls/:callId/livekit-token
// Issues a short-lived JWT scoped to the call's LiveKit room.
// One token per device — clients refresh on reconnect.
router.post(
  "/:callId/livekit-token",
  validation(validators.issueLivekitToken),
  callService.issueLivekitToken,
);

// ── Recording controls ─────────────────────────────────────
// POST   /chat/rooms/:roomId/calls/:callId/recording          start
// DELETE /chat/rooms/:roomId/calls/:callId/recording          stop
// GET    /chat/rooms/:roomId/calls/:callId/recording/download signed URL
router.post(
  "/:callId/recording",
  validation(validators.getCall),
  callService.startCallRecording,
);
router.delete(
  "/:callId/recording",
  validation(validators.getCall),
  callService.stopCallRecording,
);
router.get(
  "/:callId/recording/download",
  validation(validators.getCall),
  callService.getRecordingDownload,
);

export default router;
