/**
 * Migration: Clean up removed fields from existing documents
 *
 * Removes:
 *   1. Organization.members (string array) — replaced by Member collection
 *   2. ChatRoom.unreadCounts (Map) — replaced by message aggregation
 *
 * Run ONCE after deploying the updated models.
 *
 * Usage:
 *   node src/migrations/cleanup-removed-fields.js
 */

import mongoose from "mongoose";
import path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve("./src/config/.env.dev") });

const DB_URI = process.env.DB_URI;
if (!DB_URI) {
  console.error("DB_URI not set. Check your .env file.");
  process.exit(1);
}

async function run() {
  await mongoose.connect(DB_URI);
  console.log("Connected to database.");

  // ── 1. Remove Organization.members string array ─────────────
  const Org = mongoose.connection.collection("organizations");

  const orgResult = await Org.updateMany(
    { members: { $exists: true } },
    { $unset: { members: "" } },
  );

  console.log(
    `Organizations: removed 'members' field from ${orgResult.modifiedCount} document(s).`,
  );

  // ── 2. Remove ChatRoom.unreadCounts map ─────────────────────
  const ChatRoom = mongoose.connection.collection("chatrooms");

  const chatResult = await ChatRoom.updateMany(
    { unreadCounts: { $exists: true } },
    { $unset: { unreadCounts: "" } },
  );

  console.log(
    `ChatRooms: removed 'unreadCounts' field from ${chatResult.modifiedCount} document(s).`,
  );

  console.log("\nCleanup complete.");
  await mongoose.disconnect();
  console.log("Disconnected.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
