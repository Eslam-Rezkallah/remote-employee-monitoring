import mongoose from "mongoose";
import chatRoomModel, {
  chatRoomTypes,
} from "../../../DB/Model/chatroom.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import userModel from "../../../DB/Model/user.model.js";
import teamModel from "../../../DB/Model/team.model.js";
import projectModel from "../../../DB/Model/project.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
// ✅ NEW: Import getChatNamespace for room creation broadcasts
import { getChatNamespace } from "../../socket/socket.controller.js";

/* ============================================================
   Shared Helpers
============================================================ */
async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member)
    throw Object.assign(new Error("Not a member of this organization"), {
      cause: 403,
    });
  return member;
}

async function requireRoomMember(roomId, userId) {
  const room = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: roomId, members: userId, isDeleted: false },
  });
  if (!room)
    throw Object.assign(new Error("Room not found or access denied"), {
      cause: 404,
    });
  return room;
}

async function requireRoomAdmin(room, userId) {
  const uid = userId.toString();
  const isAdmin = room.admins.some((a) => a.toString() === uid);
  const isCreator = room.createdBy.toString() === uid;
  if (!isAdmin && !isCreator)
    throw Object.assign(new Error("Not authorized to manage this room"), {
      cause: 403,
    });
}

// ✅ NEW: Helper to broadcast room creation to all members via socket
function broadcastRoomCreated(room) {
  try {
    const chatNs = getChatNamespace();
    if (chatNs && chatNs.broadcastRoomCreated) {
      chatNs.broadcastRoomCreated(room);
    }
  } catch (err) {
    console.error("[broadcastRoomCreated] Error:", err.message);
  }
}

/* ============================================================
   POST /chat/rooms/direct
============================================================ */
export const createDirect = asyncHandler(async (req, res, next) => {
  const senderId = req.user._id;
  const { targetUserId } = req.body;

  if (senderId.toString() === targetUserId) {
    return next(new Error("Cannot create a DM with yourself", { cause: 400 }));
  }

  const target = await dbService.findOne({
    model: userModel,
    filter: { _id: targetUserId, isDeleted: false },
    select: "_id username",
  });
  if (!target) return next(new Error("Target user not found", { cause: 404 }));

  const existing = await dbService.findOne({
    model: chatRoomModel,
    filter: {
      type: chatRoomTypes.direct,
      members: { $all: [senderId, targetUserId], $size: 2 },
      isDeleted: false,
    },
  });
  if (existing) {
    return successResponse({
      res,
      data: { room: existing },
      message: "DM already exists",
    });
  }

  const room = await dbService.create({
    model: chatRoomModel,
    data: {
      type: chatRoomTypes.direct,
      members: [senderId, targetUserId],
      admins: [senderId],
      createdBy: senderId,
      isPrivate: true,
    },
  });

  // ✅ Populate for broadcast
  const populated = await chatRoomModel
    .findById(room._id)
    .populate("members", "username email image")
    .lean();

  // ✅ NEW Feature 5: Broadcast room creation to all members
  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Direct message created" },
    201,
  );
});

