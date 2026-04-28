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
  console.log(`${LOG_PREFIX} Starting sourceType backfill migration...`);

  await connectDB();

  // Backfill consent_artefacts
  const mainResult = await mongoose.connection.collection("consent_artefacts").updateMany(
    { sourceType: { $exists: false } },
    { $set: { sourceType: "CONSENT" } },
  );
  console.log(
    `${LOG_PREFIX} consent_artefacts: updated ${mainResult.modifiedCount} documents`,
  );

  // Backfill phr_consent_artefacts
  const phrResult = await mongoose.connection.collection("phr_consent_artefacts").updateMany(
    { sourceType: { $exists: false } },
    { $set: { sourceType: "CONSENT" } },
  );
  console.log(
    `${LOG_PREFIX} phr_consent_artefacts: updated ${phrResult.modifiedCount} documents`,
  );

  console.log(`${LOG_PREFIX} Migration complete.`);
  await mongoose.disconnect();
  process.exit(0);
}

backfillSourceType().catch((err) => {
  console.error(`${LOG_PREFIX} Migration failed:`, err);
  process.exit(1);
});
