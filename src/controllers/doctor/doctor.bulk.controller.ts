import { Request, Response } from "express";
import { Types } from "mongoose";
import { Readable } from "stream";
import csvParser from "csv-parser";
import { Parser as Json2CsvParser } from "json2csv";
import PDFDocument from "pdfkit";
import { DoctorModel } from "../../models/Doctor";
import { OPDVisitModel, VisitStatus } from "../../models/OPDVisit";
import { successResponse, errorResponse } from "../../utils/common";
import {
  STATUS_CODE,
  DOCTOR_STATUS,
  DOCTOR_CURRENT_STATUS,
} from "../../utils/constant";
import { handleMulterError } from "../../middlewares/upload.middleware";

const isValidObjectId = (id: string): boolean =>
  typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);

const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

interface BulkImportRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  specialization: string;
  department: string;
  licenseNumber: string;
  experience: string | number;
  qualification: string;
  consultationFee: string | number;
  gender?: string;
  accessLevel?: string;
}

interface ImportResult {
  row: number;
  email: string;
  success: boolean;
  error?: string;
  doctorId?: string;
}

const parseCSV = (buffer: Buffer): Promise<BulkImportRow[]> => {
  return new Promise((resolve, reject) => {
    const results: BulkImportRow[] = [];
    const stream = Readable.from(buffer.toString());

    stream
      .pipe(
        csvParser({ mapHeaders: ({ header }) => header.trim().toLowerCase() }),
      )
      .on("data", (row) => {
        const normalized: BulkImportRow = {
          firstName: row.firstname || row.firstName || row.first_name || "",
          lastName: row.lastname || row.lastName || row.last_name || "",
          email: row.email || "",
          phone: row.phone || row.mobile || "",
          specialization: row.specialization || "",
          department:
            row.department || row.departmentid || row.department_id || "",
          licenseNumber:
            row.licensenumber ||
            row.licenseNumber ||
            row.license_number ||
            row.license ||
            "",
          experience: row.experience || 0,
          qualification: row.qualification || "",
          consultationFee:
            row.consultationfee ||
            row.consultationFee ||
            row.consultation_fee ||
            row.fee ||
            0,
          gender: row.gender || undefined,
          accessLevel:
            row.accesslevel || row.accessLevel || row.access_level || "FULL",
        };
        results.push(normalized);
      })
      .on("end", () => resolve(results))
      .on("error", reject);
  });
};

const validateRow = (row: BulkImportRow, rowIndex: number): string[] => {
  const errors: string[] = [];

  if (!row.firstName?.trim()) errors.push("firstName is required");
  if (!row.lastName?.trim()) errors.push("lastName is required");
  if (!row.email?.trim()) errors.push("email is required");
  else if (!isValidEmail(row.email.trim())) errors.push("invalid email format");
  if (!row.phone?.trim()) errors.push("phone is required");
  if (!row.specialization?.trim()) errors.push("specialization is required");
  if (!row.department?.trim()) errors.push("department is required");
  else if (!isValidObjectId(row.department.trim()))
    errors.push("invalid department ID");
  if (!row.licenseNumber?.trim()) errors.push("licenseNumber is required");
  if (!row.qualification?.trim()) errors.push("qualification is required");

  const experience = Number(row.experience);
  if (isNaN(experience) || experience < 0)
    errors.push("experience must be a valid non-negative number");

  const fee = Number(row.consultationFee);
  if (isNaN(fee) || fee < 0)
    errors.push("consultationFee must be a valid non-negative number");

  return errors;
};

