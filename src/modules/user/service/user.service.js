import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import * as dbService from "../../../DB/db.service.js";
import userModel, { roleTypes } from "../../../DB/Model/user.model.js";
import { emailEvent } from "../../../utils/events/email.event.js";
import {
  compareHash,
  generateHash,
} from "../../../utils/security/hash.security.js";
import { cloud } from "../../../utils/multer/cloudinary.multer.js";
import { httpError } from "../../../utils/errors/index.js";

// Get user profile
export const profile = asyncHandler(async (req, res, next) => {
  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: req.user._id, isDeleted: false },
    populate: [
      {
        path: "teams",
        select: "name createdAt",
      },
      {
        path: "managedProjects",
        select: "title status",
      },
      {
        path: "assignedTasks",
        select: "title status priority dueDate",
      },
      {
        path: "supervisedBy",
        select: "username email image",
      },
    ],
  });

  if (!user) {
    return next(httpError(404, "User not found"));
  }

  return successResponse({ res, data: { user } });
});

// Share profile (view another user's profile)
export const shareProfile = asyncHandler(async (req, res, next) => {
  const { profileId } = req.params;

  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: profileId, isDeleted: false },
    select: "username email image role teams createdAt",
    populate: [
      {
        path: "teams",
        select: "name",
      },
    ],
  });

  if (!user) {
    return next(httpError(404, "User not found"));
  }

  // Send email notification to the profile owner
  emailEvent.emit("sendProfileViewEmail", {
    id: user._id,
    email: user.email,
    username: user.username,
    dates: new Date().toLocaleDateString(),
  });

  return successResponse({
    res,
    data: { user },
    message: "Profile viewed successfully",
  });
});

// Update profile image
export const updateProfileImage = asyncHandler(async (req, res, next) => {
  if (!req.file) {
    return next(httpError(400, "No file uploaded"));
  }

  // Upload to Cloudinary
  const { secure_url, public_id } = await cloud.uploader.upload(req.file.path, {
    folder: `${process.env.APP_NAME}/user/${req.user._id}/profile`,
  });

  // Get old image to delete
  const oldUser = await dbService.findOne({
    model: userModel,
    filter: { _id: req.user._id },
  });

  // Update user with new image
  const user = await dbService.findOneAndUpdate({
    model: userModel,
    filter: { _id: req.user._id },
    data: { image: { secure_url, public_id } },
    options: { new: true },
  });

  // Delete old image from Cloudinary
  if (oldUser.image?.public_id) {
    await cloud.uploader.destroy(oldUser.image.public_id);
  }

  return successResponse({
    res,
    data: { user },
    message: "Profile image updated successfully",
  });
});

// Update profile info
export const updateProfile = asyncHandler(async (req, res, next) => {
  const { username, gender, DOB, address, phone } = req.body;

  // Check if username is taken by another user
  if (username) {
    const existingUser = await dbService.findOne({
      model: userModel,
      filter: {
        username,
        _id: { $ne: req.user._id },
        isDeleted: false,
      },
    });

    if (existingUser) {
      return next(httpError(409, "Username already taken"));
    }
  }

  const updateData = {};
  if (username) updateData.username = username;
  if (gender) updateData.gender = gender;
  if (DOB) updateData.DOB = DOB;
  if (address) updateData.address = address;
  if (phone) updateData.phone = phone;

  const user = await dbService.findOneAndUpdate({
    model: userModel,
    filter: { _id: req.user._id },
    data: updateData,
    options: { new: true },
  });

  return successResponse({
    res,
    data: { user },
    message: "Profile updated successfully",
  });
});

// Update email (Step 1: Request email change)
export const updateEmail = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  // Check if new email already exists
  const existingUser = await dbService.findOne({
    model: userModel,
    filter: { email, isDeleted: false },
  });

  if (existingUser) {
    return next(httpError(409, "Email already exists"));
  }

  // Store temporary email
  await dbService.updateOne({
    model: userModel,
    filter: { _id: req.user._id },
    data: { tempEmail: email },
  });

  // Send OTP to old email
  emailEvent.emit("sendConfirmationEmail", {
    id: req.user._id,
    email: req.user.email,
  });

  // Send OTP to new email
  emailEvent.emit("updateEmail", {
    id: req.user._id,
    email: email,
  });

  return successResponse({
    res,
    message: "Verification codes sent to both emails",
  });
});

// Reset email (Step 2: Verify both codes)
export const resetEmail = asyncHandler(async (req, res, next) => {
  const { oldCode, newCode } = req.body;

  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: req.user._id },
  });

  // Verify old email code
  if (
    !user.confirmEmailOTP ||
    !compareHash({
      plainText: oldCode,
      hashValue: user.confirmEmailOTP,
    })
  ) {
    return next(httpError(400, "Invalid code for old email"));
  }

  // Verify new email code
  if (
    !user.tempEmailOTP ||
    !compareHash({
      plainText: newCode,
      hashValue: user.tempEmailOTP,
    })
  ) {
    return next(httpError(400, "Invalid code for new email"));
  }

  // Update email
  await dbService.updateOne({
    model: userModel,
    filter: { _id: req.user._id },
    data: {
      email: user.tempEmail,
      changeCredentialsTime: Date.now(),
      $unset: {
        tempEmail: 1,
        tempEmailOTP: 1,
        tempEmailOTPExpires: 1,
        confirmEmailOTP: 1,
        confirmEmailOTPExpires: 1,
      },
    },
  });

  return successResponse({
    res,
    message: "Email updated successfully. Please login again",
  });
});

