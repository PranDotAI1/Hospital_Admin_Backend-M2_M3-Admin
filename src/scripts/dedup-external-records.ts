/**
 * Migration script: Deduplicate existing ExternalHealthRecords.
 *
 * The new unique compound index on {patientAbhaAddress, careContextReference}
 * will fail to create if duplicate records exist. This script:
 * 1. Finds all groups of records with the same (patientAbhaAddress, careContextReference)
 * 2. Keeps the most recently received record (latest receivedAt)
 * 3. Deletes all older duplicates
 *
 * Run ONCE before deploying the unique index change.
 *
 * Usage:
 *   npx ts-node src/scripts/dedup-external-records.ts
 *
 * Or via mongo shell equivalent (see bottom of file).
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "";

async function deduplicateExternalRecords() {
  if (!MONGODB_URI) {
    console.error("ERROR: No MONGODB_URI or MONGO_URI found in environment");
    process.exit(1);
  }
  await mongoose.connect(MONGODB_URI);
  const collection = mongoose.connection.collection("external_health_records");

  // Step 1: Find all duplicate groups
  const duplicateGroups = await collection
    .aggregate([
      {
        $group: {
          _id: {
            patientAbhaAddress: "$patientAbhaAddress",
            careContextReference: "$careContextReference",
          },
          count: { $sum: 1 },
          allIds: { $push: "$_id" },
          latestReceived: { $max: "$receivedAt" },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ])
    .toArray();

  if (duplicateGroups.length === 0) {
    await mongoose.disconnect();
    return;
  }
  let totalDeleted = 0;

  for (const group of duplicateGroups) {
    const { patientAbhaAddress, careContextReference } = group._id;

    // Find the record we want to KEEP (most recent by receivedAt)
    const keepRecord = await collection.findOne(
      {
        patientAbhaAddress,
        careContextReference,
      },
      {
        sort: { receivedAt: -1, createdAt: -1 },
        projection: { _id: 1 },
      },
    );

    if (!keepRecord) continue;

    // Delete all others
    const deleteResult = await collection.deleteMany({
      patientAbhaAddress,
      careContextReference,
      _id: { $ne: keepRecord._id },
    });

    if (deleteResult.deletedCount > 0) {
      totalDeleted += deleteResult.deletedCount;
    }
  }
  // Step 2: Also drop the old index if it exists
  try {
    const indexes = await collection.indexes();
    const oldIndex = indexes.find(
      (idx: any) =>
        idx.key?.transactionId === 1 && idx.key?.careContextReference === 1,
    );
    if (oldIndex && oldIndex.name) {
      await collection.dropIndex(oldIndex.name);
    }
  } catch (err: any) {
  }

  await mongoose.disconnect();
}

deduplicateExternalRecords().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
