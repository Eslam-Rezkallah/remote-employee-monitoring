import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const channelTabTypes = {
  Files: "files",
  Wiki: "wiki",
  Tasks: "tasks",
  Pinned: "pinned",
  App: "app", // generic — points to a 3rd-party integration / iframe
  Custom: "custom",
};

/**
 * ChannelTab — Teams-style horizontal tabs at the top of a channel.
 *
 * Every channel implicitly has the "Conversation" tab (the chat). Extra
 * tabs let you bolt content onto the same channel context:
 *   - Files       → a curated file picker that filters the room's attachments
 *   - Wiki        → markdown notes that the team edits together (raw, not Yjs yet)
 *   - Tasks       → an embedded view of a Space/Task query
 *   - Pinned      → shows the pinned messages list
 *   - App         → embeds an external URL (whitelisted origins only)
 *   - Custom      → free-form content blob
 *
 * Tabs are ORDERED — `order` controls the visual position. Reordering
 * is a single PATCH that rewrites the field for every tab in the room.
 */
const channelTabSchema = new Schema(
  {
    chatRoomId: {
      type: Types.ObjectId,
      ref: "ChatRoom",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    type: {
      type: String,
      enum: Object.values(channelTabTypes),
      required: true,
    },

    // Free-form per-type config. We keep it Mixed so we don't have to
    // bump the schema every time someone adds a new tab kind.
    // Documented shapes per type:
    //   files  → { } (uses the room's attachments)
    //   wiki   → { content: string }
    //   tasks  → { spaceId, filter: { status, assigneeId, ... } }
    //   app    → { url, allowedOrigins: string[] }
    //   custom → free-form
    config: { type: Schema.Types.Mixed, default: {} },

    order: { type: Number, default: 0 },
    createdBy: { type: Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Listing tabs in order for a room.
channelTabSchema.index(
  { chatRoomId: 1, isDeleted: 1, order: 1 },
);
// Unique name per room — UI bug if two tabs share the title.
channelTabSchema.index(
  { chatRoomId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

const channelTabModel =
  mongoose.models.ChannelTab || model("ChannelTab", channelTabSchema);

export default channelTabModel;
