import cron from "node-cron";
import userModel from "../../DB/Model/user.model.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("otp-cleaner");

export const startOTPCleanerJob = () => {
  log.info("OTP cleaner job initialized");

  // Run every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    try {
      const now = new Date();

      // ✅ FIX: Clean expired confirmEmail OTPs
      await userModel.updateMany(
        { confirmEmailOTPExpires: { $lt: now } },
        {
          $unset: {
            confirmEmailOTP: 1,
            confirmEmailOTPExpires: 1,
          },
          $set: {
            confirmEmailOTPFailedAttempts: 0,
            confirmEmailOTPBanUntil: null,
          },
        },
      );

      // ✅ FIX: Clean expired resetPassword OTPs
      await userModel.updateMany(
        { resetPasswordOTPExpires: { $lt: now } },
        {
          $unset: {
            resetPasswordOTP: 1,
            resetPasswordOTPExpires: 1,
            resetPasswordOTPValidated: 1,
          },
          $set: {
            resetPasswordOTPFailedAttempts: 0,
            resetPasswordOTPBanUntil: null,
          },
        },
      );

      // ✅ FIX: Clean expired twoStepVerification OTPs
      await userModel.updateMany(
        { twoStepVerificationOTPExpires: { $lt: now } },
        {
          $unset: {
            twoStepVerificationOTP: 1,
            twoStepVerificationOTPExpires: 1,
          },
          $set: {
            twoStepVerificationOTPFailedAttempts: 0,
            twoStepVerificationOTPBanUntil: null,
          },
        },
      );

      // ✅ FIX: Clean expired tempEmail OTPs
      await userModel.updateMany(
        { tempEmailOTPExpires: { $lt: now } },
        {
          $unset: {
            tempEmail: 1,
            tempEmailOTP: 1,
            tempEmailOTPExpires: 1,
          },
        },
      );

      // ✅ FIX: Clear expired bans
      await userModel.updateMany(
        {
          $or: [
            { confirmEmailOTPBanUntil: { $lt: now } },
            { resetPasswordOTPBanUntil: { $lt: now } },
            { twoStepVerificationOTPBanUntil: { $lt: now } },
          ],
        },
        {
          $set: {
            confirmEmailOTPBanUntil: null,
            confirmEmailOTPFailedAttempts: 0,
            resetPasswordOTPBanUntil: null,
            resetPasswordOTPFailedAttempts: 0,
            twoStepVerificationOTPBanUntil: null,
            twoStepVerificationOTPFailedAttempts: 0,
          },
        },
      );

      log.debug("expired OTPs cleaned");
    } catch (err) {
      log.error({ err }, "OTP cleaner tick failed");
    }
  });
};

export default startOTPCleanerJob;
