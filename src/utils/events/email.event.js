import { customAlphabet } from "nanoid";
import { EventEmitter } from "node:events";
import { generateHash } from "../security/hash.security.js";
import userModel from "../../DB/Model/user.model.js";
import { sendEmail } from "../email/send.email.js";
import { verifyAccountTemplate } from "../email/template/verifyAccount.template.js";
import * as dbService from "../../DB/db.service.js";


export const emailEvent = new EventEmitter();

export const emailSubject = {
  verifyAccount: "Verify Your Email",
  resetPassword: "Reset Your Password",
  updateEmail: "Update Your Email",
  twoStepVerification: "Two Step Verification",
};

export const sendCode = async ({
  data = {},
  subject = emailSubject.verifyAccount,
} = {}) => {
  const { id, email, username, dates } = data;
  const otp = customAlphabet("0123456789", 5)();
  const hashOTP = generateHash({ plainText: otp });
  let updateData = {};

  switch (subject) {
    case emailSubject.verifyAccount:
      updateData = {
        confirmEmailOTP: hashOTP,
        confirmEmailOTPExpires: Date.now() + 120000,
      };
      break;

    case emailSubject.resetPassword:
      updateData = {
        resetPasswordOTP: hashOTP,
        resetPasswordOTPExpires: Date.now() + 120000,
      };
      break;
    case emailSubject.updateEmail:
      updateData = {
        tempEmailOTP: hashOTP,
        tempEmailOTPExpires: Date.now() + 120000,
      };
      break;
    case emailSubject.twoStepVerification:
      updateData = {
        twoStepVerificationOTP: hashOTP,
        twoStepVerificationOTPExpires: Date.now() + 120000,
      };
      break;
    default:
      throw new Error("Invalid email subject");
  }

  let html;
  html = verifyAccountTemplate({ code: otp });
  await dbService.updateOne({
    model: userModel,
    filter: { _id: id },
    data: updateData,
  });
  await sendEmail({ to: email, subject, html });
  
};

emailEvent.on("sendConfirmationEmail", async (data) => {
  await sendCode({ data, subject: emailSubject.verifyAccount });
});

emailEvent.on("ForgetPassword", async (data) => {
  await sendCode({ data, subject: emailSubject.resetPassword });
});

emailEvent.on("updateEmail", async (data) => {
  await sendCode({ data, subject: emailSubject.updateEmail });
});

emailEvent.on("twoStepVerification", async (data) => {
  await sendCode({ data, subject: emailSubject.twoStepVerification });
});
