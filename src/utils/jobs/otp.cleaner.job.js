import cron from "node-cron";
import userModel from "../../DB/model/user.model.js";

export const startOTPCleanerJob = () => {
  console.log("OTP Cleaner Job Initialized...");

  cron.schedule("0 */6 * * *", async () => {
    try {
      const now = new Date();
      const result = await userModel.updateMany(
        {},
        { $pull: { OTP: { expiresIn: { $lt: now } } } }
      );
    } catch (error) {
      console.error("OTP Cleaner Error:", error.message);
    }
  });
};

export default startOTPCleanerJob;
