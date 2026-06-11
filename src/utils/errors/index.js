export { AppError } from "./AppError.js";
export { BadRequestError } from "./BadRequestError.js";
export { UnauthorizedError } from "./UnauthorizedError.js";
export { ForbiddenError } from "./ForbiddenError.js";
export { NotFoundError } from "./NotFoundError.js";
export { ConflictError } from "./ConflictError.js";
export { TooManyRequestsError } from "./TooManyRequestsError.js";

import { AppError } from "./AppError.js";
import { BadRequestError } from "./BadRequestError.js";
import { UnauthorizedError } from "./UnauthorizedError.js";
import { ForbiddenError } from "./ForbiddenError.js";
import { NotFoundError } from "./NotFoundError.js";
import { ConflictError } from "./ConflictError.js";
import { TooManyRequestsError } from "./TooManyRequestsError.js";

/**
 * httpError(status, message, details?)
 *
 * Convenience factory for service-layer errors. Maps an HTTP status code to
 * the correct AppError subclass so the global error handler can render a
 * stable response shape (`{ success: false, message, data: null }`).
 *
 * Migration path away from the legacy anti-pattern used across services:
 *   throw Object.assign(new Error("Room not found"), { cause: 404 });
 * becomes:
 *   throw httpError(404, "Room not found");
 *
 * Both keep working (error.response.js still handles `err.cause === number`),
 * but new code should prefer this helper because:
 *   - it produces a proper AppError (carries `isOperational`)
 *   - it does not abuse the native `Error#cause` slot
 *   - it discriminates 401 vs 403 vs 409 correctly for clients
 */
export function httpError(status, message, details = null) {
  switch (status) {
    case 400: return new BadRequestError(message, details);
    case 401: return new UnauthorizedError(message, details);
    case 403: return new ForbiddenError(message, details);
    case 404: return new NotFoundError(message, details);
    case 409: return new ConflictError(message, details);
    case 429: return new TooManyRequestsError(message, details);
    default:  return new AppError(message, status, details);
  }
}
