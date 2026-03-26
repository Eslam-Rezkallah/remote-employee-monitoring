import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const chatRoomTypes = {
  direct: "direct",
  team: "team",
  organization: "organization",
  channel: "channel",
  group: "group",
};

const chatRoomSchema = new Schema(
  {
    // ── Identity ──────────────────────────────────────────────
    name: { type: String, trim: true, maxlength: 100, default: null },
    description: { type: String, trim: true, maxlength: 500, default: null },
    icon: { type: String, default: null },

    // ── Type ──────────────────────────────────────────────────
    type: {
      type: String,
      enum: Object.values(chatRoomTypes),
      required: true,
    },

    // ── Scope (at least one required based on type) ────────────
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    teamId: { type: Types.ObjectId, ref: "Team", default: null },
    projectId: { type: Types.ObjectId, ref: "Project", default: null },

    // ── Members ───────────────────────────────────────────────
    members: [{ type: Types.ObjectId, ref: "User" }],
    // admins: group/channel moderators (subset of members)
    admins: [{ type: Types.ObjectId, ref: "User" }],

    // ── Ownership ─────────────────────────────────────────────
    createdBy: { type: Types.ObjectId, ref: "User", required: true },

    // ── Settings ──────────────────────────────────────────────
    isPrivate: { type: Boolean, default: false },

    // ── Last message (for sidebar preview) ────────────────────
    lastMessage: { type: Types.ObjectId, ref: "Message", default: null },
    lastMessageAt: { type: Date, default: null },

    // ── Soft-delete / archive ─────────────────────────────────
    isArchived: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ── Indexes ────────────────────────────────────────────────────
chatRoomSchema.index({ members: 1, isDeleted: 1 });
chatRoomSchema.index({ organizationId: 1, type: 1, isDeleted: 1 });
chatRoomSchema.index({ teamId: 1, type: 1, isDeleted: 1 });
chatRoomSchema.index({ projectId: 1, type: 1, isDeleted: 1 });
chatRoomSchema.index({ organizationId: 1, isDeleted: 1, lastMessageAt: -1 });
chatRoomSchema.set("strictPopulate", false);

const chatRoomModel =
  mongoose.models.ChatRoom || model("ChatRoom", chatRoomSchema);

export default chatRoomModel;