/* ============================================================
   POST /chat/rooms/channel
============================================================ */
export const createChannel = asyncHandler(async (req, res, next) => {
  const { name, description, organizationId, teamId, projectId, isPrivate } =
    req.body;
  const userId = req.user._id;

  if (organizationId) {
    const member = await requireOrgMember(organizationId, userId);
    if (!["owner", "admin"].includes(member.role)) {
      return next(
        new Error("Only organization owner or admin can create channels", {
          cause: 403,
        }),
      );
    }
  }

  if (teamId && !organizationId) {
    const team = await dbService.findOne({
      model: teamModel,
      filter: { _id: teamId, members: userId, isDeleted: false },
    });
    if (!team)
      return next(
        new Error("Team not found or you are not a member", { cause: 404 }),
      );
  }

  if (projectId) {
    const project = await dbService.findOne({
      model: projectModel,
      filter: { _id: projectId, isDeleted: false },
      select: "manager organizationId",
    });
    if (!project) return next(new Error("Project not found", { cause: 404 }));
    const isProjectManager = project.manager.toString() === userId.toString();
    const orgId = project.organizationId;
    let isOrgAdmin = false;
    if (orgId) {
      const mem = await dbService.findOne({
        model: memberModel,
        filter: { organizationId: orgId, userId, isActive: true },
      });
      isOrgAdmin = mem && ["owner", "admin"].includes(mem.role);
    }
    if (!isProjectManager && !isOrgAdmin)
      return next(
        new Error(
          "Only project manager or organization owner/admin can create project channels",
          { cause: 403 },
        ),
      );
  }

  const room = await dbService.create({
    model: chatRoomModel,
    data: {
      name,
      description: description || null,
      type: chatRoomTypes.channel,
      organizationId: organizationId || null,
      teamId: teamId || null,
      projectId: projectId || null,
      members: [userId],
      admins: [userId],
      createdBy: userId,
      isPrivate: isPrivate ?? false,
    },
  });

  const populated = await chatRoomModel
    .findById(room._id)
    .populate("members", "username email image")
    .lean();

  // ✅ NEW Feature 5
  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Channel created" },
    201,
  );
});

/* ============================================================
   POST /chat/rooms/team
============================================================ */
export const createTeamChat = asyncHandler(async (req, res, next) => {
  const { teamId } = req.body;
  const userId = req.user._id;

  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, members: userId, isDeleted: false },
    select: "members name",
  });
  if (!team)
    return next(
      new Error("Team not found or you are not a member", { cause: 404 }),
    );

  let room = await dbService.findOne({
    model: chatRoomModel,
    filter: { type: chatRoomTypes.team, teamId, isDeleted: false },
  });

  if (room) {
    return successResponse({
      res,
      data: { room },
      message: "Team chat already exists",
    });
  }

  room = await dbService.create({
    model: chatRoomModel,
    data: {
      name: team.name ? `Team: ${team.name}` : "Team Chat",
      type: chatRoomTypes.team,
      teamId,
      members: team.members,
      admins: team.members,
      createdBy: userId,
      isPrivate: false,
    },
  });

  const populated = await chatRoomModel
    .findById(room._id)
    .populate("members", "username email image")
    .lean();

  // ✅ NEW Feature 5
  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Team chat created" },
    201,
  );
});

/* ============================================================
   POST /chat/rooms/organization
============================================================ */
export const createOrganizationChat = asyncHandler(async (req, res, next) => {
  const { organizationId } = req.body;
  const userId = req.user._id;

  const member = await requireOrgMember(organizationId, userId);
  if (!["owner", "admin"].includes(member.role)) {
    return next(
      new Error(
        "Only organization owner or admin can create organization chat",
        { cause: 403 },
      ),
    );
  }

  const orgMembers = await memberModel
    .find({ organizationId, isActive: true })
    .select("userId")
    .lean();
  const memberIds = orgMembers.map((m) => m.userId);

  let room = await dbService.findOne({
    model: chatRoomModel,
    filter: {
      type: chatRoomTypes.organization,
      organizationId,
      isDeleted: false,
    },
  });

  if (room) {
    return successResponse({
      res,
      data: { room },
      message: "Organization chat already exists",
    });
  }

  room = await dbService.create({
    model: chatRoomModel,
    data: {
      name: "Organization Chat",
      type: chatRoomTypes.organization,
      organizationId,
      members: memberIds,
      admins: memberIds,
      createdBy: userId,
      isPrivate: false,
    },
  });

  const populated = await chatRoomModel
    .findById(room._id)
    .populate("members", "username email image")
    .lean();

  // ✅ NEW Feature 5
  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Organization chat created" },
    201,
  );
});

