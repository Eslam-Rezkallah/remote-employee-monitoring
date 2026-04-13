/**
 * Migration: Add organizationId to existing teams
 *
 * Run ONCE after deploying the updated Team model.
 *
 * Strategy:
 *   For each team without organizationId, look at the team creator's
 *   membership records and assign the team to their first active org.
 *   If no org is found, the team is flagged for manual review.
 *
 * Usage:
 *   node src/migrations/add-org-to-teams.js
 *
 * Make sure your .env is loaded (DB_URI must be set).
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

  const Team = mongoose.connection.collection("teams");
  const Member = mongoose.connection.collection("members");

  // Find all teams that don't have organizationId set
  const teamsWithoutOrg = await Team.find({
    $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
    isDeleted: { $ne: true },
  }).toArray();

  console.log(
    `Found ${teamsWithoutOrg.length} team(s) without organizationId.`,
  );

  if (teamsWithoutOrg.length === 0) {
    console.log("Nothing to migrate.");
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  let skipped = 0;
  const skippedTeams = [];

  for (const team of teamsWithoutOrg) {
    // Look up the creator's org membership
    const membership = await Member.findOne({
      userId: team.createdBy,
      isActive: true,
    });

    if (membership?.organizationId) {
      await Team.updateOne(
        { _id: team._id },
        { $set: { organizationId: membership.organizationId } },
      );
      updated++;
      console.log(
        `  ✓ Team "${team.name}" (${team._id}) → Org ${membership.organizationId}`,
      );
    } else {
      skipped++;
      skippedTeams.push({ id: team._id, name: team.name });
      console.log(
        `  ✗ Team "${team.name}" (${team._id}) — creator has no active org membership. Needs manual assignment.`,
      );
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);

  if (skippedTeams.length > 0) {
    console.log("\nTeams that need manual organizationId assignment:");
    skippedTeams.forEach((t) => console.log(`  - ${t.name} (${t.id})`));
    console.log(
      "\nRun this in mongo shell for each:\n" +
        '  db.teams.updateOne({ _id: ObjectId("TEAM_ID") }, { $set: { organizationId: ObjectId("ORG_ID") } })',
    );
  }

  await mongoose.disconnect();
  console.log("Disconnected.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
