import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import userModel from "../../../DB/Model/user.model.js";
import teamModel from "../../../DB/Model/team.model.js";
import projectModel from "../../../DB/Model/project.model.js";
import { isUserOnline } from "../../message/service/store/onlineUsers.store.js";

/**
 * Join all rooms the user belongs to on connection
 */
export const joinUserRooms = async (socket) => {
  const rooms = await chatRoomModel.find({ members: socket.userId });
  for (const room of rooms) {
    socket.join(`room:${room._id}`);
  }
};

/**
 * Create a private chat between 2 users
 */
export const createPrivateChat = (io, socket) => {
  socket.on("chat:createPrivate", async ({ targetUserId }) => {
    try {
      const userId = socket.userId;

      if (userId === targetUserId) {
        return socket.emit("socket_error", {
          message: "Cannot create chat with yourself",
          status: 400,
        });
      }

      // Check if private chat already exists between these two users
      let room = await chatRoomModel.findOne({
        type: "private",
        members: { $all: [userId, targetUserId], $size: 2 },
      });

      if (!room) {
        // Verify target user exists
        const targetUser = await userModel.findById(targetUserId);
        if (!targetUser || !targetUser.isActive || targetUser.isDeleted) {
          return socket.emit("socket_error", {
            message: "User not found",
            status: 404,
          });
        }

        room = await chatRoomModel.create({
          type: "private",
          members: [userId, targetUserId],
          unreadCounts: [
            { user: userId, count: 0 },
            { user: targetUserId, count: 0 },
          ],
        });
      }

      // Join socket to this room
      socket.join(`room:${room._id}`);

      // If target user is online, add them to the room too
      const targetSockets = io.sockets.sockets;
      targetSockets.forEach((s) => {
        if (s.userId === targetUserId) {
          s.join(`room:${room._id}`);
        }
      });

      const populated = await chatRoomModel
        .findById(room._id)
        .populate("members", "username image isActive")
        .populate("lastMessage");

      socket.emit("chat:created", { room: populated });
    } catch (error) {
      console.error("createPrivateChat error:", error);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};

/**
 * Create a group chat
 */
export const createGroupChat = (io, socket) => {
  socket.on("chat:createGroup", async ({ name, memberIds }) => {
    try {
      const userId = socket.userId;

      if (!name || !memberIds || !Array.isArray(memberIds)) {
        return socket.emit("socket_error", {
          message: "Name and members are required",
          status: 400,
        });
      }

      // Ensure creator is in members
      const allMembers = [...new Set([userId, ...memberIds])];

      // Validate all members exist
      const users = await userModel.find({
        _id: { $in: allMembers },
        isActive: true,
        isDeleted: false,
      });

      if (users.length !== allMembers.length) {
        return socket.emit("socket_error", {
          message: "Some users not found",
          status: 404,
        });
      }

      const unreadCounts = allMembers.map((memberId) => ({
        user: memberId,
        count: 0,
      }));

      const room = await chatRoomModel.create({
        name,
        type: "group",
        members: allMembers,
        unreadCounts,
      });

      // Join all online members to this room
      io.sockets.sockets.forEach((s) => {
        if (allMembers.includes(s.userId)) {
          s.join(`room:${room._id}`);
        }
      });

      const populated = await chatRoomModel
        .findById(room._id)
        .populate("members", "username image isActive");

      // Notify all members
      io.to(`room:${room._id}`).emit("chat:groupCreated", { room: populated });
    } catch (error) {
      console.error("createGroupChat error:", error);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};

/**
 * Create a project chat (auto-includes all project members)
 */
export const createProjectChat = (io, socket) => {
  socket.on("chat:createProject", async ({ projectId }) => {
    try {
      const userId = socket.userId;

      const project = await projectModel
        .findById(projectId)
        .populate("members");

      if (!project) {
        return socket.emit("socket_error", {
          message: "Project not found",
          status: 404,
        });
      }

      // Check user is part of project
      const isMember =
        project.members.some((m) => m._id.toString() === userId) ||
        project.manager.toString() === userId;

      if (!isMember) {
        return socket.emit("socket_error", {
          message: "You are not part of this project",
          status: 403,
        });
      }

      // Check if project chat already exists
      let room = await chatRoomModel.findOne({
        type: "project",
        project: projectId,
      });

      if (!room) {
        const allMembers = [
          ...new Set([
            project.manager.toString(),
            ...project.members.map((m) => m._id.toString()),
          ]),
        ];

        const unreadCounts = allMembers.map((memberId) => ({
          user: memberId,
          count: 0,
        }));

        room = await chatRoomModel.create({
          name: `${project.title} - Chat`,
          type: "project",
          project: projectId,
          members: allMembers,
          unreadCounts,
        });
      }

      // Join all online project members
      io.sockets.sockets.forEach((s) => {
        if (room.members.map((m) => m.toString()).includes(s.userId)) {
          s.join(`room:${room._id}`);
        }
      });

      const populated = await chatRoomModel
        .findById(room._id)
        .populate("members", "username image isActive")
        .populate("project", "title status");

      socket.emit("chat:projectCreated", { room: populated });
    } catch (error) {
      console.error("createProjectChat error:", error);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};

/**
 * Get all chats for current user
 */
export const getUserChats = (io, socket) => {
  socket.on("chat:getAll", async () => {
    try {
      const userId = socket.userId;

      const rooms = await chatRoomModel
        .find({ members: userId })
        .populate("members", "username image isActive")
        .populate("lastMessage")
        .populate({
          path: "lastMessage",
          populate: { path: "sender", select: "username image" },
        })
        .populate("project", "title status")
        .sort({ updatedAt: -1 });

      // Add online status and unread count for each room
      const enriched = rooms.map((room) => {
        const roomObj = room.toObject();

        // Add isOnline flag for private chats
        if (room.type === "private") {
          const otherMember = room.members.find(
            (m) => m._id.toString() !== userId,
          );
          if (otherMember) {
            roomObj.otherMember = {
              ...(otherMember.toObject?.() || otherMember),
              isOnline: isUserOnline(otherMember._id.toString()),
            };
          }
        }

        // Get unread count for current user
        const unreadEntry = room.unreadCounts.find(
          (u) => u.user.toString() === userId,
        );
        roomObj.myUnreadCount = unreadEntry ? unreadEntry.count : 0;

        return roomObj;
      });

      socket.emit("chat:all", { rooms: enriched });
    } catch (error) {
      console.error("getUserChats error:", error);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};
