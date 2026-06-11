import joi from "joi";
import { isValidObjectId } from "../../middleware/validation.middleware.js";

const id = joi.string().custom(isValidObjectId).required();

// GET /chat/rooms/:roomId/calls
export const getCallHistory = joi
  .object({
    roomId: id.label("roomId"),
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(50).default(20),
  })
  .required();

// GET /chat/rooms/:roomId/calls/active
export const getActiveCall = joi
  .object({
    roomId: id.label("roomId"),
  })
  .required();

// GET /chat/rooms/:roomId/calls/:callId
export const getCall = joi
  .object({
    roomId: id.label("roomId"),
    callId: id.label("callId"),
  })
  .required();

// POST /chat/rooms/:roomId/calls/:callId/livekit-token
// deviceId is opaque to the server — used only to disambiguate
// multiple simultaneous sessions for the same user (LiveKit
// rejects duplicate identities).
export const issueLivekitToken = joi
  .object({
    roomId: id.label("roomId"),
    callId: id.label("callId"),
    deviceId: joi.string().min(1).max(64).optional(),
  })
  .required();
