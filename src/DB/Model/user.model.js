import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const roleTypes = {
  Admin: "Admin",
  Manager: "Manager",
  Member: "Member",
};

export const providerTypes = {
  System: "System",
  Google: "Google",
  Github: "Github",
};

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
   password: {
  type: String,
  required: function () {
    return this.provider === providerTypes.system;
  },
},
    phone: {
      type: String,
      trim: true,
    },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },
    DOB: {
      type: Date,
    },
    address: {
      type: String,
      trim: true,
    },
    provider: {
      type: String,
      enum: Object.values(providerTypes),
      default: providerTypes.System,
    },
    role: {
      type: String,
      enum: Object.values(roleTypes),
      default: roleTypes.Member,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    image: {
      secure_url: String,
      public_id: String,
    },

    // Relations
    teams: [{ type: Types.ObjectId, ref: "Team" }],
    managedProjects: [{ type: Types.ObjectId, ref: "Project" }],
    assignedTasks: [{ type: Types.ObjectId, ref: "Task" }],
    supervisedBy: { type: Types.ObjectId, ref: "User" },

    // Email Confirmation
    confirmEmail: {
      type: Boolean,
      default: false,
    },
    confirmEmailOTP: String,
    confirmEmailOTPExpires: Date,
    confirmEmailOTPFailedAttempts: {
      type: Number,
      default: 0,
    },
    confirmEmailOTPBanUntil: Date,

    // Reset Password
    resetPasswordOTP: String,
    resetPasswordOTPExpires: Date,
    resetPasswordOTPFailedAttempts: {
      type: Number,
      default: 0,
    },
    resetPasswordOTPBanUntil: Date,
    resetPasswordOTPValidated: {
      type: Boolean,
      default: false,
    },

    // Two Step Verification
    twoStepVerification: {
      type: Boolean,
      default: false,
    },
    twoStepVerificationOTP: String,
    twoStepVerificationOTPExpires: Date,
    twoStepVerificationOTPFailedAttempts: {
      type: Number,
      default: 0,
    },
    twoStepVerificationOTPBanUntil: Date,
    twoStepVerificationOTPValidated: {
      type: Boolean,
      default: false,
    },

    // Email Update
    tempEmail: String,
    tempEmailOTP: String,
    tempEmailOTPExpires: Date,

    // Security
    changeCredentialsTime: Date,
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual for full name (if you want to add firstName, lastName later)
userSchema.virtual("fullName").get(function () {
  return this.username;
});

// Index for performance
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ teams: 1 });
userSchema.index({ role: 1 });

const userModel = mongoose.models.User || model("User", userSchema);

export default userModel;
export const socketConnection = new Map();