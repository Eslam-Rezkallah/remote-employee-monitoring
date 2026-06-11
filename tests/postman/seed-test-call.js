/**
 * tests/postman/seed-test-call.js
 *
 * Inserts a minimal Call document directly into MongoDB so the
 * /livekit-token endpoint can be exercised from Postman without
 * going through the full Socket.IO `call:initiate` dance.
 *
 * Usage:
 *   node tests/postman/seed-test-call.js <userEmail> [roomId]
 *
 * If [roomId] is omitted, the script picks the first chat room the
 * user is a member of.
 *
 * Prints the new callId on success — paste it into Postman's
 * environment under `callId`.
 *
 * This file is for local development ONLY. It uses your local
 * .env.dev via the existing config loader. Never run it against a
 * shared/production database.
 */

import "../../src/config/env.js"; // load + validate env
import mongoose from "mongoose";
import { config } from "../../src/config/index.js";
import userModel from "../../src/DB/Model/user.model.js";
import chatRoomModel from "../../src/DB/Model/chatroom.model.js";
import callModel, { callTypes, callStatus } from "../../src/DB/Model/call.model.js";

const [, , email, providedRoomId] = process.argv;

if (!email) {
  console.error("Usage: node tests/postman/seed-test-call.js <userEmail> [roomId]");
  process.exit(2);
}

function die(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

(async () => {
  await mongoose.connect(config.db.uri);
  console.log("✓ connected to mongo");

  const user = await userModel.findOne({ email, isDeleted: false }).lean();
  if (!user) die(`no user with email ${email}`);
  console.log(`✓ user: ${user._id}  (${user.username})`);

  let room;
  if (providedRoomId) {
    room = await chatRoomModel
      .findOne({ _id: providedRoomId, members: user._id, isDeleted: false })
      .lean();
    if (!room) die(`user is not a member of room ${providedRoomId}`);
  } else {
    room = await chatRoomModel
      .findOne({ members: user._id, isDeleted: false })
      .lean();
    if (!room) {
      die(
        "user has no chat rooms — create one via POST /chat/rooms/group first, " +
          "or pass an explicit roomId as the second arg",
      );
    }
  }
  console.log(`✓ room: ${room._id}  (type=${room.type})`);

  // Pick up to one other member as a second participant so the
  // Call doc looks realistic. The seeded user is always the caller.
  const others = (room.members || [])
    .map((m) => m.toString())
    .filter((id) => id !== user._id.toString())
    .slice(0, 1);

  const participants = [
    {
      userId: user._id,
      joinedAt: new Date(),
      state: "in-call",
      isCameraOff: false,
    },
    ...others.map((id) => ({
      userId: id,
      state: "ringing",
      isCameraOff: false,
    })),
  ];

  // Reject if a live call already exists — the unique partial index
  // would block us anyway. Better to surface a clear message.
  const existing = await callModel.findOne({
    chatRoomId: room._id,
    status: { $in: [callStatus.RINGING, callStatus.ACTIVE] },
  });
  if (existing) {
    console.log(
      `⚠ a live call already exists in this room: ${existing._id} (status=${existing.status})`,
    );
    console.log(`  reuse this callId, or stop it first.`);
    console.log(`\nCALL_ID=${existing._id}`);
    await mongoose.disconnect();
    return;
  }

  const call = await callModel.create({
    chatRoomId: room._id,
    organizationId: room.organizationId || null,
    callerId: user._id,
    type: callTypes.VIDEO,
    status: callStatus.RINGING,
    participants,
    // provider stays "mesh" (default). The /livekit-token endpoint
    // upgrades it to "livekit" the first time a token is issued.
  });

  console.log(`\n✓ created Call doc`);
  console.log(`  callId        = ${call._id}`);
  console.log(`  chatRoomId    = ${call.chatRoomId}`);
  console.log(`  callerId      = ${call.callerId}`);
  console.log(`  participants  = ${participants.length}`);
  console.log(`\nPaste these into the Postman environment:`);
  console.log(`  roomId = ${call.chatRoomId}`);
  console.log(`  callId = ${call._id}`);
  console.log(`\nCALL_ID=${call._id}`);

  await mongoose.disconnect();
})().catch((err) => {
  console.error("✘ seed failed:", err);
  process.exit(1);
});
