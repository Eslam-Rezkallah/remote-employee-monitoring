/**
 * modules/message/slash/built-ins.js
 *
 * Default slash commands. Import this file once at boot to register
 * everything (see App.controller).
 *
 *   /me <action>      ←  Slack-style "*Maitha is typing*"
 *   /shrug            ←  posts ¯\_(ツ)_/¯
 *   /remind <when> <text>  ←  uses ScheduledMessage to nudge yourself later
 *   /help             ←  lists available commands
 *   /pin <messageId>  ←  pin by ID without the UI
 */

import scheduledMessageModel from "../../../DB/Model/scheduledMessage.model.js";
import messageModel from "../../../DB/Model/message.model.js";
import reminderModel from "../../../DB/Model/reminder.model.js";
import {
  registerSlash,
  listSlashCommands,
} from "../../../utils/slash/slash.registry.js";

registerSlash({
  name: "me",
  description: "Post an action in italic ('*Maitha is brewing coffee*')",
  usage: "/me <action>",
  handler: async ({ args, user }) => {
    const text = args.join(" ").trim();
    if (!text) {
      return { replyToUser: "Usage: /me <action>", suppressMessage: true };
    }
    return {
      // We mark it as an italic-formatted system-ish message. The FE
      // can render `_text_` as italic. Kept simple — no markdown engine.
      broadcast: `_${user.username} ${text}_`,
      suppressMessage: true,
    };
  },
});

registerSlash({
  name: "shrug",
  description: "Posts ¯\\_(ツ)_/¯",
  usage: "/shrug [comment]",
  handler: async ({ args }) => {
    const tail = args.join(" ").trim();
    const text = tail ? `${tail} ¯\\_(ツ)_/¯` : "¯\\_(ツ)_/¯";
    return { broadcast: text, suppressMessage: true };
  },
});

registerSlash({
  name: "help",
  description: "List available slash commands",
  usage: "/help",
  handler: async () => {
    const cmds = listSlashCommands();
    const text =
      "Available commands:\n" +
      cmds.map((c) => `  ${c.usage} — ${c.description}`).join("\n");
    return { replyToUser: text, suppressMessage: true };
  },
});

registerSlash({
  name: "remind",
  description:
    "Schedule a reminder. Use 'in 5m', 'in 2h', 'in 1d' (no calendar dates yet).",
  usage: "/remind <when> <message>",
  handler: async ({ args, user, room }) => {
    // Grammar: /remind in <n><unit> <message…>
    if (args.length < 3 || args[0].toLowerCase() !== "in") {
      return {
        replyToUser: "Usage: /remind in <n><m|h|d> <message>",
        suppressMessage: true,
      };
    }
    const duration = parseDuration(args[1]);
    if (!duration) {
      return {
        replyToUser: "Couldn't parse duration. Examples: 5m, 2h, 1d",
        suppressMessage: true,
      };
    }
    const triggerAt = new Date(Date.now() + duration);
    const text = args.slice(2).join(" ");

    // Private reminder model — pushes a notification to the creator
    // only, NOT a chat broadcast (Slack behavior). The reminders cron
    // dispatches via notification.event.
    await reminderModel.create({
      userId: user._id,
      text,
      triggerAt,
      sourceRoomId: room._id,
    });

    return {
      replyToUser: `OK — I'll remind you privately at ${triggerAt.toISOString()}. Manage with GET /me/reminders.`,
      suppressMessage: true,
    };
  },
});

registerSlash({
  name: "pin",
  description: "Pin a message by id (without using the UI)",
  usage: "/pin <messageId>",
  can: ({ user, room }) =>
    // Sender or room admin can pin (matches the REST endpoint policy).
    (room.admins || []).some((a) => a.toString() === String(user._id)) ||
    true, // The handler also re-checks "is this user the sender of the target message"
  handler: async ({ args, user, room }) => {
    const id = args[0];
    if (!id) return { replyToUser: "Usage: /pin <messageId>", suppressMessage: true };

    const target = await messageModel.findOne({
      _id: id,
      chatRoomId: room._id,
      deletedForEveryone: false,
    });
    if (!target) {
      return { replyToUser: "Message not found in this room.", suppressMessage: true };
    }

    const isSender = target.senderId.toString() === String(user._id);
    const isAdmin = (room.admins || []).some(
      (a) => a.toString() === String(user._id),
    );
    if (!isSender && !isAdmin) {
      return {
        replyToUser: "Only the sender or a room admin can pin.",
        suppressMessage: true,
      };
    }

    target.pinnedBy = user._id;
    target.pinnedAt = new Date();
    await target.save();

    return {
      broadcast: `📌 ${user.username} pinned a message`,
      suppressMessage: true,
    };
  },
});

function parseDuration(token) {
  const m = /^(\d+)(s|m|h|d)$/i.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mul = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * mul;
}
