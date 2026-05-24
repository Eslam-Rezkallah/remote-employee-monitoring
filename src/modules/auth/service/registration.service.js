import userModel, { providerTypes } from "../../../DB/Model/user.model.js";
import { emailEvent } from "../../../utils/events/email.event.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import {
  compareHash,
  generateHash,
} from "../../../utils/security/hash.security.js";
import { OAuth2Client } from "google-auth-library";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  TooManyRequestsError,
} from "../../../utils/errors/index.js";
import { config } from "../../../config/index.js";

// ═══════════════════════════════════════════════════════════
// SIGNUP
// ═══════════════════════════════════════════════════════════

export const signup = asyncHandler(async (req, res, next) => {
  const { username, email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return next(
      new BadRequestError("Password and Confirm Password do not match"),
    );
  }

  const existing = await userModel.findOne({ email });
  if (existing) {
    return next(new ConflictError("Email already exists"));
  }

  const user = await userModel.create({
    username,
    email,
    password: generateHash({ plainText: password }),
  });

  emailEvent.emit("sendConfirmationEmail", { id: user._id, email });

  const userObj = user.toObject();
  delete userObj.password;

  return successResponse({
    res,
    status: 201,
    message: "User registered successfully",
    data: { user: userObj },
  });
});

// ═══════════════════════════════════════════════════════════
// SIGNUP WITH GOOGLE
// ═══════════════════════════════════════════════════════════

export const signupWithGoogle = asyncHandler(async (req, res, next) => {
  const { idToken } = req.body;
  if (!idToken) {
    return next(new BadRequestError("ID token is required"));
  }

  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: config.oauth.googleClientId,
  });
  const payload = ticket.getPayload();

  if (!payload.email_verified) {
    return next(new UnauthorizedError("Email not verified by Google"));
  }

  const existingUser = await userModel.findOne({ email: payload.email });
  if (existingUser) {
    return next(
      new ConflictError("User already exists. Please login instead."),
    );
  }

  const newUser = await userModel.create({
    email: payload.email,
    username: payload.name,
    image: payload.picture
      ? { secure_url: payload.picture, public_id: null }
      : undefined,
    confirmEmail: true,
    provider: providerTypes.Google,
  });

  const userObj = newUser.toObject();
  delete userObj.password;

  return successResponse({
    res,
    status: 201,
    message: "Google account registered successfully",
    data: { user: userObj },
  });
});

// ═══════════════════════════════════════════════════════════
// CONFIRM EMAIL
// ═══════════════════════════════════════════════════════════

export const confirmEmail = asyncHandler(async (req, res, next) => {
  const { email, code } = req.body;

  const user = await userModel.findOne({ email });
  if (!user) return next(new NotFoundError("User not found"));

  if (user.confirmEmail) {
    return next(new ConflictError("Email already confirmed"));
  }

  // Ban expired → reset and resend
  if (
    user.confirmEmailOTPBanUntil &&
    user.confirmEmailOTPBanUntil < Date.now()
  ) {
    await userModel.updateOne(
      { email },
      {
        $unset: {
          confirmEmailOTP: 1,
          confirmEmailOTPExpires: 1,
          confirmEmailOTPFailedAttempts: 1,
          confirmEmailOTPBanUntil: 1,
        },
      },
    );
    emailEvent.emit("sendConfirmationEmail", { id: user._id, email });
    return next(
      new UnauthorizedError(
        "Incorrect OTP. A new OTP has been sent to your email.",
      ),
    );
  }

  // Currently banned
  if (
    user.confirmEmailOTPBanUntil &&
    user.confirmEmailOTPBanUntil > Date.now()
  ) {
    return next(
      new TooManyRequestsError(
        "Your request has been banned. Try again later.",
      ),
    );
  }

  // OTP expired → resend
  if (user.confirmEmailOTPExpires && user.confirmEmailOTPExpires < Date.now()) {
    emailEvent.emit("sendConfirmationEmail", { id: user._id, email });
    return next(
      new UnauthorizedError(
        "OTP expired. A new OTP has been sent to your email.",
      ),
    );
  }

  const otpValid =
    user.confirmEmailOTP &&
    compareHash({ plainText: code, hashValue: user.confirmEmailOTP });

  if (!otpValid) {
    const nextAttempts = (user.confirmEmailOTPFailedAttempts || 0) + 1;
    await userModel.updateOne(
      { email },
      { confirmEmailOTPFailedAttempts: nextAttempts },
    );

    if (nextAttempts >= 5) {
      await userModel.updateOne(
        { email },
        { confirmEmailOTPBanUntil: Date.now() + 300000 },
      );
      return next(
        new TooManyRequestsError(
          "Too many failed confirmation attempts. Please try again after 5 minutes.",
        ),
      );
    }

    emailEvent.emit("sendConfirmationEmail", { id: user._id, email });
    return next(
      new UnauthorizedError(
        "Incorrect OTP. A new OTP has been sent to your email.",
      ),
    );
  }

  // OTP correct
  await userModel.updateOne(
    { email },
    {
      confirmEmail: true,
      $unset: {
        confirmEmailOTP: 1,
        confirmEmailOTPExpires: 1,
        confirmEmailOTPFailedAttempts: 1,
        confirmEmailOTPBanUntil: 1,
      },
    },
  );

  return successResponse({
    res,
    message: "Email confirmed successfully",
  });
});
