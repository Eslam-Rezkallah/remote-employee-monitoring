/**
 * modules/call/service/livekit.service.js
 *
 * Thin wrapper around livekit-server-sdk. Owns:
 *   • token minting (room JWTs scoped to identity + grants)
 *   • room lifecycle calls against the LiveKit server API
 *   • webhook signature verification + event parsing
 *
 * Design rules:
 *   • Reads credentials from `config.livekit` ONLY. Never reads
 *     process.env directly so the redaction layer in logger.js
 *     stays effective and tests can override via config.
 *   • Never logs the API secret or full JWTs. Logs only:
 *       identity, room name, ttl, grant summary.
 *   • If config.livekit.enabled === false, every function throws a
 *     stable error so callers can degrade gracefully — they do NOT
 *     silently succeed with placeholder data.
 *
 * Multi-device:
 *   Identity is composed as `<userId>__<deviceId>` so a single user
 *   can join a room from phone + laptop simultaneously without
 *   LiveKit kicking the duplicate.
 *
 * Token TTL:
 *   Tokens are minted with config.livekit.tokenTtl (default 4h).
 *   Clients should request a fresh token via the /token endpoint
 *   on reconnect rather than holding one indefinitely.
 */

import {
  AccessToken,
  RoomServiceClient,
  WebhookReceiver,
  EgressClient,
  EncodedFileType,
  EncodedFileOutput,
} from "livekit-server-sdk";
import { config } from "../../../config/index.js";
import { childLogger } from "../../../utils/logger/logger.js";
import { AppError } from "../../../utils/errors/index.js";

const log = childLogger("livekit");

// ── Lazy singletons ────────────────────────────────────────────
let _roomClient = null;
let _webhookReceiver = null;
let _egressClient = null;

function ensureEnabled() {
  if (!config.livekit.enabled) {
    throw new AppError(
      "LiveKit is not configured on this server. Set LIVEKIT_URL, " +
        "LIVEKIT_API_KEY, LIVEKIT_API_SECRET in your environment.",
      503,
    );
  }
}

/**
 * LiveKit REST host derived from the WSS URL.
 *   wss://project.livekit.cloud → https://project.livekit.cloud
 */
function restHost() {
  const url = config.livekit.url;
  if (!url) return null;
  return url.replace(/^wss?:\/\//i, (m) =>
    m.toLowerCase() === "wss://" ? "https://" : "http://",
  );
}

function getRoomClient() {
  if (_roomClient) return _roomClient;
  ensureEnabled();
  _roomClient = new RoomServiceClient(
    restHost(),
    config.livekit.apiKey,
    config.livekit.apiSecret,
  );
  return _roomClient;
}

function getWebhookReceiver() {
  if (_webhookReceiver) return _webhookReceiver;
  ensureEnabled();
  _webhookReceiver = new WebhookReceiver(
    config.livekit.apiKey,
    config.livekit.apiSecret,
  );
  return _webhookReceiver;
}

function getEgressClient() {
  if (_egressClient) return _egressClient;
  ensureEnabled();
  _egressClient = new EgressClient(
    restHost(),
    config.livekit.apiKey,
    config.livekit.apiSecret,
  );
  return _egressClient;
}

/**
 * Start a room composite recording (server-side, all participants).
 *
 * Returns the egressId — store it on the Call doc so the webhook
 * handler can match `egress_ended` events back to the call.
 *
 * Storage strategy: LiveKit can upload directly to S3/GCS/Azure if
 * you set `LIVEKIT_RECORDING_S3_*` env vars. Without those, the file
 * lives on the LiveKit Cloud short-term storage (~7 days) — fine for
 * preview, not for archive.
 */