/* ============================================================
   POST /chat/rooms/group
============================================================ */
export const createGroup = asyncHandler(async (req, res, next) => {
  const { name, description, organizationId, memberIds } = req.body;
  const userId = req.user._id;

  const member = await requireOrgMember(organizationId, userId);
  if (!["owner", "admin"].includes(member.role)) {
    return next(
      new Error("Only organization owner or admin can create group chats", {
        cause: 403,
      }),
    );
  }

  const allMemberIds = [...new Set([userId.toString(), ...memberIds])];
  const validMembers = await memberModel
    .find({ organizationId, userId: { $in: allMemberIds }, isActive: true })
    .select("userId");

  if (validMembers.length !== allMemberIds.length) {
    return next(
      new Error("One or more members are not part of the organization", {
        cause: 400,
      }),
    );
  }

  const room = await dbService.create({
    model: chatRoomModel,
    data: {
      name,
      description: description || null,
      type: chatRoomTypes.group,
      organizationId,
      members: allMemberIds,
      admins: [userId],
      createdBy: userId,
      isPrivate: true,
    },
  });

  const populated = await chatRoomModel
    .findById(room._id)
    .populate("members", "username email image")
    .lean();

  // ✅ NEW Feature 5
  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Group chat created" },
    201,
  );
});

/* ============================================================
   GET /chat/rooms — List rooms
============================================================ */
export const listChatRooms = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { organizationId, type, page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const filter = { members: userId, isDeleted: false };
  if (organizationId) filter.organizationId = organizationId;
  if (type) filter.type = type;

  const [rooms, total] = await Promise.all([
    chatRoomModel
      .find(filter)
      .populate("members", "username email image")
      .populate("admins", "username email image")
      .populate({
        path: "lastMessage",
        select: "content messageType senderId createdAt",
        populate: { path: "senderId", select: "username image" },
      })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    chatRoomModel.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: { rooms, total, page: parseInt(page), limit: parseInt(limit) },
  });
});

/* ============================================================
   GET /chat/rooms/:roomId
============================================================ */
export const getChatRoom = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;

  const room = await chatRoomModel
    .findOne({ _id: roomId, members: userId, isDeleted: false })
    .populate("members", "username email image")
    .populate("admins", "username email image")
    .populate("createdBy", "username email image")
    .populate({
      path: "lastMessage",
      select: "content messageType senderId createdAt",
      populate: { path: "senderId", select: "username image" },
    });

  if (!room)
    return next(new Error("Room not found or access denied", { cause: 404 }));

  return successResponse({ res, data: { room } });
});

/* ============================================================
   PATCH /chat/rooms/:roomId
============================================================ */
export const updateRoom = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;
  const { name, description, isPrivate } = req.body;

  const room = await requireRoomMember(roomId, userId);
  await requireRoomAdmin(room, userId);

  if (room.type === chatRoomTypes.direct) {
    return next(
      new Error("Cannot update a direct message room", { cause: 400 }),
    );
  }

  const update = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (isPrivate !== undefined) update.isPrivate = isPrivate;

  const updated = await dbService.findOneAndUpdate({
    model: chatRoomModel,
    filter: { _id: roomId },
    data: update,
    options: { new: true },
  });

  return successResponse({
    res,
    data: { room: updated },
    message: "Room updated",
  });
});

/* ============================================================
   POST /chat/rooms/:roomId/join
============================================================ */
export const joinChannel = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;

  const room = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: roomId, isDeleted: false },
  });
  if (!room) return next(new Error("Room not found", { cause: 404 }));

  if (room.type !== chatRoomTypes.channel) {
    return next(
      new Error("Can only join channels. Use invite for groups.", {
        cause: 400,
      }),
    );
  }
  if (room.isPrivate) {
    return next(
      new Error("This channel is private. Request an invite.", { cause: 403 }),
    );
  }

  const alreadyMember = room.members.some(
    (m) => m.toString() === userId.toString(),
  );
  if (alreadyMember) {
    return successResponse({
      res,
      message: "Already a member",
      data: { room },
    });
  }

  if (room.organizationId) {
    await requireOrgMember(room.organizationId, userId);
  }

  const updated = await dbService.findOneAndUpdate({
    model: chatRoomModel,
    filter: { _id: roomId },
    data: { $addToSet: { members: userId } },
    options: { new: true },
  });

  return successResponse({
    res,
    data: { room: updated },
    message: "Joined channel",
  });
});

