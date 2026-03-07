import jwt from "jsonwebtoken";
import userModel from "../../DB/Model/user.model.js";

/**
 * Socket Authentication Middleware
 * Verifies JWT token from socket handshake and attaches user to socket.
 * Supports tokens signed with USER_ACCESS_TOKEN or ADMIN_ACCESS_TOKEN.
 */
export const authentication = async ({ socket }) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(" ")[1];

    if (!token) {
      return {
        valid: false,
        data: { message: "No token provided", status: 401 },
      };
    }

    // Try user signature first, then admin signature
    let decoded = null;
    for (const signature of [
      process.env.USER_ACCESS_TOKEN,
      process.env.ADMIN_ACCESS_TOKEN,
    ]) {
      try {
        decoded = jwt.verify(token, signature);
        break;
      } catch (_) {
        // try next signature
      }
    }

    if (!decoded) {
      return {
        valid: false,
        data: { message: "Invalid token", status: 401 },
      };
    }

    const user = await userModel
      .findById(decoded.id)
      .select(
        "-password -confirmEmailOTP -resetPasswordOTP -twoStepVerificationOTP",
      );

    if (!user || !user.isActive || user.isDeleted) {
      return {
        valid: false,
        data: { message: "User not found or inactive", status: 401 },
      };
    }

    // Check if token was issued before last credential change
    if (
      user.changeCredentialsTime &&
      decoded.iat < Math.floor(user.changeCredentialsTime.getTime() / 1000)
    ) {
      return {
        valid: false,
        data: {
          message: "Token expired due to credential change",
          status: 401,
        },
      };
    }

    return { valid: true, data: { user } };
  } catch (error) {
    return {
      valid: false,
      data: {
        message:
          error.name === "JsonWebTokenError"
            ? "Invalid token"
            : error.name === "TokenExpiredError"
              ? "Token expired"
              : "Authentication failed",
        status: 401,
      },
    };
  }
};