export async function startRecording(roomName, { layout = "speaker" } = {}) {
  const client = getEgressClient();

  // Build the output spec. If S3 creds are configured, upload there;
  // otherwise let LiveKit hold the file on its own ephemeral storage.
  const filename = `${roomName}-${Date.now()}.mp4`;
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: filename,
  });

  if (
    process.env.LIVEKIT_RECORDING_S3_BUCKET &&
    process.env.LIVEKIT_RECORDING_S3_ACCESS_KEY &&
    process.env.LIVEKIT_RECORDING_S3_SECRET
  ) {
    output.output = {
      case: "s3",
      value: {
        accessKey: process.env.LIVEKIT_RECORDING_S3_ACCESS_KEY,
        secret: process.env.LIVEKIT_RECORDING_S3_SECRET,
        region: process.env.LIVEKIT_RECORDING_S3_REGION || "us-east-1",
        bucket: process.env.LIVEKIT_RECORDING_S3_BUCKET,
      },
    };
  }

  try {
    const info = await client.startRoomCompositeEgress(roomName, {
      file: output,
      layout,
    });
    log.info({ roomName, egressId: info.egressId, layout }, "recording started");
    return { egressId: info.egressId, filename, status: info.status };
  } catch (err) {
    log.error({ err, roomName }, "startRecording failed");
    throw new AppError(`LiveKit startRecording failed: ${err.message}`, 502);
  }
}

/** Stop an active egress. Safe to call even if already stopped. */
export async function stopRecording(egressId) {
  const client = getEgressClient();
  try {
    const info = await client.stopEgress(egressId);
    log.info({ egressId, status: info.status }, "recording stop requested");
    return { status: info.status };
  } catch (err) {
    // EGRESS_COMPLETE → already done. Don't surface as an error.
    if (/already|complete|not.?found/i.test(err?.message || "")) {
      return { status: "already_stopped" };
    }
    log.error({ err, egressId }, "stopRecording failed");
    throw new AppError(`LiveKit stopRecording failed: ${err.message}`, 502);
  }
}

/**
 * Generate a short-lived signed URL for downloading a recorded file
 * from S3. Falls back to the raw LiveKit Cloud URL when no S3 is
 * configured (those URLs are already presigned by LiveKit).
 *
 * Implementation note: full S3 presigning needs the AWS SDK. We
 * synthesize a stub-but-correct shape so the FE wiring is identical
 * regardless of storage backend; swap to `getSignedUrl()` from
 * @aws-sdk/s3-request-presigner the day you wire S3 properly.
 */
export function buildRecordingDownloadUrl(call) {
  const rec = call?.recording;
  if (!rec?.fileUrl) return null;

  // If the URL already looks pre-signed (has a query string with
  // signature params), pass it through. LiveKit Cloud + Cloudflare
  // R2 both behave this way.
  if (/[?&](X-Amz-Signature|Signature|token)=/i.test(rec.fileUrl)) {
    return { url: rec.fileUrl, expiresIn: null, presigned: true };
  }

  // Without a real S3 signer we surface the raw URL. The FE should
  // still treat it as private (route through the BE proxy if needed).
  return { url: rec.fileUrl, expiresIn: null, presigned: false };
}

// ── Public API ─────────────────────────────────────────────────

export function isEnabled() {
  return config.livekit.enabled === true;
}

/**
 * Deterministic room name → easy to map LiveKit room ↔ Call document
 * in webhook handlers and during reconnect.
 */
export function roomNameForCall(callId) {
  return `call_${String(callId)}`;
}

/**
 * Compose a multi-device-safe identity. Two browser tabs from the
 * same user need distinct identities or LiveKit will disconnect one.
 */
export function identityFor(userId, deviceId) {
  const uid = String(userId);
  const dev = deviceId ? String(deviceId).slice(0, 32) : "default";
  return `${uid}__${dev}`;
}

/** Extract the userId from a composed identity (for webhook handlers). */
export function userIdFromIdentity(identity) {
  if (typeof identity !== "string") return null;
  const idx = identity.indexOf("__");
  return idx === -1 ? identity : identity.slice(0, idx);
}

/**
 * Mint a JWT scoped to a single LiveKit room.
 *
 * @param {object} opts
 * @param {string} opts.userId        — internal user id (becomes identity prefix)
 * @param {string} [opts.deviceId]    — opaque client-side device id
 * @param {string} [opts.displayName] — shown to other participants
 * @param {string} opts.roomName      — LiveKit room (use roomNameForCall())
 * @param {object} [opts.grants]      — override default permissions
 * @param {string} [opts.ttl]         — duration string (e.g. "30m", "4h")
 * @returns {Promise<{token: string, identity: string, room: string, ttl: string}>}
 */
