import mongoose from "mongoose";
const { Schema, model } = mongoose;

/**
 * Tracks which migration scripts have run against this database.
 * One row per migration filename; the runner skips files already
 * present. NEVER edit rows by hand — the runner is the only writer.
 */
const schemaMigrationSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    appliedAt: { type: Date, default: Date.now },
    durationMs: { type: Number, default: 0 },
    checksum: { type: String, default: null }, // sha256 of the file
  },
  { timestamps: false },
);

const schemaMigrationModel =
  mongoose.models.SchemaMigration ||
  model("SchemaMigration", schemaMigrationSchema);

export default schemaMigrationModel;