// Update password
export const updatePassword = asyncHandler(async (req, res, next) => {
  const { oldPassword, password } = req.body;

  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: req.user._id },
    select: "+password",
  });

  // Verify old password
  if (!compareHash({ plainText: oldPassword, hashValue: user.password })) {
    return next(httpError(400, "Old password is incorrect"));
  }

  // Update password
  await dbService.updateOne({
    model: userModel,
    filter: { _id: req.user._id },
    data: {
      password: generateHash({ plainText: password }),
      changeCredentialsTime: Date.now(),
    },
  });

  return successResponse({
    res,
    message: "Password updated successfully. Please login again",
  });
});

// Enable Two-Step Verification
export const enableTwoStepVerification = asyncHandler(
  async (req, res, next) => {
    const { email } = req.body;

    const user = await dbService.findOne({
      model: userModel,
      filter: { _id: req.user._id, email, isDeleted: false },
    });

    if (!user) {
      return next(
        httpError(404, "User not found or email mismatch"),
      );
    }

    if (user.twoStepVerification) {
      return next(
        httpError(400, "Two-step verification is already enabled"),
      );
    }

    // Check if OTP was recently sent
    if (
      user.twoStepVerificationOTP &&
      user.twoStepVerificationOTPExpires > Date.now()
    ) {
      return next(
        httpError(429, "OTP already sent. Please wait before requesting a new one."),
      );
    }

    // Send OTP
    emailEvent.emit("twoStepVerification", { id: user._id, email });

    return successResponse({
      res,
      message: "Two-step verification OTP sent to your email",
    });
  },
);

// Disable Two-Step Verification
export const disabledTwoStepVerification = asyncHandler(
  async (req, res, next) => {
    const { email } = req.body;

    const user = await dbService.findOne({
      model: userModel,
      filter: { _id: req.user._id, email, isDeleted: false },
    });

    if (!user) {
      return next(
        httpError(404, "User not found or email mismatch"),
      );
    }

    if (!user.twoStepVerification) {
      return next(
        httpError(400, "Two-step verification is already disabled"),
      );
    }

    // Disable 2FA
    await dbService.updateOne({
      model: userModel,
      filter: { _id: req.user._id },
      data: {
        twoStepVerification: false,
        twoStepVerificationOTPValidated: false,
        $unset: {
          twoStepVerificationOTP: 1,
          twoStepVerificationOTPExpires: 1,
        },
      },
    });

    return successResponse({
      res,
      message: "Two-step verification disabled successfully",
    });
  },
);

// Change user role (Admin only)
export const changeRoles = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { role } = req.body;

  // Only admin can change roles
  if (req.user.role !== roleTypes.Admin) {
    return next(httpError(403, "Only admins can change user roles"));
  }

  // Validate role
  if (!Object.values(roleTypes).includes(role)) {
    return next(httpError(400, "Invalid role"));
  }

  // Cannot change own role
  if (userId === req.user._id.toString()) {
    return next(httpError(400, "Cannot change your own role"));
  }

  const user = await dbService.findByIdAndUpdate({
    model: userModel,
    id: userId,
    data: { role },
    options: { new: true },
    select: "username email role",
  });

  if (!user) {
    return next(httpError(404, "User not found"));
  }

  return successResponse({
    res,
    message: "User role updated successfully",
    data: { user },
  });
});

// Get user dashboard stats
export const dashboard = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Get user with populated data
  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: userId },
    populate: [
      { path: "teams", select: "name" },
      { path: "managedProjects", select: "title status" },
      { path: "assignedTasks", select: "title status priority dueDate" },
    ],
  });

  // Calculate statistics
  const stats = {
    totalTeams: user.teams.length,
    totalManagedProjects: user.managedProjects.length,
    totalAssignedTasks: user.assignedTasks.length,
    activeProjects: user.managedProjects.filter((p) => p.status === "Active")
      .length,
    todoTasks: user.assignedTasks.filter((t) => t.status === "To Do").length,
    inProgressTasks: user.assignedTasks.filter(
      (t) => t.status === "In Progress",
    ).length,
    doneTasks: user.assignedTasks.filter((t) => t.status === "Done").length,
    highPriorityTasks: user.assignedTasks.filter((t) => t.priority === "High")
      .length,
    overdueTasks: user.assignedTasks.filter(
      (t) =>
        t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Done",
    ).length,
  };

  return successResponse({
    res,
    data: {
      stats,
      user: {
        username: user.username,
        email: user.email,
        role: user.role,
        image: user.image,
      },
    },
  });
});
/*
export const getFriends = asyncHandler(async (req, res, next) => {
  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: req.user._id },
    populate: {
      path: "friends",
      select: "firstName lastName email",
    },
  });

  return successResponse({
    res,
    data: { friends: user.friends },
  });
});
*/

export const getProjectMembers = asyncHandler(async (req, res, next) => {
  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: req.user._id },
    populate: {
      path: "teams",
      select: "members",
      populate: {
        path: "members",
        select: "username email image",
      },
    },
  });

  if (!user) {
    return next(httpError(404, "User not found"));
  }

  const members = [];
  user.teams.forEach((team) => {
    team.members.forEach((member) => {
      if (!members.some((m) => m._id.toString() === member._id.toString())) {
        members.push(member);
      }
    });
  });

  return successResponse({
    res,
    data: { members },
  });
});
export const toggleReadReceipts = asyncHandler(async (req, res, next) => {
  const { enabled } = req.body;

  const user = await dbService.findOneAndUpdate({
    model: userModel,
    filter: { _id: req.user._id },
    data: { readReceipts: enabled },
    options: { new: true },
    select: "readReceipts",
  });

  if (!user) {
    return next(httpError(404, "User not found"));
  }

  return successResponse({
    res,
    message: `Read receipts ${enabled ? "enabled" : "disabled"}`,
    data: { readReceipts: user.readReceipts },
  });
});
 