import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { PatientModel } from "../models/Patient";
import {
  sanitizeInputString,
  isValidPatientName,
  isValidMobile,
  maskAadhaar,
} from "../utils/sanitizer";

/**
 * Cleanup & Migration Script for Corrupted / Injected Patient Data in MongoDB
 *
 * Scans all Patient records and:
 * 1. Cleans or removes "[object Object]" from names, mobiles, dobs.
 * 2. Strips HTML / XSS payloads like <script>alert(1)</script> and <img src=x ...>.
 * 3. Reconstructs full names properly from sanitized components.
 * 4. Masks any raw 12-digit Aadhaar numbers.
 * 5. Can be run in dry-run mode (--dry-run) or write mode (--apply).
 */

async function cleanupPatients() {
  const isApply = process.argv.includes("--apply");
  const isDryRun = !isApply;

  console.log(`=== Patient Database Cleanup Script ===`);
  console.log(`Mode: ${isDryRun ? "DRY RUN (preview only)" : "APPLY (modifying database)"}\n`);

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI environment variable not set");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB successfully.\n");

  const patients = await PatientModel.find({}).lean();
  console.log(`Total patient records scanned: ${patients.length}\n`);

  let corruptedCount = 0;
  let fixedCount = 0;

  for (const patient of patients) {
    let modified = false;
    const updates: Record<string, any> = {};

    const rawName = patient.name || "";
    const rawFName = patient.f_name || "";
    const rawMName = patient.m_name || "";
    const rawLName = patient.l_name || "";
    const rawMobile = patient.mobile || "";
    const rawDob = patient.dob || "";
    const rawAadhaar = patient.aadhaarNumber || "";

    const hasObjectObject =
      /\[object\s+Object\]/i.test(rawName) ||
      /\[object\s+Object\]/i.test(rawFName) ||
      /\[object\s+Object\]/i.test(rawMName) ||
      /\[object\s+Object\]/i.test(rawLName) ||
      /\[object\s+Object\]/i.test(rawMobile) ||
      /\[object\s+Object\]/i.test(rawDob);

    const hasHtmlOrScript =
      /<[^>]*>/i.test(rawName) ||
      /<[^>]*>/i.test(rawFName) ||
      /<[^>]*>/i.test(rawLName) ||
      /javascript:|onerror=/i.test(rawName) ||
      /javascript:|onerror=/i.test(rawFName);

    if (hasObjectObject || hasHtmlOrScript) {
      corruptedCount++;
      console.log(`[CORRUPT FOUND] ID: ${patient._id} | UHID: ${patient.uhid || "N/A"}`);
      console.log(`  Raw: Name="${rawName}", FName="${rawFName}", Mobile="${rawMobile}", DOB="${rawDob}"`);

      // Clean first name
      let cleanFName = sanitizeInputString(rawFName, { maxLength: 100, stripHtml: true, disallowObjectString: true });
      let cleanMName = sanitizeInputString(rawMName, { maxLength: 100, stripHtml: true, disallowObjectString: true });
      let cleanLName = sanitizeInputString(rawLName, { maxLength: 100, stripHtml: true, disallowObjectString: true });

      // If FName was corrupted object but MName exists (e.g. FName=[object Object], MName=Harshith, LName=Reddy)
      if (!cleanFName && cleanMName) {
        cleanFName = cleanMName;
        cleanMName = undefined;
      }

      // If name is an XSS test injection like alert(1), replace with a safe name
      if (cleanFName && (/alert\(|onerror|xss/i.test(cleanFName) || !isValidPatientName(cleanFName))) {
        cleanFName = "TestPatient";
      }
      if (cleanLName && (/alert\(|onerror|xss/i.test(cleanLName) || !isValidPatientName(cleanLName))) {
        cleanLName = "Record";
      }

      updates.f_name = cleanFName || "Patient";
      updates.m_name = cleanMName;
      updates.l_name = cleanLName;

      // Reconstruct clean full name
      const cleanComputedName = [updates.f_name, updates.m_name, updates.l_name]
        .filter(Boolean)
        .join(" ");

      updates.name = cleanComputedName || "Patient";
      modified = true;

      // Clean mobile
      if (/\[object\s+Object\]/i.test(rawMobile) || !isValidMobile(rawMobile)) {
        // Clear corrupt mobile
        updates.mobile = "9999999999";
        modified = true;
      }

      // Clean dob
      if (/\[object\s+Object\]/i.test(rawDob) || /<[^>]*>/i.test(rawDob)) {
        updates.dob = "1990-01-01";
        modified = true;
      }

      // Mask Aadhaar if needed
      if (rawAadhaar) {
        const masked = maskAadhaar(rawAadhaar);
        if (masked && masked !== rawAadhaar) {
          updates.aadhaarNumber = masked;
          modified = true;
        }
      }

      console.log(`  -> Cleaned: Name="${updates.name}", FName="${updates.f_name || rawFName}", Mobile="${updates.mobile || rawMobile}"`);

      if (isApply && modified) {
        await PatientModel.collection.updateOne(
          { _id: patient._id },
          { $set: updates },
        );
        fixedCount++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total scanned: ${patients.length}`);
  console.log(`Corrupted records identified: ${corruptedCount}`);
  if (isApply) {
    console.log(`Records updated and cleaned: ${fixedCount}`);
  } else {
    console.log(`Run with --apply to commit these cleanups to the database.`);
  }

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
}

cleanupPatients().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
