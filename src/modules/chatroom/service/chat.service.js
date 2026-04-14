import chatRoomModel, {
  chatRoomTypes,
} from "../../../DB/Model/chatroom.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import userModel from "../../../DB/Model/user.model.js";
import teamModel from "../../../DB/Model/team.model.js";
import projectModel from "../../../DB/Model/project.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { getChatNamespace } from "../../socket/socket.controller.js";
import messageModel from "../../../DB/Model/message.model.js";
import reactionModel from "../../../DB/Model/reaction.model.js";
import *  as dbService from "../../../DB/db.service.js"; 
// ─────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────

async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: {
      organizationId: orgId,
      userId,
      isActive: true,
    },
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
    filter: {
      _id: roomId,
      members: userId,
      isDeleted: false,
    },
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

// FIX: helper to find a shared org between two users
async function findSharedOrg(userIdA, userIdB) {
  const orgsA = await dbService.find({
    model: memberModel,
    filter: {
      userId: userIdA,
      isActive: true
    },
    select: "organizationId"
  });
  const orgIdsA = new Set(orgsA.map((m) => m.organizationId.toString()));

  const orgsB = await dbService.find({
    model: memberModel,
    filter: {
      userId: userIdB,
      isActive: true
    },
    select: "organizationId"
  });

  for (const m of orgsB) {
    if (orgIdsA.has(m.organizationId.toString())) {
      return m.organizationId;
    }
  }
  return null;
}

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

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/direct
// FIX: now verifies both users share an org and stores organizationId
// ─────────────────────────────────────────────────────────────

export const createDirect = asyncHandler(async (req, res, next) => {
  const senderId = req.user._id;
  const { targetUserId } = req.body;

  if (senderId.toString() === targetUserId) {
    return next(new Error("Cannot create a DM with yourself", { cause: 400 }));
  }

  const target = await dbService.findOne({
    model: userModel,
    filter: {
      _id: targetUserId,
      isDeleted: false
    },
    select: "_id username"
  });
  if (!target) return next(new Error("Target user not found", { cause: 404 }));

  // FIX: verify both users share at least one organization
  const sharedOrgId = await findSharedOrg(senderId, targetUserId);
  if (!sharedOrgId) {
    return next(
      new Error(
        "Cannot create a DM — you don't share an organization with this user",
        { cause: 403 },
      ),
    );
  }

  // check for existing DM within same org
  const existing = await dbService.findOne({
    model: chatRoomModel,
    filter: {
      type: chatRoomTypes.direct,
      organizationId: sharedOrgId,
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
      organizationId: sharedOrgId, // FIX: DMs now scoped to an org
      members: [senderId, targetUserId],
      admins: [senderId],
      createdBy: senderId,
      isPrivate: true,
    }
  });

  const populated = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: room._id },
    populate: {
      path: "members",
      select: "username email image"
    },
    lean: true
  });

  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Direct message created" },
    201,
  );
});

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/channel
// ─────────────────────────────────────────────────────────────

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

  // FIX: when teamId is provided, resolve the org from the team
  let resolvedOrgId = organizationId || null;

  if (teamId) {
    const team = await dbService.findOne({
      model: teamModel,
      filter: {
        _id: teamId,
        members: userId,
        isDeleted: false,
      }
    });
    if (!team)
      return next(
        new Error("Team not found or you are not a member", { cause: 404 }),
      );

    // FIX: use the team's organizationId
    if (!resolvedOrgId) resolvedOrgId = team.organizationId;
  }

  if (projectId) {
    const project = await dbService.findOne({
      model: projectModel,
      filter: {
        _id: projectId,
        isDeleted: false
      },
      select: "manager organizationId"
    });
    if (!project) return next(new Error("Project not found", { cause: 404 }));

    const isProjectManager = project.manager.toString() === userId.toString();
    let isOrgAdmin = false;
    if (project.organizationId) {
      const mem = await dbService.findOne({
        model: memberModel,
        filter: {
          organizationId: project.organizationId,
          userId,
          isActive: true,
        }
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

    if (!resolvedOrgId) resolvedOrgId = project.organizationId;
  }
   const existingChannel = await dbService.findOne({
     model: chatRoomModel,
     filter: {
       name,
       organizationId: resolvedOrgId,
       teamId: teamId || null,
       projectId: projectId || null,
       type: chatRoomTypes.channel,
       isDeleted: false,
     },
   });
  if (existingChannel) {
    return  next( new Error("A channel with the same name already exists in this scope", { cause: 409 }) );

  }
  const room = await dbService.create({
    model: chatRoomModel,
    data: {
      name,
      description: description || null,
      type: chatRoomTypes.channel,
      organizationId: resolvedOrgId,
      teamId: teamId || null,
      projectId: projectId || null,
      members: [userId],
      admins: [userId],
      createdBy: userId,
      isPrivate: isPrivate ?? false,
    }
  });

  const populated = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: room._id },
    populate: {
      path: "members",
      select: "username email image"
    },
    lean: true
  });

  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Channel created" },
    201,
  );
});

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/team
// ─────────────────────────────────────────────────────────────

