import { Request, Response } from "express";
import { Types } from "mongoose";
import { VisitDayCareBilling } from "../models/VisitDayCareBilling";
import { PatientModel as Patient } from "../models/Patient";
import { ScanShareVisitModel } from "../models/ScanShareVisit";
import { CareContextService } from "../services/carecontext.service";

// Helper to resolve patient from visit ID (supports both Scan&Share and Manual visits)
const resolvePatientAndVisitId = async (
  visitId: string,
): Promise<{
  patientId: Types.ObjectId;
  visitId: Types.ObjectId;
  uhid?: string;
} | null> => {
  if (!visitId || !Types.ObjectId.isValid(visitId)) return null;
  const visitObjId = new Types.ObjectId(visitId);

  // 1. Check ScanShareVisit
  const scanVisit = await ScanShareVisitModel.findById(visitObjId)
    .select("patientId abhaNumber")
    .lean();
  if (scanVisit?.patientId) {
    return {
      patientId: scanVisit.patientId as Types.ObjectId,
      visitId: visitObjId,
      uhid: scanVisit.abhaNumber,
    };
  }

  // 2. Check Patient.visits (Manual)
  const patient = await Patient.findOne({
    "visits.visitId": visitObjId,
  })
    .select("_id uhid")
    .lean();
  if (patient) {
    return {
      patientId: patient._id as Types.ObjectId,
      visitId: visitObjId,
      uhid: patient.uhid,
    };
  }

  return null;
};

// Helper: Create CareContext for Invoice HI type
const updateCareContext = async (
  patientId: Types.ObjectId | string,
  visitId: Types.ObjectId | string,
) => {
  try {
    const careContext = await CareContextService.createCareContextForHiType(
      patientId,
      visitId,
      "Invoice",
    );
    if (careContext) {
      CareContextService.notifyContext(careContext as any).then((notified) => {
        if (notified) {
          console.log("Billing: Context notified for Invoice");
        } else {
          console.warn("Billing: Context notify failed (check link token)");
        }
      });
    }
  } catch (error) {
    console.error("Billing: Failed to create care context for Invoice", error);
  }
};

export const DayCareBillingController = {
  // Create a new billing record
  createDayCareBilling: async (req: Request, res: Response) => {
    try {
      const { visitId, billings, totalAmount, date, status } = req.body;

      if (!visitId) {
        return res
          .status(400)
          .json({ success: false, message: "visitId is required" });
      }

      // Check for duplicate billing for this visit
      const existingBilling = await VisitDayCareBilling.findOne({ visitId });
      if (existingBilling) {
        return res.status(400).json({
          success: false,
          message: "Billing for this visit already exists",
        });
      }

      // Resolve Patient from Visit
      const resolved = await resolvePatientAndVisitId(visitId);
      if (!resolved) {
        return res.status(404).json({
          success: false,
          message: "Visit not found or not linked to a patient",
        });
      }

      const newBilling = new VisitDayCareBilling({
        patient: resolved.patientId,
        visitId: resolved.visitId,
        uhid: resolved.uhid || "UNKNOWN",
        billings,
        totalAmount,
        date: date || new Date(),
        status: status || "Draft",
      });

      await newBilling.save();

      // Update Care Context (Async)
      updateCareContext(resolved.patientId, resolved.visitId);

      res.status(201).json({
        success: true,
        data: newBilling,
        message: "Day Care Billing created successfully",
      });
    } catch (error: any) {
      console.error("Error creating billing:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create billing",
        error: error.message,
      });
    }
  },

  // Get a single billing by ID or Visit ID
  getDayCareBilling: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      let billing;

      // Check if id is a valid ObjectId
      if (typeof id === "string" && Types.ObjectId.isValid(id)) {
        // Try finding by _id first
        billing = await VisitDayCareBilling.findById(id).populate("patient");
        // No linking to "visitId" as it is just an ID now, unless we want to attempt manual populate
        // But since it can be from different collections, we just return the ID

        // If not found, try finding by visitId (if id is treated as visitId)
        if (!billing) {
          billing = await VisitDayCareBilling.findOne({ visitId: id }).populate(
            "patient",
          );
        }
      } else {
        return res
          .status(400)
          .json({ success: false, message: "Invalid ID format" });
      }

      if (!billing) {
        return res
          .status(404)
          .json({ success: false, message: "Billing record not found" });
      }

      res.status(200).json({ success: true, data: billing });
    } catch (error: any) {
      console.error("Error fetching billing:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch billing",
        error: error.message,
      });
    }
  },

  // Get all billings (with optional filters)
  getAllDayCareBillings: async (req: Request, res: Response) => {
    try {
      const { patientId, visitId, status } = req.query;
      const filter: any = {};

      if (patientId) filter.patient = patientId;
      if (visitId) filter.visitId = visitId;
      if (status) filter.status = status;

      const billings = await VisitDayCareBilling.find(filter)
        .populate("patient")
        .sort({ createdAt: -1 });

      res.status(200).json({ success: true, data: billings });
    } catch (error: any) {
      console.error("Error fetching billings:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch billings",
        error: error.message,
      });
    }
  },

  // Update billing record
  updateDayCareBilling: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Prevent updating immutable fields
      delete updates.visitId;
      delete updates.patient;

      const billing = await VisitDayCareBilling.findByIdAndUpdate(id, updates, {
        new: true,
      });

      if (!billing) {
        return res
          .status(404)
          .json({ success: false, message: "Billing record not found" });
      }

      // Update Care Context (Async)
      updateCareContext(billing.patient, billing.visitId);

      res.status(200).json({
        success: true,
        data: billing,
        message: "Billing updated successfully",
      });
    } catch (error: any) {
      console.error("Error updating billing:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update billing",
        error: error.message,
      });
    }
  },

  // Get billing by Visit ID
  getBillingByVisitId: async (req: Request, res: Response) => {
    try {
      const { visitId } = req.params;

      if (!visitId || typeof visitId !== "string" || !Types.ObjectId.isValid(visitId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid Visit ID format" });
      }

      const billing = await VisitDayCareBilling.findOne({
        visitId: new Types.ObjectId(visitId),
      }).populate("patient");

      return res.status(200).json({ success: true, data: billing || null });
    } catch (error: any) {
      console.error("Error fetching billing by visit ID:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch billing",
        error: error.message,
      });
    }
  },
};
