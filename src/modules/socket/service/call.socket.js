import mongoose from "mongoose";
import callModel, { callTypes, callStatus } from "../../../DB/Model/call.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import messageModel from "../../../DB/Model/message.model.js";
import { authentication } from "../../../middleware/socket/auth.middleware.js";
import { childLogger } from "../../../utils/logger/logger.js";

const log = childLogger("call-socket");

/**
 * WebRTC Signaling Flow:
 *
 *  1. Caller emits  call:initiate  → server creates Call doc, rings all targets
 *  2. Callee emits  call:accept    → server marks them "in-call", tells caller to start offer
 *  3. Caller sends  call:offer     → server relays SDP offer to callee
 *  4. Callee sends  call:answer    → server relays SDP answer to caller
 *  5. Both exchange call:ice-candidate → server relays ICE candidates
 *  6. Either emits  call:end       → server cleans up, notifies everyone
 *
 *  For group calls (3+ people) a mesh is used: each new joiner exchanges
 *  offer/answer with every existing participant.
 */

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const RING_TIMEOUT_MS = 45_000; // auto-miss after 45s
const ringTimers = new Map(); // callId → setTimeout handle

const EVENTS = {
  // outgoing (server → client)
  CALL_INCOMING: "call:incoming",
  CALL_ACCEPTED: "call:accepted",
  CALL_REJECTED: "call:rejected",
  CALL_ENDED: "call:ended",
  CALL_USER_JOINED: "call:user-joined",
  CALL_USER_LEFT: "call:user-left",
  CALL_MISSED: "call:missed",
  CALL_BUSY: "call:busy",
  CALL_ERROR: "call:error",

  // WebRTC relay
  CALL_OFFER: "call:offer",
  CALL_ANSWER: "call:answer",
  CALL_ICE_CANDIDATE: "call:ice-candidate",

  // media toggles
  CALL_TOGGLE_AUDIO: "call:toggle-audio",
  CALL_TOGGLE_VIDEO: "call:toggle-video",
  CALL_MEDIA_STATE: "call:media-state",

  // Teams-style raise hand
  CALL_RAISE_HAND: "call:raise-hand",     // client → server
  CALL_LOWER_HAND: "call:lower-hand",     // client → server
  CALL_HAND_RAISED: "call:hand-raised",   // server → room
  CALL_HAND_LOWERED: "call:hand-lowered", // server → room

  // In-call mention (Teams "@person can you elaborate?")
  CALL_MENTION: "call:mention",           // client → server
  CALL_MENTIONED: "call:mentioned",       // server → mentioned user

  // In-call chat (private to the meeting, separate from room chat)
  CALL_CHAT_SEND: "call:chat:send",       // client → server
  CALL_CHAT_MESSAGE: "call:chat:message", // server → room

  // incoming (client → server)
  CALL_INITIATE: "call:initiate",
  CALL_ACCEPT: "call:accept",
  CALL_REJECT: "call:reject",
  CALL_END: "call:end",
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function emitError(socket, message, code = 400) {
  socket.emit(EVENTS.CALL_ERROR, { message, code });
}

async function isRoomMember(roomId, userId) {
  if (!mongoose.Types.ObjectId.isValid(roomId)) return false;
  return !!(await chatRoomModel
    .findOne({ _id: roomId, members: userId, isDeleted: false })
    .select("_id")
    .lean());
}

function clearRingTimer(callId) {
  const timer = ringTimers.get(callId);
  if (timer) {
    clearTimeout(timer);
    ringTimers.delete(callId);
  }
}

/**
 * Insert a system message into the chat room so call events
 * appear in the message timeline (like WhatsApp/Teams).
 */
async function insertCallSystemMessage(chatRoomId, senderId, content) {
  try {
    const msg = await messageModel.create({
      chatRoomId,
      senderId,
      content,
      messageType: "system",
    });
    await chatRoomModel.updateOne(
      { _id: chatRoomId },
      { lastMessage: msg._id, lastMessageAt: new Date() },
    );
    return msg;
  } catch (err) {
    log.error({ err, chatRoomId }, "system message insert failed");
  }
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─────────────────────────────────────────────────────────────
// registerCallSocket
// ─────────────────────────────────────────────────────────────

export const registerCallSocket = (namespace) => {
  // ── Auth middleware (same as chat) ──────────────────────────
  namespace.use(async (socket, next) => {
    const { data, valid } = await authentication({ socket });
    if (!valid) return next(new Error(data?.message || "Unauthorized"));
    socket.user = data.user;
    return next();
  });

  namespace.on("connection", (socket) => {
    const user = socket.user;
    const userId = user._id.toString();

    // join personal room for call notifications
    socket.join(`user_${userId}`);

    // ── INITIATE ───────────────────────────────────────────
    socket.on(
      EVENTS.CALL_INITIATE,
      async ({ roomId, type = "voice" }) => {
        try {
          if (!roomId)
            return emitError(socket, "roomId is required");
          if (!Object.values(callTypes).includes(type))
            return emitError(socket, "Invalid call type. Use 'voice' or 'video'");

          const isMember = await isRoomMember(roomId, userId);
          if (!isMember) return emitError(socket, "Access denied", 403);

          // check no active call in this room
          const existingCall = await callModel.findOne({
            chatRoomId: roomId,
            status: { $in: [callStatus.RINGING, callStatus.ACTIVE] },
          });
          if (existingCall) {
            return socket.emit(EVENTS.CALL_BUSY, {
              roomId,
              callId: existingCall._id,
              message: "There is already an active call in this room",
            });
          }

          // get room to find all members to ring
          const room = await chatRoomModel
            .findById(roomId)
            .select("members organizationId type")
            .lean();
          if (!room) return emitError(socket, "Room not found", 404);

          const targetUserIds = room.members
            .map((m) => m.toString())
            .filter((id) => id !== userId);

          if (targetUserIds.length === 0) {
            return emitError(socket, "No one else in this room to call");
          }

          // create call document
          const participants = [
            {
              userId,
              joinedAt: new Date(),
              state: "in-call",
              isCameraOff: type === "voice",
            },
            ...targetUserIds.map((id) => ({
              userId: id,
              state: "ringing",
              isCameraOff: type === "voice",
            })),
          ];

          const call = await callModel.create({
            chatRoomId: roomId,
            organizationId: room.organizationId || null,
            callerId: userId,
            type,
            status: callStatus.RINGING,
            participants,
          });

          // join socket room for this call
          socket.join(`call:${call._id}`);

          // ring all target users
          targetUserIds.forEach((targetId) => {
            namespace.to(`user_${targetId}`).emit(EVENTS.CALL_INCOMING, {
              callId: call._id,
              roomId,
              type,
              caller: {
                _id: user._id,
                username: user.username,
                image: user.image,
              },
              roomType: room.type,
              participants: participants.map((p) => ({
                userId: p.userId,
                state: p.state,
              })),
            });
          });

          // confirm to caller
          socket.emit("call:initiated", {
            callId: call._id,
            roomId,
            type,
            participants,
          });

          // auto-miss timeout
          const timer = setTimeout(async () => {
            ringTimers.delete(call._id.toString());
            const freshCall = await callModel.findById(call._id);
            if (!freshCall || freshCall.status !== callStatus.RINGING) return;

            // check if anyone accepted
            const anyAccepted = freshCall.participants.some(
              (p) => p.state === "in-call" && p.userId.toString() !== userId,
            );

            if (!anyAccepted) {
              freshCall.status = callStatus.MISSED;
              freshCall.endedAt = new Date();
              freshCall.endReason = "missed";
              freshCall.participants.forEach((p) => {
                if (p.state === "ringing") p.state = "missed";
              });
              await freshCall.save();

              namespace.to(`call:${call._id}`).emit(EVENTS.CALL_MISSED, {
                callId: call._id,
                roomId,
              });

              // also notify via personal rooms
              targetUserIds.forEach((id) => {
                namespace.to(`user_${id}`).emit(EVENTS.CALL_MISSED, {
                  callId: call._id,
                  roomId,
                });
              });

              await insertCallSystemMessage(
                roomId,
                userId,
                `📞 Missed ${type} call`,
              );
            }
          }, RING_TIMEOUT_MS);

          ringTimers.set(call._id.toString(), timer);
        } catch (err) {
          emitError(socket, err.message);
        }
      },
    );

    // ── ACCEPT ─────────────────────────────────────────────
    socket.on(EVENTS.CALL_ACCEPT, async ({ callId }) => {
      try {
        if (!callId) return emitError(socket, "callId is required");

        const call = await callModel.findById(callId);
        if (!call) return emitError(socket, "Call not found", 404);

        const participant = call.participants.find(
          (p) => p.userId.toString() === userId,
        );
        if (!participant)
          return emitError(socket, "You are not a participant in this call");

        if (participant.state === "in-call")
          return emitError(socket, "Already in this call");

        // update participant state
        participant.state = "in-call";
        participant.joinedAt = new Date();

        // if call was still ringing, mark it active
        if (call.status === callStatus.RINGING) {
          call.status = callStatus.ACTIVE;
          call.startedAt = new Date();
          clearRingTimer(callId.toString());
        }

        // track max participants
        const inCallCount = call.participants.filter(
          (p) => p.state === "in-call",
        ).length;
        if (inCallCount > call.maxParticipants) {
          call.maxParticipants = inCallCount;
        }

        await call.save();

        // join call socket room
        socket.join(`call:${callId}`);

        // get list of other users already in the call (for mesh setup)
        const otherInCall = call.participants
          .filter(
            (p) => p.state === "in-call" && p.userId.toString() !== userId,
          )
          .map((p) => p.userId.toString());

        // tell the accepter who else is in the call
        socket.emit(EVENTS.CALL_ACCEPTED, {
          callId,
          roomId: call.chatRoomId,
          type: call.type,
          peersInCall: otherInCall,
        });

        // tell everyone else that this user joined
        socket.to(`call:${callId}`).emit(EVENTS.CALL_USER_JOINED, {
          callId,
          userId,
          username: user.username,
          image: user.image,
        });
      } catch (err) {
        emitError(socket, err.message);
      }
    });

    // ── REJECT ─────────────────────────────────────────────
    socket.on(EVENTS.CALL_REJECT, async ({ callId }) => {
      try {
        if (!callId) return emitError(socket, "callId is required");

        const call = await callModel.findById(callId);
        if (!call) return emitError(socket, "Call not found", 404);

        const participant = call.participants.find(
          (p) => p.userId.toString() === userId,
        );
        if (!participant) return;

        participant.state = "rejected";

        // check if everyone rejected/missed
        const pendingOrInCall = call.participants.filter(
          (p) =>
            p.userId.toString() !== call.callerId.toString() &&
            (p.state === "ringing" || p.state === "in-call"),
        );

        if (pendingOrInCall.length === 0 && call.status === callStatus.RINGING) {
          call.status = callStatus.REJECTED;
          call.endedAt = new Date();
          call.endReason = "rejected";
          clearRingTimer(callId.toString());

          await insertCallSystemMessage(
            call.chatRoomId,
            userId,
            `📞 ${call.type === "video" ? "Video" : "Voice"} call declined`,
          );
        }

        await call.save();

        // notify the caller
        namespace
          .to(`user_${call.callerId.toString()}`)
          .emit(EVENTS.CALL_REJECTED, {
            callId,
            userId,
            username: user.username,
            allRejected: call.status === callStatus.REJECTED,
          });
      } catch (err) {
        emitError(socket, err.message);
      }
    });

    // ── WebRTC: OFFER ──────────────────────────────────────
    socket.on(
      EVENTS.CALL_OFFER,
      ({ callId, targetUserId, sdp }) => {
        if (!callId || !targetUserId || !sdp) return;
        namespace.to(`user_${targetUserId}`).emit(EVENTS.CALL_OFFER, {
          callId,
          fromUserId: userId,
          sdp,
        });
      },
    );

    // ── WebRTC: ANSWER ─────────────────────────────────────
    socket.on(
      EVENTS.CALL_ANSWER,
      ({ callId, targetUserId, sdp }) => {
        if (!callId || !targetUserId || !sdp) return;
        namespace.to(`user_${targetUserId}`).emit(EVENTS.CALL_ANSWER, {
          callId,
          fromUserId: userId,
          sdp,
        });
      },
    );

    // ── WebRTC: ICE CANDIDATE ──────────────────────────────
    socket.on(
      EVENTS.CALL_ICE_CANDIDATE,
      ({ callId, targetUserId, candidate }) => {
        if (!callId || !targetUserId || !candidate) return;
        namespace
          .to(`user_${targetUserId}`)
          .emit(EVENTS.CALL_ICE_CANDIDATE, {
            callId,
            fromUserId: userId,
            candidate,
          });
      },
    );

    // ── TOGGLE AUDIO ───────────────────────────────────────
    socket.on(
      EVENTS.CALL_TOGGLE_AUDIO,
      async ({ callId, isMuted }) => {
        try {
          if (!callId) return;

          await callModel.updateOne(
            { _id: callId, "participants.userId": userId },
            { $set: { "participants.$.isMuted": isMuted } },
          );

          socket.to(`call:${callId}`).emit(EVENTS.CALL_MEDIA_STATE, {
            callId,
            userId,
            isMuted,
          });
        } catch (err) {
          emitError(socket, err.message);
        }
      },
    );

    // ── TOGGLE VIDEO ───────────────────────────────────────
    socket.on(
      EVENTS.CALL_TOGGLE_VIDEO,
      async ({ callId, isCameraOff }) => {
        try {
          if (!callId) return;

          await callModel.updateOne(
            { _id: callId, "participants.userId": userId },
            { $set: { "participants.$.isCameraOff": isCameraOff } },
          );

          socket.to(`call:${callId}`).emit(EVENTS.CALL_MEDIA_STATE, {
            callId,
            userId,
            isCameraOff,
          });
        } catch (err) {
          emitError(socket, err.message);
        }
      },
    );

    // ── RAISE HAND ─────────────────────────────────────────
    // Teams behaviour: hand stays raised until lowered explicitly OR
    // the user is given the floor (the FE lowers it on speaker-change).
    // We dedupe so a flaky tab can't enqueue twice.
    socket.on(EVENTS.CALL_RAISE_HAND, async ({ callId }) => {
      try {
        if (!callId) return emitError(socket, "callId required");
        const call = await callModel.findById(callId);
        if (!call) return emitError(socket, "Call not found", 404);
        const inCall = call.participants.some(
          (p) =>
            p.userId.toString() === userId && p.state === "in-call",
        );
        if (!inCall) return emitError(socket, "Not in call", 403);

        // Atomic $addToSet won't help here because the embedded
        // sub-doc has a timestamp — we want one row per user only.
        const already = (call.raisedHands || []).some(
          (h) => h.userId.toString() === userId,
        );
        if (already) return;

        call.raisedHands.push({ userId, raisedAt: new Date() });
        await call.save();

        namespace.to(`call:${callId}`).emit(EVENTS.CALL_HAND_RAISED, {
          callId,
          userId,
          username: user.username,
          raisedAt: new Date(),
          queueLength: call.raisedHands.length,
        });
      } catch (err) {
        emitError(socket, err.message);
      }
    });

    socket.on(EVENTS.CALL_LOWER_HAND, async ({ callId, targetUserId }) => {
      try {
        if (!callId) return emitError(socket, "callId required");
        const call = await callModel.findById(callId);
        if (!call) return emitError(socket, "Call not found", 404);

        // Either lower YOUR own hand, or — if you're the caller —
        // lower someone else's (the speaker "calling on" them).
        const target = targetUserId || userId;
        if (
          target !== userId &&
          call.callerId.toString() !== userId
        ) {
          return emitError(
            socket,
            "Only the caller can lower another participant's hand",
            403,
          );
        }

        const before = call.raisedHands.length;
        call.raisedHands = call.raisedHands.filter(
          (h) => h.userId.toString() !== target,
        );
        if (call.raisedHands.length === before) return; // nothing to do
        await call.save();

        namespace.to(`call:${callId}`).emit(EVENTS.CALL_HAND_LOWERED, {
          callId,
          userId: target,
          loweredBy: userId,
          queueLength: call.raisedHands.length,
        });
      } catch (err) {
        emitError(socket, err.message);
      }
    });

    // ── IN-CALL @MENTION ───────────────────────────────────
    socket.on(EVENTS.CALL_MENTION, ({ callId, targetUserId, text }) => {
      if (!callId || !targetUserId) return;
      // The mention is broadcast to the meeting room so everyone
      // sees "Maitha → @Bob" highlight, AND a direct push to the
      // mentioned user so they get a sound/buzz even if minimized.
      namespace.to(`call:${callId}`).emit(EVENTS.CALL_MENTIONED, {
        callId,
        fromUserId: userId,
        fromUsername: user.username,
        targetUserId,
        text: (text || "").slice(0, 200),
        at: new Date(),
      });
      namespace.to(`user_${targetUserId}`).emit(EVENTS.CALL_MENTIONED, {
        callId,
        fromUserId: userId,
        fromUsername: user.username,
        targetUserId,
        text: (text || "").slice(0, 200),
        at: new Date(),
      });
    });

    // ── IN-CALL CHAT ───────────────────────────────────────
    // Lightweight, ephemeral. NOT persisted — different from the
    // chat-room message stream. Lives only for the call duration,
    // matching Teams's meeting-chat-that-disappears behaviour.
    socket.on(EVENTS.CALL_CHAT_SEND, async ({ callId, text }) => {
      try {
        if (!callId || !text?.trim()) return;
        const call = await callModel
          .findById(callId)
          .select("participants status")
          .lean();
        if (!call) return emitError(socket, "Call not found", 404);
        const inCall = call.participants.some(
          (p) =>
            p.userId.toString() === userId && p.state === "in-call",
        );
        if (!inCall) return emitError(socket, "Not in call", 403);

        namespace.to(`call:${callId}`).emit(EVENTS.CALL_CHAT_MESSAGE, {
          callId,
          fromUserId: userId,
          fromUsername: user.username,
          text: text.slice(0, 1000),
          at: new Date(),
        });
      } catch (err) {
        emitError(socket, err.message);
      }
    });

    // ── END CALL ───────────────────────────────────────────
    socket.on(EVENTS.CALL_END, async ({ callId }) => {
      try {
        if (!callId) return emitError(socket, "callId is required");

        const call = await callModel.findById(callId);
        if (!call) return;

        // if this user is leaving (not ending for everyone)
        const participant = call.participants.find(
          (p) => p.userId.toString() === userId,
        );

        if (participant && participant.state === "in-call") {
          participant.state = "left";
          participant.leftAt = new Date();
        }

        // check how many are still in the call
        const stillInCall = call.participants.filter(
          (p) => p.state === "in-call",
        );

        if (stillInCall.length <= 1) {
          // last person or caller ending → end the whole call
          const now = new Date();

          call.status = callStatus.ENDED;
          call.endedAt = now;
          call.endReason = "normal";

          if (call.startedAt) {
            call.durationSeconds = Math.floor(
              (now.getTime() - call.startedAt.getTime()) / 1000,
            );
          }

          // mark any remaining in-call participants as "left"
          call.participants.forEach((p) => {
            if (p.state === "in-call") {
              p.state = "left";
              p.leftAt = now;
            }
            if (p.state === "ringing") {
              p.state = "missed";
            }
          });

          clearRingTimer(callId.toString());

          // system message in chat
          const durationText = call.durationSeconds > 0
            ? formatDuration(call.durationSeconds)
            : "no answer";

          await insertCallSystemMessage(
            call.chatRoomId,
            call.callerId,
            `📞 ${call.type === "video" ? "Video" : "Voice"} call · ${durationText}`,
          );
        }

        await call.save();

        // notify everyone in the call
        namespace.to(`call:${callId}`).emit(EVENTS.CALL_ENDED, {
          callId,
          roomId: call.chatRoomId,
          endedBy: userId,
          durationSeconds: call.durationSeconds,
          status: call.status,
        });

        // also emit user-left so others can clean up the peer connection
        socket.to(`call:${callId}`).emit(EVENTS.CALL_USER_LEFT, {
          callId,
          userId,
          username: user.username,
        });

        // leave socket room
        socket.leave(`call:${callId}`);
      } catch (err) {
        emitError(socket, err.message);
      }
    });

    // ── DISCONNECT (cleanup) ───────────────────────────────
    socket.on("disconnect", async () => {
      try {
        // Check if this user still has OTHER active sockets in the call namespace
        // before marking them as "left"
        const otherSockets = await namespace
          .in(`user_${userId}`)
          .fetchSockets();
        const stillConnected = otherSockets.some((s) => s.id !== socket.id);

        if (stillConnected) {
          // User has another tab/device still in the call — don't mark as left
          return;
        }

        // No other sockets — proceed with cleanup
        const activeCalls = await callModel.find({
          "participants.userId": userId,
          "participants.state": "in-call",
          status: { $in: [callStatus.RINGING, callStatus.ACTIVE] },
        });

        for (const call of activeCalls) {
          const participant = call.participants.find(
            (p) => p.userId.toString() === userId,
          );
          if (participant) {
            participant.state = "left";
            participant.leftAt = new Date();
          }

          const stillInCall = call.participants.filter(
            (p) => p.state === "in-call",
          );

          if (stillInCall.length <= 1) {
            const now = new Date();
            call.status = callStatus.ENDED;
            call.endedAt = now;
            call.endReason = "network";
            if (call.startedAt) {
              call.durationSeconds = Math.floor(
                (now.getTime() - call.startedAt.getTime()) / 1000,
              );
            }
            call.participants.forEach((p) => {
              if (p.state === "in-call") {
                p.state = "left";
                p.leftAt = now;
              }
            });
            clearRingTimer(call._id.toString());
          }

          await call.save();

          namespace.to(`call:${call._id}`).emit(EVENTS.CALL_USER_LEFT, {
            callId: call._id,
            userId,
            username: user.username,
            reason: "disconnected",
          });

          if (call.status === callStatus.ENDED) {
            namespace.to(`call:${call._id}`).emit(EVENTS.CALL_ENDED, {
              callId: call._id,
              roomId: call.chatRoomId,
              endedBy: userId,
              durationSeconds: call.durationSeconds,
              status: call.status,
              reason: "network",
            });
          }
        }
      } catch (err) {
        log.error({ err, userId }, "disconnect cleanup failed");
      }
    });
  });
};