export const bulkImportDoctors = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const file = req.file;

    if (!file) {
      return errorResponse(res, "No file uploaded", STATUS_CODE.BAD_REQUEST);
    }

    let rows: BulkImportRow[];

    if (file.originalname.toLowerCase().endsWith(".json")) {
      try {
        const parsed = JSON.parse(file.buffer.toString());
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return errorResponse(
          res,
          "Invalid JSON file format",
          STATUS_CODE.BAD_REQUEST,
        );
      }
    } else {
      try {
        rows = await parseCSV(file.buffer);
      } catch (err) {
        return errorResponse(
          res,
          "Failed to parse CSV file",
          STATUS_CODE.BAD_REQUEST,
        );
      }
    }

    if (rows.length === 0) {
      return errorResponse(
        res,
        "File contains no data",
        STATUS_CODE.BAD_REQUEST,
      );
    }

    if (rows.length > 500) {
      return errorResponse(
        res,
        "Maximum 500 records allowed per import",
        STATUS_CODE.BAD_REQUEST,
      );
    }

    const allEmails = rows
      .map((r) => r.email?.trim().toLowerCase())
      .filter(Boolean);
    const allLicenses = rows
      .map((r) => r.licenseNumber?.trim())
      .filter(Boolean);

    const existingByEmail = await DoctorModel.find({
      email: { $in: allEmails },
    }).select("email");
    const existingByLicense = await DoctorModel.find({
      licenseNumber: { $in: allLicenses },
    }).select("licenseNumber");

    const existingEmails = new Set(
      existingByEmail.map((d) => d.email.toLowerCase()),
    );
    const existingLicenses = new Set(
      existingByLicense.map((d) => d.licenseNumber),
    );

    const results: ImportResult[] = [];
    const toCreate: any[] = [];
    const seenEmails = new Set<string>();
    const seenLicenses = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because row 1 is header
      const email = row.email?.trim().toLowerCase();
      const license = row.licenseNumber?.trim();

      const validationErrors = validateRow(row, i);

      if (validationErrors.length > 0) {
        results.push({
          row: rowNum,
          email: email || "N/A",
          success: false,
          error: validationErrors.join("; "),
        });
        continue;
      }

      if (existingEmails.has(email) || seenEmails.has(email)) {
        results.push({
          row: rowNum,
          email,
          success: false,
          error: "Email already exists",
        });
        continue;
      }

      if (existingLicenses.has(license) || seenLicenses.has(license)) {
        results.push({
          row: rowNum,
          email,
          success: false,
          error: "License number already exists",
        });
        continue;
      }

      seenEmails.add(email);
      seenLicenses.add(license);

      toCreate.push({
        rowNum,
        doc: {
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          email,
          phone: row.phone.trim(),
          specialization: row.specialization.trim(),
          department: new Types.ObjectId(row.department.trim()),
          licenseNumber: license,
          experience: Number(row.experience),
          qualification: row.qualification.trim(),
          consultationFee: Number(row.consultationFee),
          gender: row.gender?.trim() || undefined,
          accessLevel: ["FULL", "LIMITED", "VIEW_ONLY"].includes(
            row.accessLevel?.toUpperCase() || "",
          )
            ? row.accessLevel?.toUpperCase()
            : "FULL",
          isActive: true,
          status: DOCTOR_STATUS.ACTIVE,
          currentStatus: DOCTOR_CURRENT_STATUS.OFF_DUTY,
          availableSlots: [],
          created_by:
            (req as any).user?.id || (req as any).user?._id?.toString?.(),
        },
      });
    }

    let createdCount = 0;

    if (toCreate.length > 0) {
      try {
        const inserted = await DoctorModel.insertMany(
          toCreate.map((t) => t.doc),
          { ordered: false },
        );

        for (let i = 0; i < inserted.length; i++) {
          results.push({
            row: toCreate[i].rowNum,
            email: toCreate[i].doc.email,
            success: true,
            doctorId: inserted[i]._id.toString(),
          });
          createdCount++;
        }
      } catch (err: any) {
        if (err.insertedDocs) {
          for (const doc of err.insertedDocs) {
            results.push({
              row: toCreate.find((t) => t.doc.email === doc.email)?.rowNum || 0,
              email: doc.email,
              success: true,
              doctorId: doc._id.toString(),
            });
            createdCount++;
          }
        }

        if (err.writeErrors) {
          for (const writeErr of err.writeErrors) {
            const failed = toCreate[writeErr.index];
            results.push({
              row: failed?.rowNum || 0,
              email: failed?.doc?.email || "unknown",
              success: false,
              error: writeErr.errmsg || "Database insert error",
            });
          }
        }
      }
    }

    results.sort((a, b) => a.row - b.row);

    const failedCount = results.filter((r) => !r.success).length;

    return successResponse(
      res,
      {
        total: rows.length,
        created: createdCount,
        failed: failedCount,
        results,
      },
      `Imported ${createdCount} of ${rows.length} doctors`,
      createdCount > 0 ? STATUS_CODE.CREATED : STATUS_CODE.BAD_REQUEST,
    );
  } catch (error: any) {
    console.error("bulkImportDoctors error:", error);

    if (error.name === "MulterError") {
      return errorResponse(
        res,
        handleMulterError(error),
        STATUS_CODE.BAD_REQUEST,
      );
    }

    return errorResponse(
      res,
      error.message || "Failed to import doctors",
      STATUS_CODE.ERROR,
    );
  }
};

