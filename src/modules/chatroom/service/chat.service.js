import { asyncHandler } from "../../../utils/response/error.response.js";
import * as dbService from "../../../DB/db.service.js";
import { successResponse } from "../../../utils/response/success.response.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import messageModel from "../../../DB/Model/message.model.js";
import fileModel from "../../../DB/Model/file.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import projectModel from "../../../DB/Model/project.model.js";
import userModel from "../../../DB/Model/user.model.js";
import { Types } from "mongoose";
const requireOrgMember = async (orgId, userId) => {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member)
    throw new Error("Not a member of this organization", { cause: 403 });
  return member;
};

export const createChatRoom = asyncHandler(async (req, res, next) => {
  const { type, name, projectId, members, orgId } = req.body;
  await requireOrgMember(orgId, req.user._id);

  if (type === "private") {
    const existing = await dbService.findOne({
      model: chatRoomModel,
      filter: {
        type: "private",
        members: { $all: [req.user._id, members[0]] },
        organization: orgId,
      },
    });
    if (existing) return successResponse({ res, data: { chatRoom: existing } });
  }

  const chatRoomData = {
    type,
    organization: orgId,
    members: [req.user._id, ...members],
  };
  if (type === "group") chatRoomData.name = name;
  if (type === "project") {
    const project = await dbService.findOne({
      model: projectModel,
      filter: { _id: projectId, team: { $in: req.user.teams } },
    });
    if (!project)
      return next(
        new Error("Project not found or access denied", { cause: 404 }),
      );
    chatRoomData.project = projectId;
    chatRoomData.name = project.title;
  }

  const chatRoom = await dbService.create({
    model: chatRoomModel,
    data: chatRoomData,
  });
  return successResponse({ res, data: { chatRoom } });
});

export const getChatRooms = asyncHandler(async (req, res, next) => {
  const { orgId, type, page = 1, limit = 20 } = req.query;
  await requireOrgMember(orgId, req.user._id);

  const filter = { members: req.user._id, organization: orgId };
  if (type) filter.type = type;

  const chatRooms = await dbService.find({
    model: chatRoomModel,
    filter,
    populate: [
      { path: "members", select: "username image" },
      { path: "lastMessage", populate: { path: "sender", select: "username" } },
      { path: "project", select: "title" },
    ],
    skip: (page - 1) * limit,
    limit,
    sort: { updatedAt: -1 },
  });

  return successResponse({ res, data: { chatRooms } });
});

export const sendMessage = asyncHandler(async (req, res, next) => {
  console.log("Updated sendMessage running");
  const { chatRoomId, content, replyTo, mentions } = req.body;

  const chatRoom = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: chatRoomId, members: req.user._id },
  });
  if (!chatRoom) return next(new Error("Chat room not found", { cause: 404 }));

  const parsedMentions =
    mentions || content.match(/@(\w+)/g)?.map((m) => m.slice(1)) || [];
  const mentionUsers = await dbService.find({
    model: userModel,
    filter: {
      username: { $in: parsedMentions },
      teams: { $in: req.user.teams },
    },
  });

  const message = await dbService.create({
    model: messageModel,
    data: {
      content,
      chatRoom: chatRoomId,
      sender: req.user._id,
      replyTo,
      mentions: mentionUsers.map((u) => u._id),
    },
  });

  // Temporary: Just update lastMessage (remove unreadCounts for now)
  await chatRoomModel.updateOne(
    { _id: chatRoomId },
    { $set: { lastMessage: message._id } },
  );

  return successResponse({ res, data: { message } });
});
export const editMessage = asyncHandler(async (req, res, next) => {
  const { messageId, content } = req.body;
  const message = await dbService.findOne({
    model: messageModel,
    filter: { _id: messageId, sender: req.user._id },
  });

  if (!message)
    return next(new Error("Message not found or not yours", { cause: 404 }));

  if (Date.now() - message.createdAt > 3600000)
    return next(new Error("Cannot edit after 1 hour", { cause: 400 }));

  await dbService.updateOne({
    model: messageModel,
    filter: { _id: new Types.ObjectId(messageId) },
    data: { $set: { content, editedAt: new Date() } },
  });

  return successResponse({
    res,
    data: { message: { ...message.toObject(), content, editedAt: new Date() } },
  });
});