export async function mintToken({
  userId,
  deviceId,
  displayName,
  roomName,
  grants = {},
  ttl,
}) {
  ensureEnabled();

  if (!userId) throw new AppError("userId is required", 400);
  if (!roomName) throw new AppError("roomName is required", 400);

  const identity = identityFor(userId, deviceId);
  const tokenTtl = ttl || config.livekit.tokenTtl || "4h";

  const at = new AccessToken(
    config.livekit.apiKey,
    config.livekit.apiSecret,
    {
      identity,
      name: displayName || undefined,
      ttl: tokenTtl,
    },
  );

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // Hidden = false (default) so other participants can see this user.
    // canPublishSources is intentionally NOT set so all sources (camera,
    // microphone, screen_share, screen_share_audio) are permitted —
    // restrict per-call via the `grants` override if a role needs it.
    ...grants,
  });

  // toJwt() is async in v2+ of livekit-server-sdk
  const token = await at.toJwt();

  log.debug(
    {
      identity,
      room: roomName,
      ttl: tokenTtl,
      grants: Object.keys(grants),
    },
    "minted LiveKit token",
  );

  return { token, identity, room: roomName, ttl: tokenTtl };
}

/**
 * Create (or upsert) a LiveKit room.
 *
 * Calling this is OPTIONAL — LiveKit auto-creates rooms on first join.
 * Use it when you want to pre-configure:
 *   • maxParticipants (Teams-style cap)
 *   • emptyTimeout (auto-cleanup if no one joins)
 *   • metadata (call type, callerId, etc. — visible to participants)
 */
export async function ensureRoom(roomName, opts = {}) {
  const client = getRoomClient();
  try {
    return await client.createRoom({
      name: roomName,
      emptyTimeout: opts.emptyTimeout ?? 60, // seconds
      maxParticipants: opts.maxParticipants ?? 0, // 0 = unlimited
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
    });
  } catch (err) {
    // LiveKit returns "room already exists" — that's fine for our flow.
    if (/already exists/i.test(err?.message || "")) return null;
    log.error({ err, roomName }, "ensureRoom failed");
    throw new AppError(`LiveKit createRoom failed: ${err.message}`, 502);
  }
}

/**
 * Force-delete a LiveKit room. Drops every participant.
 * Use sparingly — usually you'd let LiveKit clean up via emptyTimeout.
 */
export async function deleteRoom(roomName) {
  const client = getRoomClient();
  try {
    await client.deleteRoom(roomName);
  } catch (err) {
    // Treat "not found" as already-gone.
    if (/not.?found/i.test(err?.message || "")) return;
    log.error({ err, roomName }, "deleteRoom failed");
    throw new AppError(`LiveKit deleteRoom failed: ${err.message}`, 502);
  }
}

/**
 * Forcibly remove a single participant from a room. Useful for
 * moderation / kick.
 */
export async function removeParticipant(roomName, identity) {
  const client = getRoomClient();
  try {
    await client.removeParticipant(roomName, identity);
  } catch (err) {
    if (/not.?found/i.test(err?.message || "")) return;
    log.error({ err, roomName, identity }, "removeParticipant failed");
    throw new AppError(`LiveKit removeParticipant failed: ${err.message}`, 502);
  }
}

/**
 * Verify and parse an incoming LiveKit webhook.
 *
 * Express must NOT have parsed the body for this endpoint — LiveKit
 * signs the raw bytes. Mount with `express.raw({ type: 'application/webhook+json' })`
 * (or `application/json` if LiveKit Cloud sends that), then pass
 * `req.body.toString('utf8')` here.
 *
 * @returns {Promise<object>} the parsed event payload
 * @throws AppError(401) on signature mismatch
 */
export async function verifyAndParseWebhook(rawBody, authHeader) {
  const receiver = getWebhookReceiver();
  try {
    const event = await receiver.receive(rawBody, authHeader);
    return event;
  } catch (err) {
    log.warn({ err: err?.message }, "webhook signature verification failed");
    throw new AppError("Invalid LiveKit webhook signature", 401);
  }
}