export const exportDoctors = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const department = req.query.department as string | undefined;
    const specialization = req.query.specialization as string | undefined;
    const status = req.query.status as string | undefined;
    const accessLevel = req.query.accessLevel as string | undefined;
    const search = (req.query.search as string)?.trim();

    const match: Record<string, unknown> = { isActive: true };

    if (department && isValidObjectId(department)) {
      match.department = new Types.ObjectId(department);
    }
    if (specialization) {
      match.specialization = { $regex: specialization, $options: "i" };
    }
    if (status && Object.values(DOCTOR_STATUS).includes(status as any)) {
      match.status = status;
    }
    if (accessLevel && ["FULL", "LIMITED", "VIEW_ONLY"].includes(accessLevel)) {
      match.accessLevel = accessLevel;
    }
    if (search) {
      match.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { licenseNumber: { $regex: search, $options: "i" } },
        { specialization: { $regex: search, $options: "i" } },
      ];
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const doctors = await DoctorModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "departments",
          localField: "department",
          foreignField: "_id",
          as: "departmentInfo",
        },
      },
      {
        $unwind: { path: "$departmentInfo", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "opd_visits",
          let: { docId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$doctorId", "$$docId"] },
                visitDate: { $gte: todayStart, $lte: todayEnd },
                visitStatus: {
                  $in: [VisitStatus.REGISTERED, VisitStatus.COMPLETED],
                },
              },
            },
            { $count: "count" },
          ],
          as: "appointmentsToday",
        },
      },
      {
        $addFields: {
          appointmentsToday: {
            $ifNull: [{ $arrayElemAt: ["$appointmentsToday.count", 0] }, 0],
          },
          departmentName: "$departmentInfo.name",
        },
      },
      { $sort: { firstName: 1, lastName: 1 } },
      {
        $project: {
          _id: 1,
          firstName: 1,
          lastName: 1,
          email: 1,
          phone: 1,
          specialization: 1,
          departmentName: 1,
          licenseNumber: 1,
          experience: 1,
          qualification: 1,
          consultationFee: 1,
          status: 1,
          currentStatus: 1,
          accessLevel: 1,
          appointmentsToday: 1,
          createdAt: 1,
        },
      },
    ]);

    if (doctors.length === 0) {
      return errorResponse(
        res,
        "No doctors found to export",
        STATUS_CODE.NOT_FOUND,
      );
    }

    const fields = [
      { label: "ID", value: "_id" },
      { label: "First Name", value: "firstName" },
      { label: "Last Name", value: "lastName" },
      { label: "Email", value: "email" },
      { label: "Phone", value: "phone" },
      { label: "Specialization", value: "specialization" },
      { label: "Department", value: "departmentName" },
      { label: "License Number", value: "licenseNumber" },
      { label: "Experience (Years)", value: "experience" },
      { label: "Qualification", value: "qualification" },
      { label: "Consultation Fee", value: "consultationFee" },
      { label: "Status", value: "status" },
      { label: "Current Status", value: "currentStatus" },
      { label: "Access Level", value: "accessLevel" },
      { label: "Appointments Today", value: "appointmentsToday" },
    ];

    const parser = new Json2CsvParser({ fields });
    const csv = parser.parse(doctors);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="doctors_export_${new Date().toISOString().split("T")[0]}.csv"`,
    );
    res.status(STATUS_CODE.SUCCESS).send(csv);
  } catch (error: any) {
    console.error("exportDoctors error:", error);
    return errorResponse(
      res,
      error.message || "Failed to export doctors",
      STATUS_CODE.ERROR,
    );
  }
};

export const exportDoctorsPDF = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const department = req.query.department as string | undefined;
    const specialization = req.query.specialization as string | undefined;
    const status = req.query.status as string | undefined;

    const match: Record<string, unknown> = { isActive: true };

    if (department && isValidObjectId(department)) {
      match.department = new Types.ObjectId(department);
    }
    if (specialization) {
      match.specialization = { $regex: specialization, $options: "i" };
    }
    if (status && Object.values(DOCTOR_STATUS).includes(status as any)) {
      match.status = status;
    }

    const doctors = await DoctorModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "departments",
          localField: "department",
          foreignField: "_id",
          as: "departmentInfo",
        },
      },
      {
        $unwind: { path: "$departmentInfo", preserveNullAndEmptyArrays: true },
      },
      {
        $addFields: {
          fullName: { $concat: ["$firstName", " ", "$lastName"] },
          departmentName: "$departmentInfo.name",
        },
      },
      { $sort: { firstName: 1, lastName: 1 } },
      { $limit: 100 },
      {
        $project: {
          fullName: 1,
          email: 1,
          phone: 1,
          specialization: 1,
          departmentName: 1,
          status: 1,
          accessLevel: 1,
        },
      },
    ]);

    if (doctors.length === 0) {
      return errorResponse(
        res,
        "No doctors found to export",
        STATUS_CODE.NOT_FOUND,
      );
    }

    const doc = new PDFDocument({
      margin: 40,
      size: "A4",
      layout: "landscape",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="doctors_export_${new Date().toISOString().split("T")[0]}.pdf"`,
    );

    doc.pipe(res);

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("Doctors List", { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Generated on: ${new Date().toLocaleDateString()}`, {
        align: "center",
      });
    doc.moveDown(1);

    const tableTop = doc.y;
    const colWidths = [150, 180, 100, 120, 100, 70, 80];
    const headers = [
      "Name",
      "Email",
      "Phone",
      "Specialization",
      "Department",
      "Status",
      "Access",
    ];

    doc.font("Helvetica-Bold").fontSize(9);
    let xPos = 40;
    headers.forEach((header, i) => {
      doc.text(header, xPos, tableTop, { width: colWidths[i], align: "left" });
      xPos += colWidths[i];
    });

    doc
      .moveTo(40, tableTop + 15)
      .lineTo(760, tableTop + 15)
      .stroke();

    doc.font("Helvetica").fontSize(8);
    let yPos = tableTop + 25;

    for (const doctor of doctors) {
      if (yPos > 500) {
        doc.addPage();
        yPos = 50;
      }

      xPos = 40;
      const rowData = [
        doctor.fullName || "",
        doctor.email || "",
        doctor.phone || "",
        doctor.specialization || "",
        doctor.departmentName || "",
        doctor.status || "",
        doctor.accessLevel || "",
      ];

      rowData.forEach((cell, i) => {
        doc.text(String(cell).substring(0, 25), xPos, yPos, {
          width: colWidths[i],
          align: "left",
        });
        xPos += colWidths[i];
      });

      yPos += 18;
    }

    doc.moveDown(2);
    doc
      .fontSize(8)
      .text(`Total: ${doctors.length} doctors`, { align: "right" });

    doc.end();
  } catch (error: any) {
    console.error("exportDoctorsPDF error:", error);
    return errorResponse(
      res,
      error.message || "Failed to export doctors as PDF",
      STATUS_CODE.ERROR,
    );
  }
};

export const downloadImportTemplate = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sampleData = [
      {
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        phone: "9876543210",
        specialization: "Cardiology",
        department: "<department_object_id>",
        licenseNumber: "LIC001",
        experience: 5,
        qualification: "MBBS, MD",
        consultationFee: 500,
        gender: "Male",
        accessLevel: "FULL",
      },
      {
        firstName: "Jane",
        lastName: "Smith",
        email: "jane.smith@example.com",
        phone: "9876543211",
        specialization: "Neurology",
        department: "<department_object_id>",
        licenseNumber: "LIC002",
        experience: 8,
        qualification: "MBBS, MD, DM",
        consultationFee: 750,
        gender: "Female",
        accessLevel: "FULL",
      },
    ];

    const fields = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "specialization",
      "department",
      "licenseNumber",
      "experience",
      "qualification",
      "consultationFee",
      "gender",
      "accessLevel",
    ];

    const parser = new Json2CsvParser({ fields });
    const csv = parser.parse(sampleData);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="doctors_import_template.csv"',
    );
    res.status(STATUS_CODE.SUCCESS).send(csv);
  } catch (error: any) {
    console.error("downloadImportTemplate error:", error);
    return errorResponse(
      res,
      error.message || "Failed to generate template",
      STATUS_CODE.ERROR,
    );
  }
};