export const deleteMessage = asyncHandler(async (req, res, next) => {
  const { messageId } = req.body;
  const message = await dbService.findOne({
    model: messageModel,
    filter: { _id: messageId, sender: req.user._id },
  });
  if (!message)
    return next(new Error("Message not found or not yours", { cause: 404 }));

  console.log("Deleting message", messageId);
  if (Date.now() - message.createdAt.getTime() > 3600000)
    return next(new Error("Cannot delete after 1 hour", { cause: 400 }));

  await dbService.updateOne({
    model: messageModel,
    filter: { _id: messageId },
    data: { $set: { deleted: true } },
  });
  console.log("Message deleted");
  return successResponse({ res, message: "Message deleted" });
});

export const pinMessage = asyncHandler(async (req, res, next) => {
  const { messageId, pin } = req.body;

  const message = await dbService.findOne({
    model: messageModel,
    filter: { _id: messageId },
  });
  if (!message) return next(new Error("Message not found", { cause: 404 }));

  const chatRoom = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: message.chatRoom, members: req.user._id },
  });
  if (!chatRoom)
    return next(
      new Error("Chat room not found or access denied", { cause: 404 }),
    );

  await dbService.updateOne({
    model: chatRoomModel,
    filter: { _id: chatRoom._id },
    data: pin
      ? { $addToSet: { pinnedMessages: new Types.ObjectId(messageId) } } // أضف ObjectId
      : { $pull: { pinnedMessages: new Types.ObjectId(messageId) } },
  });

  return successResponse({
    res,
    message: pin ? "Message pinned" : "Message unpinned",
  });
});
export const getMessages = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;
  const { chatRoomId } = req.params;
  const chatRoom = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: chatRoomId, members: req.user._id },
  });
  if (!chatRoom) return next(new Error("Chat room not found", { cause: 404 }));

  const messages = await dbService.find({
    model: messageModel,
    filter: { chatRoom: chatRoomId, deleted: { $ne: true } },
    populate: [
      { path: "sender", select: "username image" },
      { path: "attachments" },
      { path: "replyTo", populate: { path: "sender", select: "username" } },
    ],
    skip: (page - 1) * limit,
    limit,
    sort: { createdAt: -1 },
  });
  console.log("Messages found:", messages.length); // للتحقق
  return successResponse({ res, data: { messages } });
});

export const markAsSeen = asyncHandler(async (req, res, next) => {
  const { chatRoomId } = req.params;
  await dbService.updateMany({
    model: messageModel,
    filter: { chatRoom: chatRoomId, sender: { $ne: req.user._id } },
    data: {
      status: "seen",
      $addToSet: { seenBy: { user: req.user._id, seenAt: new Date() } },
    },
  });

  await chatRoomModel.updateOne(
    { _id: chatRoomId },
    { $set: { "unreadCounts.$[elem].count": 0 } },
    { arrayFilters: [{ "elem.user": req.user._id }] },
  );

  return successResponse({ res, message: "Messages marked as seen" });
});

export const addReaction = asyncHandler(async (req, res, next) => {
  const { messageId, emoji } = req.body;
  const message = await dbService.findOne({
    model: messageModel,
    filter: { _id: messageId, chatRoom: { $in: req.user.chatRooms } },
  });
  if (!message) return next(new Error("Message not found", { cause: 404 }));

  const reaction = message.reactions.find((r) => r.emoji === emoji);
  if (reaction) {
    if (reaction.users.includes(req.user._id)) {
      reaction.users.pull(req.user._id);
    } else {
      reaction.users.push(req.user._id);
    }
  } else {
    message.reactions.push({ emoji, users: [req.user._id] });
  }

  await message.save();
  return successResponse({ res, data: { message } });
});

export const searchMessages = asyncHandler(async (req, res, next) => {
  const { chatRoomId, query, page = 1, limit = 20 } = req.query;
  const chatRoom = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: chatRoomId, members: req.user._id },
  });
  if (!chatRoom) return next(new Error("Chat room not found", { cause: 404 }));

  const messages = await dbService.find({
    model: messageModel,
    filter: { chatRoom: chatRoomId, content: { $regex: query, $options: "i" } },
    skip: (page - 1) * limit,
    limit,
    sort: { createdAt: -1 },
  });

  return successResponse({ res, data: { messages } });
});
