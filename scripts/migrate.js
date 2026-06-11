#!/usr/bin/env node
/**
 * scripts/migrate.js
 *
 * Minimal forward-only migration runner.
 *
 *   node scripts/migrate.js          → apply every pending migration
 *   node scripts/migrate.js --status → list applied + pending
 *   node scripts/migrate.js --dry    → show what would run, don't apply
 *
 * Migration file contract:
 *   • Lives in src/migrations/
 *   • Filename starts with a sortable timestamp / sequence prefix
 *     (e.g., `2026-06-10-add-org-to-teams.js`)
 *   • Default export is an async function `up(db, mongoose)`
 *   • Runs to completion or throws — partial-failure recovery is
 *     YOUR responsibility (idempotent operations recommended)
 *   • No `down()` — this is forward-only by design. Roll forward
 *     by writing a new migration if you need to undo.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { config } from "../src/config/index.js";
import schemaMigrationModel from "../src/DB/Model/schemaMigration.model.js";

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry");
const STATUS_ONLY = args.has("--status");

const MIGRATIONS_DIR = path.resolve("src/migrations");

async function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort(); // filename-prefixed timestamps keep order deterministic
}

function checksumFile(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function applyOne(file) {
  const filePath = path.join(MIGRATIONS_DIR, file);
  // ESM dynamic import requires a file:// URL on Windows.
  const mod = await import(pathToFileURL(filePath).href);
  const up = mod.default || mod.up;
  if (typeof up !== "function") {
    throw new Error(`Migration ${file} has no default export / no up()`);
  }
  const start = Date.now();
  await up(mongoose.connection.db, mongoose);
  const durationMs = Date.now() - start;
  await schemaMigrationModel.create({
    name: file,
    durationMs,
    checksum: checksumFile(filePath),
  });
  return durationMs;
}

async function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log("No migrations directory at " + MIGRATIONS_DIR);
    process.exit(0);
  }

  console.log("Connecting to", config.db.uri.replace(/\/\/.*@/, "//***@"));
  await mongoose.connect(config.db.uri);

  const allFiles = await loadMigrations();
  const applied = await schemaMigrationModel
    .find()
    .select("name appliedAt")
    .lean();
  const appliedNames = new Set(applied.map((m) => m.name));
  const pending = allFiles.filter((f) => !appliedNames.has(f));

  if (STATUS_ONLY) {
    console.log(`\nApplied (${applied.length}):`);
    for (const m of applied.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ✓ ${m.name}  (${m.appliedAt.toISOString()})`);
    }
    console.log(`\nPending (${pending.length}):`);
    for (const f of pending) console.log(`  · ${f}`);
    await mongoose.disconnect();
    return;
  }

  if (pending.length === 0) {
    console.log("Nothing to migrate. Database is up to date.");
    await mongoose.disconnect();
    return;
  }

  console.log(`\n${pending.length} pending migration(s):`);
  for (const f of pending) console.log(`  · ${f}`);

  if (DRY) {
    console.log("\n--dry: not applying.");
    await mongoose.disconnect();
    return;
  }

  console.log("");
  for (const file of pending) {
    process.stdout.write(`Applying ${file} ... `);
    try {
      const ms = await applyOne(file);
      console.log(`✓ (${ms}ms)`);
    } catch (err) {
      console.error("✘");
      console.error(err);
      await mongoose.disconnect();
      process.exit(1);
    }
  }
  console.log("\nAll migrations applied.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
