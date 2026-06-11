import callModel, { callStatus } from "../../../DB/Model/call.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { httpError } from "../../../utils/errors/index.js";
import { config } from "../../../config/index.js";
import {
  isEnabled as livekitEnabled,
  roomNameForCall,
  mintToken,
  userIdFromIdentity,
  verifyAndParseWebhook,
  startRecording,
  stopRecording,
  buildRecordingDownloadUrl,
} from "./livekit.service.js";
import { childLogger } from "../../../utils/logger/logger.js";

const log = childLogger("call-service");

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

async function requireRoomMember(roomId, userId) {
  const room = await chatRoomModel.findOne({
    _id: roomId,
    members: userId,
    isDeleted: false,
  });
  if (!room) throw httpError(404, "Room not found or access denied");
  return room;
}


// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/calls
// Call history for a room (paginated, newest first)
// ─────────────────────────────────────────────────────────────

export const getCallHistory = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    chatRoomId: roomId,
    status: { $ne: callStatus.RINGING }, // don't show currently ringing calls in history
  };

  const [calls, total] = await Promise.all([
    callModel
      .find(filter)
      .populate("callerId", "username email image")
      .populate("participants.userId", "username image")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    callModel.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: {
      calls,
      total,
      page,
      limit,
      hasMore: skip + limit < total,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/calls/active
// Check if there's an active/ringing call in this room
// ─────────────────────────────────────────────────────────────

export const getActiveCall = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const call = await callModel
    .findOne({
      chatRoomId: roomId,
      status: { $in: [callStatus.RINGING, callStatus.ACTIVE] },
    })
    .populate("callerId", "username email image")
    .populate("participants.userId", "username image")
    .lean();

  return successResponse({
    res,
    data: { call: call || null, hasActiveCall: !!call },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/calls/:callId
// Get details of a specific call
// ─────────────────────────────────────────────────────────────

export const getCall = asyncHandler(async (req, res, next) => {
  const { roomId, callId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const call = await callModel
    .findOne({ _id: callId, chatRoomId: roomId })
    .populate("callerId", "username email image")
    .populate("participants.userId", "username image")
    .lean();

  if (!call) return next(httpError(404, "Call not found"));

  return successResponse({ res, data: { call } });
});

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/calls/:callId/livekit-token
// Mints a short-lived JWT scoped to the call's LiveKit room.
//
// Flow:
//   1. Caller has already invoked `call:initiate` over Socket.IO
//      (which created the Call doc).
//   2. To actually join the media room, every participant calls
//      this endpoint to receive a token (one per device).
//   3. Clients hold the token client-side, never on the server.
//   4. On token expiry / reconnect, client calls this again.
//
// Side effect: marks the call as provider="livekit" and assigns
// a deterministic livekitRoomName the first time a token is issued.
// This keeps legacy mesh calls unaffected.
// ─────────────────────────────────────────────────────────────

export const issueLivekitToken = asyncHandler(async (req, res, next) => {
  if (!livekitEnabled()) {
    return next(httpError(503, "LiveKit is not configured on this server"));
  }

  const { roomId, callId } = req.params;
  const { deviceId } = req.body || {};
  const user = req.user;

  await requireRoomMember(roomId, user._id);

  const call = await callModel.findOne({ _id: callId, chatRoomId: roomId });
  if (!call) return next(httpError(404, "Call not found"));

  // Reject join attempts for finished calls.
  if (![callStatus.RINGING, callStatus.ACTIVE].includes(call.status)) {
    return next(httpError(409, `Call is ${call.status}; cannot join`));
  }

  // Only participants of the call (added at initiate time) may join.
  const isParticipant = call.participants.some(
    (p) => p.userId.toString() === user._id.toString(),
  );
  if (!isParticipant) {
    return next(httpError(403, "Not a participant in this call"));
  }

  // Assign LiveKit room metadata on first token request.
  if (!call.livekitRoomName) {
    call.provider = "livekit";
    call.livekitRoomName = roomNameForCall(call._id);
    await call.save();
  }

  const { token, identity, room, ttl } = await mintToken({
    userId: user._id,
    deviceId,
    displayName: user.username,
    roomName: call.livekitRoomName,
  });

  return successResponse({
    res,
    message: "LiveKit token issued",
    data: {
      // The URL is the only piece of the livekit config block that's
      // safe to ship to clients. apiKey/apiSecret stay server-side.
      url: config.livekit.url,
      token,
      identity,
      room,
      ttl,
      callId: call._id,
      provider: "livekit",
    },
  });
});

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/calls/:callId/recording
// Starts a room-composite egress for an active call. Only the
// caller OR an org admin can start a recording — recordings are
// sensitive (privacy + storage cost).
// ─────────────────────────────────────────────────────────────

async function requireRecordingControl(call, userId) {
  // Caller always allowed
  if (call.callerId.toString() === userId.toString()) return true;
  // Otherwise must be an org admin/owner
  if (!call.organizationId) {
    throw httpError(403, "Only the caller can control recording");
  }
  const memberModel = (await import("../../../DB/Model/member.model.js"))
    .default;
  const m = await memberModel.findOne({
    organizationId: call.organizationId,
    userId,
    isActive: true,
  });
  if (!m || !["owner", "admin"].includes(m.role)) {
    throw httpError(403, "Only the caller or an org admin can control recording");
  }
  return true;
}

export const startCallRecording = asyncHandler(async (req, res, next) => {
  if (!livekitEnabled()) {
    return next(httpError(503, "LiveKit is not configured on this server"));
  }
  const { roomId, callId } = req.params;
  await requireRoomMember(roomId, req.user._id);

  const call = await callModel.findOne({ _id: callId, chatRoomId: roomId });
  if (!call) return next(httpError(404, "Call not found"));
  if (call.status !== callStatus.ACTIVE) {
    return next(
      httpError(409, `Recording requires an active call (current: ${call.status})`),
    );
  }
  if (call.recording?.enabled && call.recording?.status === "active") {
    return next(httpError(409, "Recording already in progress"));
  }
  await requireRecordingControl(call, req.user._id);

  const roomName = call.livekitRoomName || roomNameForCall(call._id);
  const result = await startRecording(roomName, {
    layout: req.body?.layout || "speaker",
  });

  call.recording = {
    enabled: true,
    egressId: result.egressId,
    status: "pending", // webhook flips this to "active" → "ended"
    startedAt: new Date(),
    endedAt: null,
    fileUrl: null,
  };
  await call.save();

  return successResponse({
    res,
    message: "Recording started",
    data: { egressId: result.egressId, callId: call._id, status: "pending" },
  });
});

// DELETE /chat/rooms/:roomId/calls/:callId/recording
export const stopCallRecording = asyncHandler(async (req, res, next) => {
  if (!livekitEnabled()) {
    return next(httpError(503, "LiveKit is not configured on this server"));
  }
  const { roomId, callId } = req.params;
  await requireRoomMember(roomId, req.user._id);

  const call = await callModel.findOne({ _id: callId, chatRoomId: roomId });
  if (!call) return next(httpError(404, "Call not found"));
  if (!call.recording?.egressId) {
    return next(httpError(409, "No active recording to stop"));
  }
  await requireRecordingControl(call, req.user._id);

  const result = await stopRecording(call.recording.egressId);
  // Don't flip status here — let the webhook do it authoritatively.
  log.info(
    { callId: call._id, egressId: call.recording.egressId, status: result.status },
    "stop recording requested",
  );
  return successResponse({
    res,
    message: "Recording stop requested",
    data: { callId: call._id, status: result.status },
  });
});

// GET /chat/rooms/:roomId/calls/:callId/recording/download
// Returns a signed/presigned URL for the recorded file. Any room
// member can download — the file IS the call they participated in.
export const getRecordingDownload = asyncHandler(async (req, res, next) => {
  const { roomId, callId } = req.params;
  await requireRoomMember(roomId, req.user._id);

  const call = await callModel.findOne({ _id: callId, chatRoomId: roomId });
  if (!call) return next(httpError(404, "Call not found"));
  if (!call.recording?.fileUrl) {
    return next(httpError(404, "No recording available"));
  }
  if (call.recording.status !== "ended") {
    return next(httpError(409, `Recording is ${call.recording.status}; not ready yet`));
  }

  const link = buildRecordingDownloadUrl(call);
  return successResponse({
    res,
    data: { ...link, callId: call._id },
  });
});

// ─────────────────────────────────────────────────────────────
// POST <LIVEKIT_WEBHOOK_PATH>
// Receives lifecycle events from LiveKit Cloud and reflects them
// onto the Call document.
//
// IMPORTANT: Express must deliver the RAW body to this handler so
// the signature check works. The route is mounted in App.controller
// with `express.raw({ type: "*/*" })`.
// ─────────────────────────────────────────────────────────────

export const handleLivekitWebhook = asyncHandler(async (req, res) => {
  if (!livekitEnabled()) {
    // Fail loudly rather than silently 200 — misconfigured webhooks
    // should surface in LiveKit's dashboard.
    return res.status(503).json({ success: false, message: "LiveKit disabled" });
  }

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : "";

  const authHeader = req.headers["authorization"] || "";
  const event = await verifyAndParseWebhook(rawBody, authHeader);

  // Always 200 quickly — LiveKit retries on non-2xx and our handler
  // updates are best-effort (the next event will reconcile).
  res.status(200).json({ ok: true });

  try {
    await reconcileLivekitEvent(event);
  } catch (err) {
    log.error({ err, event: event?.event }, "webhook reconcile failed");
  }
});

async function reconcileLivekitEvent(event) {
  const room = event?.room;
  if (!room?.name?.startsWith("call_")) {
    // Not one of our managed rooms — ignore.
    return;
  }
  const callId = room.name.slice("call_".length);
  const call = await callModel.findById(callId);
  if (!call) {
    log.warn({ callId, type: event.event }, "webhook for unknown call");
    return;
  }

  switch (event.event) {
    case "room_started": {
      if (call.status === callStatus.RINGING) {
        call.status = callStatus.ACTIVE;
        call.startedAt = new Date();
      }
      break;
    }
    case "room_finished": {
      if (
        call.status !== callStatus.ENDED &&
        call.status !== callStatus.MISSED
      ) {
        const now = new Date();
        call.status = callStatus.ENDED;
        call.endedAt = now;
        if (call.startedAt) {
          call.durationSeconds = Math.floor(
            (now.getTime() - call.startedAt.getTime()) / 1000,
          );
        }
      }
      break;
    }
    case "participant_joined": {
      const uid = userIdFromIdentity(event.participant?.identity);
      const p = call.participants.find((x) => x.userId.toString() === uid);
      if (p) {
        p.state = "in-call";
        if (!p.joinedAt) p.joinedAt = new Date();
      }
      const inCall = call.participants.filter((x) => x.state === "in-call").length;
      if (inCall > (call.maxParticipants || 0)) call.maxParticipants = inCall;
      break;
    }
    case "participant_left": {
      const uid = userIdFromIdentity(event.participant?.identity);
      const p = call.participants.find((x) => x.userId.toString() === uid);
      if (p && p.state === "in-call") {
        p.state = "left";
        p.leftAt = new Date();
      }
      break;
    }
    case "egress_started": {
      call.recording.enabled = true;
      call.recording.egressId = event.egressInfo?.egressId || null;
      call.recording.status = "active";
      call.recording.startedAt = new Date();
      break;
    }
    case "egress_ended": {
      call.recording.status =
        event.egressInfo?.status === "EGRESS_COMPLETE" ? "ended" : "failed";
      call.recording.endedAt = new Date();
      // fileUrl extraction depends on egress type; left as a TODO until
      // the egress feature is actually enabled in production.
      break;
    }
    default:
      log.debug({ type: event.event }, "unhandled LiveKit event");
  }

  await call.save();
}
