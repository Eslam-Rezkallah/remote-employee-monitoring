import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import userModel, {
  providerTypes,
  roleTypes,
} from "../../../DB/Model/user.model.js";
import { emailEvent } from "../../../utils/events/email.event.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import {
  compareHash,
  generateHash,
} from "../../../utils/security/hash.security.js";
import {
  decodedToken,
  generateToken,
  tokenTypes,
} from "../../../utils/security/token.security.js";
import * as dbService from "../../../DB/db.service.js";

const checkBanAndOTPStatus = async (user, otpType) => {
  let otpField = "";
  let banUntilField = "";
  let failedAttemptsField = "";
  let expiresField = "";

  switch (otpType) {
    case "twoStepVerification":
      otpField = "twoStepVerificationOTP";
      banUntilField = "twoStepVerificationOTPBanUntil";
      failedAttemptsField = "twoStepVerificationOTPFailedAttempts";
      expiresField = "twoStepVerificationOTPExpires";
      break;
    case "resetPassword":
      otpField = "resetPasswordOTP";
      banUntilField = "resetPasswordOTPBanUntil";
      failedAttemptsField = "resetPasswordOTPFailedAttempts";
      expiresField = "resetPasswordOTPExpires";
      break;
    case "confirmEmail":
      otpField = "confirmEmailOTP";
      banUntilField = "confirmEmailOTPBanUntil";
      failedAttemptsField = "confirmEmailOTPFailedAttempts";
      expiresField = "confirmEmailOTPExpires";
      break;
    default:
      throw new Error("Invalid OTP type");
  }

  if (user[banUntilField] && user[banUntilField] > Date.now()) {
    throw new Error("Your request has been banned. Try again later", {
      cause: 429,
    });
  }

  if (user[banUntilField] && user[banUntilField] < Date.now()) {
    user[banUntilField] = null;
    user[failedAttemptsField] = 0;
    await user.save();
  }

  if (user[failedAttemptsField] >= 5) {
    user[banUntilField] = Date.now() + 300000;
    await user.save();
    throw new Error("Too many failed attempts. You are banned for 5 minutes.", {
      cause: 429,
    });
  }

  if (user[otpField] && user[expiresField] < Date.now()) {
    const eventName =
      otpType === "twoStepVerification"
        ? "twoStepVerification"
        : otpType === "resetPassword"
          ? "ForgetPassword"
          : "sendConfirmationEmail";
    emailEvent.emit(eventName, { id: user._id, email: user.email });
    throw new Error("OTP expired. A new OTP has been sent to your email.", {
      cause: 401,
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// LOGIN with email + password
// ═══════════════════════════════════════════════════════════════
export const login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new Error("Email and password are required", { cause: 400 }));
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: {
      email,
      provider: providerTypes.System,
    },
  });

  if (!user) {
    // Check if the email exists under another provider
    const existingUser = await dbService.findOne({
      model: userModel,
      filter: { email },
    });
    if (existingUser && existingUser.provider === providerTypes.Google) {
      return next(
        new Error("Account registered with another provider (e.g., Google).", {
          cause: 401,
        }),
      );
    }
    return next(new Error("Invalid credentials", { cause: 401 }));
  }

  if (!user.confirmEmail) {
    return next(new Error("Email not confirmed", { cause: 401 }));
  }

  if (!compareHash({ plainText: password, hashValue: user.password })) {
    return next(new Error("Invalid credentials", { cause: 401 }));
  }

  // Check if two-step verification is enabled
  if (user.twoStepVerification) {
    emailEvent.emit("twoStepVerification", { id: user._id, email });
    return successResponse({
      res,
      data: { requiresOTP: true },
    });
  }

  // ✅ FIX: Return user info along with token so frontend can store userId/username
  const accessToken = generateToken({
    payload: { id: user._id },
    signature:
      user.role === roleTypes.Admin
        ? process.env.ADMIN_ACCESS_TOKEN
        : process.env.USER_ACCESS_TOKEN,
  });

  return successResponse({
    res,
    data: {
      accessToken,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        image: user.image,
        role: user.role,
      },
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// LOGIN with Google
// ═══════════════════════════════════════════════════════════════
export const loginWithGoogle = asyncHandler(async (req, res, next) => {
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
    return next(new Error("Google email not verified", { cause: 401 }));
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { email: payload.email },
  });

  if (!user) {
    return next(
      new Error("User not found. Please sign up with Google first.", {
        cause: 404,
      }),
    );
  }

  if (user.provider !== providerTypes.Google) {
    return next(
      new Error("This email is registered with another provider.", {
        cause: 409,
      }),
    );
  }

  // ✅ FIX: use correct roleTypes values (Admin, not admin/superAdmin)
  const accessToken = generateToken({
    payload: { id: user._id },
    signature:
      user.role === roleTypes.Admin
        ? process.env.ADMIN_ACCESS_TOKEN
        : process.env.USER_ACCESS_TOKEN,
  });

  // ✅ FIX: Return user info
  return successResponse({
    res,
    message: "Google login successful",
    data: {
      accessToken,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        image: user.image,
        role: user.role,
      },
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// VALIDATE LOGIN OTP (2FA)
// ═══════════════════════════════════════════════════════════════
export const validateLoginOTP = asyncHandler(async (req, res, next) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return next(new Error("Email and OTP code are required", { cause: 400 }));
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { email, isDeleted: false },
  });

  if (!user) {
    return next(new Error("User not found", { cause: 404 }));
  }

  if (!user.twoStepVerification) {
    return next(
      new Error("Two-step verification is not enabled", { cause: 400 }),
    );
  }
  try {
    await checkBanAndOTPStatus(user, "twoStepVerification");
  } catch (error) {
    return next(error);
  }

  if (
    !user.twoStepVerificationOTP ||
    !compareHash({ plainText: code, hashValue: user.twoStepVerificationOTP })
  ) {
    user.twoStepVerificationOTPFailedAttempts++;
    await user.save();

    if (user.twoStepVerificationOTPFailedAttempts >= 5) {
      user.twoStepVerificationOTPBanUntil = Date.now() + 300000;
      await user.save();
      return next(
        new Error("Too many failed attempts. You are banned for 5 minutes.", {
          cause: 429,
        }),
      );
    }

    return next(new Error("Invalid OTP", { cause: 401 }));
  }

  if (user.twoStepVerificationOTPExpires < Date.now()) {
    return next(new Error("OTP expired", { cause: 401 }));
  }

  const accessToken = generateToken({
    payload: { id: user._id },
    signature:
      user.role === roleTypes.Admin
        ? process.env.ADMIN_ACCESS_TOKEN
        : process.env.USER_ACCESS_TOKEN,
  });

  await dbService.updateOne({
    model: userModel,
    filter: { _id: user._id },
    data: {
      twoStepVerificationOTP: null,
      twoStepVerificationOTPExpires: null,
      twoStepVerificationOTPFailedAttempts: 0,
      twoStepVerificationOTPBanUntil: null,
    },
  });

  // ✅ FIX: Return user info
  return successResponse({
    res,
    data: {
      accessToken,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        image: user.image,
        role: user.role,
      },
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// VERIFY ENABLE TWO-STEP VERIFICATION
// ═══════════════════════════════════════════════════════════════
export const verifyEnableTwoStepVerification = asyncHandler(
  async (req, res, next) => {
    const { email, code } = req.body;
    if (!email || !code) {
      return next(new Error("Email and code are required", { cause: 400 }));
    }
    const user = await dbService.findOne({
      model: userModel,
      filter: { email, isDeleted: false },
    });
    if (!user) {
      return next(new Error("User not found", { cause: 404 }));
    }
    if (user.twoStepVerificationOTPValidated) {
      return next(
        new Error("Two step verification already enabled", { cause: 409 }),
      );
    }
    await checkBanAndOTPStatus(user, "twoStepVerification");
    if (
      !user.twoStepVerificationOTP ||
      !compareHash({ plainText: code, hashValue: user.twoStepVerificationOTP })
    ) {
      user.twoStepVerificationOTPFailedAttempts++;
      await user.save();
      if (user.twoStepVerificationOTPFailedAttempts < 5) {
        emailEvent.emit("twoStepVerification", {
          id: user._id,
          email: user.email,
        });
        return next(
          new Error("Incorrect OTP. A new OTP has been sent to your email.", {
            cause: 401,
          }),
        );
      } else {
        return next(
          new Error("Incorrect OTP. Too many failed attempts.", { cause: 429 }),
        );
      }
    }
    if (user.twoStepVerificationOTPExpires < Date.now()) {
      return next(new Error("OTP expired", { cause: 401 }));
    }
    await dbService.updateOne({
      model: userModel,
      filter: { email },
      data: {
        twoStepVerification: true,
        twoStepVerificationOTPValidated: true,
        twoStepVerificationOTP: null,
        twoStepVerificationOTPExpires: null,
        twoStepVerificationOTPFailedAttempts: 0,
        twoStepVerificationOTPBanUntil: null,
      },
    });
    return successResponse({
      res,
      message: "Two step verification enabled successfully",
    });
  },
);

// ═══════════════════════════════════════════════════════════════
// FORGET PASSWORD
// ═══════════════════════════════════════════════════════════════
export const forgetPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new Error("Email is required", { cause: 400 }));
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { email, isDeleted: false },
  });

  if (!user) {
    return next(new Error("User not found", { cause: 404 }));
  }

  if (!user.confirmEmail) {
    return next(
      new Error("Email not confirmed. Please verify your account", {
        cause: 404,
      }),
    );
  }

  await checkBanAndOTPStatus(user, "resetPassword");

  if (user.resetPasswordOTP && user.resetPasswordOTPExpires > Date.now()) {
    return next(
      new Error("An OTP has already been sent to your email.", { cause: 429 }),
    );
  }

  emailEvent.emit("ForgetPassword", { id: user._id, email });
  return successResponse({
    res,
    message: "Reset password OTP sent successfully",
  });
});

// ═══════════════════════════════════════════════════════════════
// VALIDATE FORGET PASSWORD OTP
// ═══════════════════════════════════════════════════════════════
export const validateForgetPassword = asyncHandler(async (req, res, next) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return next(new Error("Email and OTP code are required", { cause: 400 }));
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { email, isDeleted: false },
  });

  if (!user) {
    return next(new Error("User not found", { cause: 404 }));
  }

  if (!user.confirmEmail) {
    return next(
      new Error("Email not confirmed. Please verify your account", {
        cause: 404,
      }),
    );
  }

  await checkBanAndOTPStatus(user, "resetPassword");

  if (
    !user.resetPasswordOTP ||
    !compareHash({ plainText: code, hashValue: user.resetPasswordOTP })
  ) {
    user.resetPasswordOTPFailedAttempts++;
    await user.save();

    if (user.resetPasswordOTPFailedAttempts < 5) {
      emailEvent.emit("ForgetPassword", { id: user._id, email: user.email });
      return next(
        new Error("Incorrect OTP. A new OTP has been sent to your email.", {
          cause: 401,
        }),
      );
    } else {
      return next(
        new Error("Incorrect OTP. Too many failed attempts.", { cause: 429 }),
      );
    }
  }

  await dbService.updateOne({
    model: userModel,
    filter: { email },
    data: {
      resetPasswordOTPValidated: true,
    },
  });

  return successResponse({ res, message: "OTP validated successfully" });
});

// ═══════════════════════════════════════════════════════════════
// RESET PASSWORD
// ═══════════════════════════════════════════════════════════════
export const resetPassword = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new Error("Email, and password are required", { cause: 400 }));
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { email, isDeleted: false },
  });

  if (!user) {
    return next(new Error("User not found", { cause: 404 }));
  }

  if (!user.confirmEmail) {
    return next(
      new Error("Email not confirmed. Please verify your account", {
        cause: 404,
      }),
    );
  }

  await checkBanAndOTPStatus(user, "resetPassword");

  if (!user.resetPasswordOTPValidated) {
    return next(
      new Error("OTP not validated. Please validate the OTP first.", {
        cause: 401,
      }),
    );
  }
  await dbService.updateOne({
    model: userModel,
    filter: { email },
    data: {
      password: generateHash({ plainText: password }),
      changeCredentialsTime: Date.now(),
      $unset: {
        resetPasswordOTP: 1,
        resetPasswordOTPExpires: 1,
        resetPasswordOTPFailedAttempts: 1,
        resetPasswordOTPBanUntil: 1,
        resetPasswordOTPValidated: 1,
      },
    },
  });
  return successResponse({ res, message: "Password reset successful" });
});