export const createTeamChat = asyncHandler(async (req, res, next) => {
  const { teamId } = req.body;
  const userId = req.user._id;

  const team = await dbService.findOne({
    model: teamModel,
    filter: {
      _id: teamId,
      members: userId,
      isDeleted: false
    },
    select: "members name organizationId"
  });
  if (!team)
    return next(
      new Error("Team not found or you are not a member", { cause: 404 }),
    );

  let room = await dbService.findOne({
    model: chatRoomModel,
    filter: {
      type: chatRoomTypes.team,
      teamId,
      isDeleted: false,
    }
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
      organizationId: team.organizationId, // FIX: use team's org
      teamId,
      members: team.members,
      admins: team.members,
      createdBy: userId,
      isPrivate: false,
    }
  });

  const populated = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: room._id },
    populate: {
      path: "members",
      select: "username email image"
    },
    lean: true
  });

  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Team chat created" },
    201,
  );
});

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/organization
// ─────────────────────────────────────────────────────────────

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

  let room = await dbService.findOne({
    model: chatRoomModel,
    filter: {
      type: chatRoomTypes.organization,
      organizationId,
      isDeleted: false,
    }
  });

  if (room) {
    return successResponse({
      res,
      data: { room },
      message: "Organization chat already exists",
    });
  }

  const orgMembers = await dbService.find({
    model: memberModel,
    filter: { organizationId, isActive: true },
    select: "userId"
  });
  const memberIds = orgMembers.map((m) => m.userId);

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
    }
  });

  const populated = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: room._id },
    populate: {
      path: "members",
      select: "username email image"
    },
    lean: true
  });

  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Organization chat created" },
    201,
  );
});

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/group
// ─────────────────────────────────────────────────────────────

export const createGroup = asyncHandler(async (req, res, next) => {
  const { name, description, organizationId, memberIds } = req.body;
  const userId = req.user._id;

  // FIX: allow any org member to create group chats (not just admin/owner)
  await requireOrgMember(organizationId, userId);

  const allMemberIds = [...new Set([userId.toString(), ...memberIds])];

  const validMembers = await dbService.find({
    model: memberModel,
    filter: {
      organizationId,
      userId: { $in: allMemberIds },
      isActive: true,
    },
    select: "userId",
    lean: true  
  });

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
    }
  });

  const populated = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: room._id },
    populate: {
      path: "members",
      select: "username email image"
    },
    lean: true
  });

  broadcastRoomCreated(populated);

  return successResponse(
    { res, data: { room: populated }, message: "Group chat created" },
    201,
  );
});

// GET /chat/rooms  — UPDATED: embeds unread counts per room
// ─────────────────────────────────────────────────────────────
 
export const listChatRooms = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { organizationId, type } = req.query;
 
  const { page, limit, skip } = getPagination(req.query);
 
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
      .limit(limit)
      .lean(),
    chatRoomModel.countDocuments(filter),
  ]);
 
  // ── Compute unread counts for all returned rooms in one query ──
  const roomIds = rooms.map((r) => r._id);
 
  const unreadAgg = await messageModel.aggregate([
    {
      $match: {
        chatRoomId: { $in: roomIds },
        deletedForEveryone: false,
        deletedFor: { $ne: userId },
        senderId: { $ne: userId },
        "seenBy.userId": { $ne: userId },
      },
    },
    {
      $group: {
        _id: "$chatRoomId",
        count: { $sum: 1 },
      },
    },
  ]);
 
  const unreadMap = new Map(
    unreadAgg.map((item) => [item._id.toString(), item.count]),
  );
 
  // ── Embed unreadCount into each room object ──
  const roomsWithUnread = rooms.map((room) => ({
    ...room,
    unreadCount: unreadMap.get(room._id.toString()) || 0,
  }));
 
  const totalUnread = unreadAgg.reduce((sum, item) => sum + item.count, 0);
 
  return successResponse({
    res,
    data: { rooms: roomsWithUnread, total, totalUnread, page, limit },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId
// ─────────────────────────────────────────────────────────────

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
      populate: { path: "senderId", select: "username image" }, // ✅ nested inside lastMessage
    });

  if (!room)
    return next(new Error("Room not found or access denied", { cause: 404 }));

  return successResponse({ res, data: { room } });
});
// ─────────────────────────────────────────────────────────────
// PATCH /chat/rooms/:roomId
// ─────────────────────────────────────────────────────────────

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
    data:update,
    options: { new: true },
});

  return successResponse({
    res,
    data: { room: updated },
    message: "Room updated",
  });
});

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/join
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// DELETE /chat/rooms/:roomId/leave
// ─────────────────────────────────────────────────────────────

export const leaveRoom = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;

  const room = await requireRoomMember(roomId, userId);

  if (room.type === chatRoomTypes.direct) {
    return next(new Error("Cannot leave a direct message", { cause: 400 }));
  }

  const isAdmin = room.admins.some((a) => a.toString() === userId.toString());

  if (isAdmin && room.admins.length === 1 && room.members.length > 1) {
    const nextAdmin = room.members.find(
      (m) => m.toString() !== userId.toString(),
    );
    if (nextAdmin) {
      await dbService.findOneAndUpdate({
        model: chatRoomModel,
        filter: { _id: roomId },
        data: { $addToSet: { admins: nextAdmin } },
      });
    }
  }

  await dbService.findOneAndUpdate({
    model: chatRoomModel,
    filter: { _id: roomId },
    data: { $pull: { members: userId, admins: userId } },
    options: { new: true },
  });

  return successResponse({ res, message: "Left room successfully" });
});

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/members/:memberId
// ─────────────────────────────────────────────────────────────

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

  // ✅ FIX: use dbService.findOneAndUpdate with populate param
  //    instead of chaining .populate() on the result
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
// ─────────────────────────────────────────────────────────────
// DELETE /chat/rooms/:roomId/members/:memberId
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// DELETE /chat/rooms/:roomId
// ─────────────────────────────────────────────────────────────

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
