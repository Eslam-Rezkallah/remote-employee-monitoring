import axios from "axios"; //lib that can talk to googles services
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
import { createSession } from "./session.service.js";

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
// login with email password
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
    const existingUser = await dbService.findOne({
      model: userModel,
      filter: { email },
    });
    if (existingUser) {
      return next(
        new Error("Account registered with another provider (e.g., Google).", {
          cause: 401,
        }),
      );
    } else {
      return next(new Error("Invalid credentials", { cause: 401 }));
    }
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
    return successResponse(
      { res, data: { requiresOTP: true } }, // go validate OTP
      200,
    );
  }

  const { accessToken, refreshToken } = await createSession({ user, req });

  return successResponse(
    {
      res,
      data: {
        accessToken,
        refreshToken,
      },
    },
    200,
  );
});

////////////////////////////////////////////////////////////////////////front end way
// export const loginWithGmail = asyncHandler(async (req, res, next) => {
//   const { idToken } = req.body; // Sent from frontend (Flutter/React/etc.)
//   if (!idToken) return next(new Error("idToken is required", { cause: 400 }));

//   const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

//   async function verify() {
//     const ticket = await client.verifyIdToken({
//       idToken,
//       audience: process.env.GOOGLE_CLIENT_ID,
//     });
//     return ticket.getPayload();
//   }

//   const payload = await verify();

//   if (!payload.email_verified) {
//     return next(new Error("Email not verified by Google", { cause: 401 }));
//   }

//   // Check if user exists
//   let user = await dbService.findOne({
//     model: userModel,
//     filter: { email: payload.email },
//   });

//   if (!user) {
//     // Create new user if they don't exist
//     user = await dbService.create({
//       model: userModel,
//       data: {
//         username: payload.name,
//         email: payload.email,
//         image: { secure_url: payload.picture }, // Matching your schema's image object structure
//         confirmEmail: true,
//         provider: providerTypes.Google,
//         role: roleTypes.Member
//       },
//     });
//   }

//   // Security check: Don't let someone login via Google if they originally signed up via Email
//   if (user.provider !== providerTypes.Google) {
//     return next(new Error("This email is registered via another provider. Please login manually.", { cause: 409 }));
//   }

//   // Check 2FA (Using your existing logic)
//   if (user.twoStepVerification) {
//     emailEvent.emit("twoStepVerification", { id: user._id, email: user.email });
//     return successResponse({ res, data: { requiresOTP: true } }, 200);
//   }

//   // Generate Token (Using your existing signature logic)
//   const accessToken = generateToken({
//     payload: { id: user._id },
//     signature: user.role === roleTypes.Admin ? process.env.ADMIN_ACCESS_TOKEN : process.env.USER_ACCESS_TOKEN,
//   });

//   return successResponse({ res, data: { accessToken } }, 200);
// });

/////////////////////////////////////////////////////////////////////////////////////////////////backend test , @eslam remove when adding frontend to google oauth
// STEP 1: This is what triggers when you visit /auth/loginWithGmail in the browser
export const loginWithGmail = asyncHandler(async (req, res, next) => {
  const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";
  const options = {
    redirect_uri: process.env.GOOGLE_CALLBACK_URL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    access_type: "offline",
    response_type: "code",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
  };

  const queryString = new URLSearchParams(options).toString();
  return res.redirect(`${rootUrl}?${queryString}`);
});

// STEP 2: This is what Google calls after the user logs in
export const googleCallback = asyncHandler(async (req, res, next) => {
  const { code } = req.query; // Google sends a temporary 'code'

  if (!code) {
    return next(new Error("Google authorization failed", { cause: 400 }));
  }

  // A. Exchange the 'code' for an access token
  const { data } = await axios.post("https://oauth2.googleapis.com/token", {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_CALLBACK_URL,
    grant_type: "authorization_code",
  });

  // B. Get the user info from Google using that token
  const { data: googleUser } = await axios.get(
    `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${data.access_token}`,
  );

  // C. Find or Create the user (Reuse your existing database logic)
  let user = await dbService.findOne({
    model: userModel,
    filter: { email: googleUser.email },
  });

  if (!user) {
    user = await dbService.create({
      model: userModel,
      data: {
        username: googleUser.name,
        email: googleUser.email,
        image: { secure_url: googleUser.picture },
        confirmEmail: googleUser.email_verified,
        provider: providerTypes.Google,
        role: roleTypes.Member,
      },
    });
  }

  // D. Security Check (Reuse your existing provider check)
  if (user.provider !== providerTypes.Google) {
    return next(
      new Error("This email is registered via another provider.", {
        cause: 409,
      }),
    );
  }

  // E. Handle 2FA (Reuse your existing logic)
  if (user.twoStepVerification) {
    emailEvent.emit("twoStepVerification", { id: user._id, email: user.email });
    return successResponse({ res, data: { requiresOTP: true } }, 200);
  }

  // F. Create session and respond
  const { accessToken, refreshToken } = await createSession({ user, req });

  return successResponse({ res, data: { accessToken, refreshToken } }, 200);
});
/////////////////////////////////////////////////////////////////////////////////////////////////backend test , @eslam remove when adding frontend to google oauth
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

  const { accessToken, refreshToken } = await createSession({ user, req });

  return successResponse({ res, data: { accessToken, refreshToken } }, 200);
});

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
    return successResponse(
      { res, message: "Two step verification enabled successfully" },
      200,
    );
  },
);

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
  return successResponse(
    { res, message: "Reset password OTP sent successfully" },
    200,
  );
});

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

  return successResponse({ res, message: "OTP validated successfully" }, 200);
});

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
  return successResponse({ res, message: "Password reset successful" }, 200);
});

export const refreshToken = asyncHandler(async (req, res, next) => {
  const { authorization } = req.headers;

  const user = await decodedToken({
    authorization,
    tokenType: tokenTypes.refresh,
    next,
  });

  if (!user) {
    return next(
      new Error("User not found or token is invalid", { cause: 401 }),
    );
  }

  const dbUser = await dbService.findOne({
    model: userModel,
    filter: { _id: user._id },
  });

  if (!dbUser) {
    return next(new Error("User not found", { cause: 404 }));
  }

  if (user.iat * 1000 < dbUser.changeCredentialsTime) {
    return next(
      new Error("Refresh token is invalid. Please log in again.", {
        cause: 401,
      }),
    );
  }

  const accessToken = generateToken({
    payload: { id: user._id },
    signature:
      user.role === roleTypes.admin
        ? process.env.ADMIN_ACCESS_TOKEN
        : process.env.USER_ACCESS_TOKEN,
  });

  const refreshToken = generateToken({
    payload: { id: user._id },
    signature:
      user.role === roleTypes.admin
        ? process.env.ADMIN_REFRESH_TOKEN
        : process.env.USER_REFRESH_TOKEN,
    expiresIn: 31536000,
  });

  return successResponse(
    { res, data: { token: { accessToken, refreshToken } } },
    200,
  );
});
