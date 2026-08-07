/**
 * Backfill migration: Set sourceType on existing ConsentArtefact documents.
 *
 * Safe to run multiple times — only updates documents that don't have sourceType set.
 *
 * Usage: npx ts-node src/scripts/backfill-source-type.ts
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectDB } from "../config/db";

const LOG_PREFIX = "[MIGRATION]";

async function backfillSourceType() {
  await connectDB();

  // Backfill consent_artefacts
  const mainResult = await mongoose.connection.collection("consent_artefacts").updateMany(
    { sourceType: { $exists: false } },
    { $set: { sourceType: "CONSENT" } },
  );
  // Backfill phr_consent_artefacts
  const phrResult = await mongoose.connection.collection("phr_consent_artefacts").updateMany(
    { sourceType: { $exists: false } },
    { $set: { sourceType: "CONSENT" } },
  );
  await mongoose.disconnect();
  process.exit(0);
}

backfillSourceType().catch((err) => {
  console.error(`${LOG_PREFIX} Migration failed:`, err);
  process.exit(1);
});
