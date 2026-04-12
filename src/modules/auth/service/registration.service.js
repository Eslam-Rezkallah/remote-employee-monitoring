import userModel, { providerTypes } from "../../../DB/Model/user.model.js";
import { emailEvent } from "../../../utils/events/email.event.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import {
  compareHash,
  generateHash,
} from "../../../utils/security/hash.security.js";
import { OAuth2Client } from "google-auth-library";

// ═══════════════════════════════════════════════════════════════
// SIGNUP
// ═══════════════════════════════════════════════════════════════

export const signup = asyncHandler(async (req, res, next) => {
  const { username, email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return next(
      new Error("Password and Confirm Password do not match", { cause: 400 }),
    );
  }

  const existing = await userModel.findOne({ email });
  if (existing) {
    return next(new Error("Email already exists", { cause: 409 }));
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
    message: "User registered successfully",
    data: userObj,
    status: 201,
  });
});

// ═══════════════════════════════════════════════════════════════
// SIGNUP WITH GOOGLE
// FIX: was saving "profilePic" which does not exist on the User model.
//      The model uses "image: { secure_url, public_id }"
// ═══════════════════════════════════════════════════════════════

export const signupWithGoogle = asyncHandler(async (req, res, next) => {
  const { idToken } = req.body;
  if (!idToken) {
    return next(new Error("ID token is required", { cause: 400 }));
  }

  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  if (!payload.email_verified) {
    return next(new Error("Email not verified by Google", { cause: 401 }));
  }

  const existingUser = await userModel.findOne({ email: payload.email });
  if (existingUser) {
    return next(
      new Error("User already exists. Please login instead.", { cause: 409 }),
    );
  }

  const newUser = await userModel.create({
    email: payload.email,
    username: payload.name,
    // FIX: correct field name matching the User model schema
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
    message: "Google account registered successfully",
    data: userObj,
    status: 201,
  });
});

// ═══════════════════════════════════════════════════════════════
// CONFIRM EMAIL
// ═══════════════════════════════════════════════════════════════

export const confirmEmail = asyncHandler(async (req, res, next) => {
  const { email, code } = req.body;

  const user = await userModel.findOne({ email });
  if (!user) return next(new Error("User not found", { cause: 404 }));

  if (user.confirmEmail) {
    return next(new Error("Email already confirmed", { cause: 409 }));
  }

  // ban expired → reset counters and resend
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
      new Error(
        "Incorrect OTP. A new OTP has been sent to your email. Please check your inbox.",
        { cause: 401 },
      ),
    );
  }

  // currently banned
  if (
    user.confirmEmailOTPBanUntil &&
    user.confirmEmailOTPBanUntil > Date.now()
  ) {
    return next(
      new Error("Your request has been banned. Try again later.", {
        cause: 429,
      }),
    );
  }

  // OTP expired → resend
  if (user.confirmEmailOTPExpires && user.confirmEmailOTPExpires < Date.now()) {
    emailEvent.emit("sendConfirmationEmail", { id: user._id, email });
    return next(
      new Error("OTP expired. A new OTP has been sent to your email.", {
        cause: 401,
      }),
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
        new Error(
          "Too many failed confirmation attempts. Please try again after 5 minutes.",
          { cause: 429 },
        ),
      );
    }

    emailEvent.emit("sendConfirmationEmail", { id: user._id, email });
    return next(
      new Error(
        "Incorrect OTP. A new OTP has been sent to your email. Please check your inbox.",
        { cause: 401 },
      ),
    );
  }

  // OTP correct → confirm email and clear OTP fields
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
    status: 200,
  });
});