/* ============================================================
   DELETE /chat/rooms/:roomId/leave
============================================================ */
export const leaveRoom = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;

  const room = await requireRoomMember(roomId, userId);

  if (room.type === chatRoomTypes.direct) {
    return next(new Error("Cannot leave a direct message", { cause: 400 }));
  }

  const isAdmin = room.admins.some((a) => a.toString() === userId.toString());
  const update = { $pull: { members: userId, admins: userId } };

  if (isAdmin && room.admins.length === 1 && room.members.length > 1) {
    const nextAdmin = room.members.find(
      (m) => m.toString() !== userId.toString(),
    );
    if (nextAdmin) {
      await dbService.findOneAndUpdate({
        model: chatRoomModel,
        filter: { _id: roomId },
        data: { $addToSet: { admins: nextAdmin } },
        options: { new: false },
      });
    }
  }

  await dbService.findOneAndUpdate({
    model: chatRoomModel,
    filter: { _id: roomId },
    data: update,
    options: { new: true },
  });

  return successResponse({ res, message: "Left room successfully" });
});

/* ============================================================
   POST /chat/rooms/:roomId/members/:memberId
============================================================ */
export const addMember = asyncHandler(async (req, res, next) => {
  const { roomId, memberId } = req.params;
  const userId = req.user._id;

  const room = await requireRoomMember(roomId, userId);
  await requireRoomAdmin(room, userId);

  if (room.type === chatRoomTypes.direct) {
    return next(
      new Error("Cannot add members to a direct message", { cause: 400 }),
    );
  }

  const newMember = await dbService.findOne({
    model: userModel,
    filter: { _id: memberId, isDeleted: false },
  });
  if (!newMember) return next(new Error("User not found", { cause: 404 }));

  if (room.organizationId) {
    await requireOrgMember(room.organizationId, memberId);
  }

  const updated = await dbService.findOneAndUpdate({
    model: chatRoomModel,
    filter: { _id: roomId },
    data: { $addToSet: { members: memberId } },
    options: { new: true },
    populate: [{ path: "members", select: "username email image" }],
  });

  return successResponse({
    res,
    data: { room: updated },
    message: "Member added",
  });
});

/* ============================================================
   DELETE /chat/rooms/:roomId/members/:memberId
============================================================ */
export const removeMember = asyncHandler(async (req, res, next) => {
  const { roomId, memberId } = req.params;
  const userId = req.user._id;

  const room = await requireRoomMember(roomId, userId);
  await requireRoomAdmin(room, userId);

  if (room.type === chatRoomTypes.direct) {
    return next(
      new Error("Cannot remove members from a direct message", { cause: 400 }),
    );
  }

  if (memberId === userId.toString()) {
    return next(
      new Error("Use the leave endpoint to remove yourself", { cause: 400 }),
    );
  }

  await dbService.findOneAndUpdate({
    model: chatRoomModel,
    filter: { _id: roomId },
    data: { $pull: { members: memberId, admins: memberId } },
    options: { new: true },
  });

  return successResponse({ res, message: "Member removed" });
});

/* ============================================================
   DELETE /chat/rooms/:roomId
============================================================ */
export const deleteRoom = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;

  const room = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: roomId, isDeleted: false },
  });
  if (!room) return next(new Error("Room not found", { cause: 404 }));

  if (room.createdBy.toString() !== userId.toString()) {
    return next(
      new Error("Only the room creator can delete this room", { cause: 403 }),
    );
  }

  await dbService.updateOne({
    model: chatRoomModel,
    filter: { _id: roomId },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  return successResponse({ res, message: "Room deleted" });
});
