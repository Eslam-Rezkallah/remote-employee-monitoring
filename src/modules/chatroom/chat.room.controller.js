import { Router } from "express";
import * as chatRoomService from "./service/chat.service.js";
import * as validators from "./chat.room.validation.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";

const router = Router();

router.use(authentication());

// ── Create ────────────────────────────────────────────────────

// POST /chat/rooms/direct
router.post(
  "/direct",
  validation(validators.createDirect),
  chatRoomService.createDirect,
);

// POST /chat/rooms/channel
router.post(
  "/channel",
  validation(validators.createChannel),
  chatRoomService.createChannel,
);

// POST /chat/rooms/team
router.post(
  "/team",
  validation(validators.createTeamChat),
  chatRoomService.createTeamChat,
);

// POST /chat/rooms/organization
router.post(
  "/organization",
  validation(validators.createOrganizationChat),
  chatRoomService.createOrganizationChat,
);

// POST /chat/rooms/group
router.post(
  "/group",
  validation(validators.createGroup),
  chatRoomService.createGroup,
);

// ── Read ──────────────────────────────────────────────────────

// GET /chat/rooms
router.get(
  "/",
  validation(validators.listChatRooms),
  chatRoomService.listChatRooms,
);

// GET /chat/rooms/:roomId
router.get(
  "/:roomId",
  validation(validators.roomParam),
  chatRoomService.getChatRoom,
);

// ── Update ────────────────────────────────────────────────────

// PATCH /chat/rooms/:roomId
router.patch(
  "/:roomId",
  validation(validators.updateRoom),
  chatRoomService.updateRoom,
);

// ── Membership ────────────────────────────────────────────────

// POST /chat/rooms/:roomId/join
router.post(
  "/:roomId/join",
  validation(validators.joinChannel),
  chatRoomService.joinChannel,
);

// DELETE /chat/rooms/:roomId/leave
router.delete(
  "/:roomId/leave",
  validation(validators.leaveRoom),
  chatRoomService.leaveRoom,
);

// POST /chat/rooms/:roomId/members/:memberId
router.post(
  "/:roomId/members/:memberId",
  validation(validators.manageMember),
  chatRoomService.addMember,
);

// DELETE /chat/rooms/:roomId/members/:memberId
router.delete(
  "/:roomId/members/:memberId",
  validation(validators.manageMember),
  chatRoomService.removeMember,
);

// ── Delete ────────────────────────────────────────────────────

// DELETE /chat/rooms/:roomId
router.delete(
  "/:roomId",
  validation(validators.roomParam),
  chatRoomService.deleteRoom,
);

export default router;
