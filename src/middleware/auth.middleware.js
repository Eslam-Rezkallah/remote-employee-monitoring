// src/middleware/auth.middleware.js
import { asyncHandler } from "../utils/response/error.response.js";
import { decodedToken } from "../utils/security/token.security.js";
import { ForbiddenError } from "../utils/errors/index.js";

export const authentication = () => {
  return asyncHandler(async (req, res, next) => {
    const { authorization } = req.headers;
    req.user = await decodedToken({ authorization });
    return next();
  });
};

/**
 * 403 = authenticated but lacks permission.
 * 401 = not authenticated (handled by authentication() above).
 */
export const authorization = (accessRoles = []) => {
  return asyncHandler(async (req, res, next) => {
    if (!accessRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError("You are not authorized to access this resource"),
      );
    }
    return next();
  });
};
