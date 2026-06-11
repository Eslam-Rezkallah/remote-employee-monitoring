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
    name: { type: String, trim: true, maxlength: 100, default: null },
    description: { type: String, trim: true, maxlength: 500, default: null },
    icon: { type: String, default: null },

    // ── Branding (Slack-style per-channel customization) ────────
    // All optional. Empty string clears, omitted leaves alone.
    branding: {
      // Hex color used as the channel header background in the FE.
      // Validated by Joi (#RRGGBB) at write time so we trust it on read.
      color: { type: String, default: null },
      // Cloudinary URL — separate from `icon` because FE often shows
      // a square avatar AND a wide cover image side by side.
      coverImage: { type: String, default: null },
      // Free-form one-liner shown under the channel name. Different
      // from `description` which is the longer "about this channel" blob.
      tagline: { type: String, trim: true, maxlength: 140, default: null },
      // 1-line topic the room is currently focused on. Slack lets
      // anyone with write access edit this.
      topic: { type: String, trim: true, maxlength: 250, default: null },
    },

    type: {
      type: String,
      enum: Object.values(chatRoomTypes),
      required: true,
    },

    // FIX: organizationId is now REQUIRED for all room types except legacy.
    //      DMs also get an organizationId so they can be scoped properly.
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    teamId: { type: Types.ObjectId, ref: "Team", default: null },
    projectId: { type: Types.ObjectId, ref: "Project", default: null },

    members: [{ type: Types.ObjectId, ref: "User" }],
    admins: [{ type: Types.ObjectId, ref: "User" }],

    createdBy: { type: Types.ObjectId, ref: "User", required: true },

    isPrivate: { type: Boolean, default: false },

    lastMessage: { type: Types.ObjectId, ref: "Message", default: null },
    lastMessageAt: { type: Date, default: null },

    // FIX: removed `unreadCounts` Map field.
    //      Unread counts are computed via message aggregation in
    //      message.service.js → getUnreadCounts(). The map was written
    //      by the socket layer but never read by the REST endpoint,
    //      creating two competing systems that drifted apart.

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
