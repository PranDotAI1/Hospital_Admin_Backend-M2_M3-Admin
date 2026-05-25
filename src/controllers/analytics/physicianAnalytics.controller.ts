import { Request, Response } from "express";
import { Types } from "mongoose";
import { ScanShareVisitModel, ScanShareVisitStatus } from "../../models/ScanShareVisit";
import { DoctorModel } from "../../models/Doctor";
import {
  successResponse,
  errorResponse,
  successListResponse,
  buildPaginationMeta,
} from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";

const DEFAULT_TOP_LIMIT = 10;
const MAX_LIMIT = 50;

type PeriodType = "day" | "week" | "month" | "quarter" | "year";

const getDateRange = (
  period: PeriodType,
  from?: string,
  to?: string
): { start: Date; end: Date } => {
  const end = to ? new Date(to) : new Date();
  if (isNaN(end.getTime())) {
    const def = new Date();
    return { start: def, end: def };
  }
  end.setHours(23, 59, 59, 999);

  let start: Date;
  if (from) {
    start = new Date(from);
    if (isNaN(start.getTime())) start = new Date();
  } else {
    start = new Date(end);
    switch (period) {
      case "day":
        start.setHours(0, 0, 0, 0);
        break;
      case "week":
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        break;
      case "month":
        start.setMonth(start.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
        break;
      case "quarter":
        start.setMonth(start.getMonth() - 3);
        start.setHours(0, 0, 0, 0);
        break;
      case "year":
        start.setFullYear(start.getFullYear() - 1);
        start.setHours(0, 0, 0, 0);
        break;
      default:
        start.setHours(0, 0, 0, 0);
    }
  }
  start.setHours(0, 0, 0, 0);
  return { start, end };
};

export const getPhysicianAnalyticsSummary = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const period = (
      (req.query.groupBy as string) || "day"
    ).toLowerCase() as PeriodType;
    const validPeriods: PeriodType[] = [
      "day",
      "week",
      "month",
      "quarter",
      "year",
    ];
    const groupBy = validPeriods.includes(period) ? period : "day";
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(String(req.query.limit)) || DEFAULT_TOP_LIMIT)
    );
    const hospitalId = req.query.hospitalId as string | undefined;
    const departmentId = req.query.departmentId as string | undefined;

    const { start, end } = getDateRange(groupBy, from, to);

    // Include all doctors that are not explicitly inactive (true or missing)
    const matchDoctor: Record<string, unknown> = { isActive: { $ne: false } };
    if (hospitalId && /^[a-f0-9]{24}$/i.test(hospitalId)) {
      matchDoctor.$or = [
        { hospital_id: new Types.ObjectId(hospitalId) },
        { assignedHospitalUnitIds: new Types.ObjectId(hospitalId) },
      ];
    }
    if (departmentId && /^[a-f0-9]{24}$/i.test(departmentId)) {
      matchDoctor.department = new Types.ObjectId(departmentId);
    }

    const matchVisit: Record<string, unknown> = {
      visitDate: { $gte: start, $lte: end },
      visitStatus: { $in: [ScanShareVisitStatus.REGISTERED, ScanShareVisitStatus.COMPLETED] },
      doctorId: { $exists: true, $ne: null },
    };

    let doctorIds = await DoctorModel.find(matchDoctor).distinct("_id");
    // If hospital/department filter yielded no doctors, fall back to all active doctors so dashboard shows data
    if (doctorIds.length === 0 && (hospitalId || departmentId)) {
      const fallbackMatch: Record<string, unknown> = {
        isActive: { $ne: false },
      };
      doctorIds = await DoctorModel.find(fallbackMatch).distinct("_id");
    }
    if (doctorIds.length === 0) {
      return successResponse(res, {
        patientVolumePerPhysician: [],
        averageTimePerConsultation: [],
        followUpRatePerPhysician: [],
        treatmentSuccessRatePerPhysician: [],
        physicianWorkloadBalance: [],
        accuracyOfDiagnoses: [],
        meta: {
          totalDoctors: 0,
          totalVisitsInPeriod: 0,
          doctorsWithVisits: 0,
          from: start,
          to: end,
          groupBy,
        },
      });
    }

    matchVisit.doctorId = { $in: doctorIds };

    const visits = await ScanShareVisitModel.find(matchVisit)
      .select(
        "doctorId consultationStartedAt consultationEndedAt isFollowUp treatmentOutcome collaboratingDoctorIds"
      )
      .lean();

    // Select doctor fields for name and specialization
    const doctorList = await DoctorModel.find({ _id: { $in: doctorIds } })
      .select("firstName lastName email specialization primarySpecializationId")
      .populate("primarySpecializationId", "name")
      .lean();

    // Build a map with extracted name and specialization
    const doctorMap = new Map<
      string,
      { name: string; specialization: string }
    >();
    for (const d of doctorList) {
      const docAny = d as any;
      // Build fullName from firstName + lastName
      let rawName = "";
      if (docAny.firstName || docAny.lastName) {
        rawName = `${docAny.firstName || ""} ${docAny.lastName || ""}`.trim();
      }
      if (!rawName && docAny.email) {
        rawName = docAny.email.split("@")[0];
      }
      if (!rawName) {
        rawName = d._id.toString().slice(-6);
      }
      const displayName = rawName.startsWith("Dr.")
        ? rawName
        : `Dr. ${rawName}`;
      // Use specialization field (string) or populated primarySpecializationId
      const specName =
        docAny.specialization ||
        (docAny.primarySpecializationId as any)?.name ||
        "";
      doctorMap.set(d._id.toString(), {
        name: displayName,
        specialization: specName,
      });
    }

    const byDoctor = new Map<
      string,
      {
        count: number;
        followUp: number;
        success: number;
        withOutcome: number;
        totalMinutes: number;
        withTime: number;
        collaborating: number;
      }
    >();

    for (const d of doctorList) {
      byDoctor.set(d._id.toString(), {
        count: 0,
        followUp: 0,
        success: 0,
        withOutcome: 0,
        totalMinutes: 0,
        withTime: 0,
        collaborating: 0,
      });
    }

    for (const v of visits) {
      const did = (v.doctorId as Types.ObjectId)?.toString();
      if (!did || !byDoctor.has(did)) continue;
      const row = byDoctor.get(did)!;
      row.count += 1;
      if (v.isFollowUp) row.followUp += 1;
      if (v.treatmentOutcome) {
        row.withOutcome += 1;
        if (v.treatmentOutcome === "SUCCESS") row.success += 1;
      }
      if (v.consultationStartedAt && v.consultationEndedAt) {
        const ms =
          new Date(v.consultationEndedAt).getTime() -
          new Date(v.consultationStartedAt).getTime();
        row.totalMinutes += ms / 60000;
        row.withTime += 1;
      }
      if (
        Array.isArray(v.collaboratingDoctorIds) &&
        v.collaboratingDoctorIds.length > 0
      )
        row.collaborating += 1;
    }

    const totalVisits = visits.length;
    const topDoctorIds = [...byDoctor.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([id]) => id);

    const getName = (id: string) =>
      doctorMap.get(id)?.name || `Dr. ${id.slice(-6)}`;
    const getSpecialization = (id: string) =>
      doctorMap.get(id)?.specialization || "";

    const patientVolumePerPhysician = topDoctorIds.map((id) => ({
      doctorId: id,
      name: getName(id),
      specialization: getSpecialization(id),
      count: byDoctor.get(id)!.count,
    }));

    const averageTimePerConsultation = topDoctorIds.map((id) => {
      const row = byDoctor.get(id)!;
      // Return 0 instead of null for avgMinutes when no data, for cleaner charting
      const avgMinutes =
        row.withTime > 0
          ? Math.round((row.totalMinutes / row.withTime) * 10) / 10
          : 0;
      return {
        doctorId: id,
        name: getName(id),
        avgMinutes,
        consultationsWithTime: row.withTime,
      };
    });

    const followUpRatePerPhysician = topDoctorIds.map((id) => {
      const row = byDoctor.get(id)!;
      const ratePercent =
        row.count > 0
          ? Math.round((row.followUp / row.count) * 10000) / 100
          : 0;
      return {
        doctorId: id,
        name: getName(id),
        ratePercent,
        totalConsultations: row.count,
      };
    });

    const treatmentSuccessRatePerPhysician = topDoctorIds.map((id) => {
      const row = byDoctor.get(id)!;
      const ratePercent =
        row.withOutcome > 0
          ? Math.round((row.success / row.withOutcome) * 10000) / 100
          : 0;
      return {
        doctorId: id,
        name: getName(id),
        ratePercent,
        casesWithOutcome: row.withOutcome,
      };
    });

    const physicianWorkloadBalance = topDoctorIds.map((id) => {
      const row = byDoctor.get(id)!;
      const percent =
        totalVisits > 0
          ? Math.round((row.count / totalVisits) * 10000) / 100
          : 0;
      return {
        doctorId: id,
        name: getName(id),
        percent,
        visitCount: row.count,
      };
    });

    // Accuracy of diagnoses requires diagnosis verification data - placeholder for now
    const accuracyOfDiagnoses = topDoctorIds.map((id) => ({
      doctorId: id,
      name: getName(id),
      ratePercent: 0, // Will be calculated when diagnosis verification is implemented
    }));

    return successResponse(res, {
      patientVolumePerPhysician,
      averageTimePerConsultation,
      followUpRatePerPhysician,
      treatmentSuccessRatePerPhysician,
      physicianWorkloadBalance,
      accuracyOfDiagnoses,
      meta: {
        totalDoctors: doctorIds.length,
        totalVisitsInPeriod: totalVisits,
        doctorsWithVisits: [...byDoctor.entries()].filter(
          ([_, v]) => v.count > 0
        ).length,
        from: start,
        to: end,
        groupBy,
      },
    });
  } catch (error: any) {
    console.error("getPhysicianAnalyticsSummary error:", error);
    return errorResponse(
      res,
      error.message || "Failed to get physician analytics summary",
      STATUS_CODE.ERROR
    );
  }
};

export const getPhysicianAnalyticsTable = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const period = (
      (req.query.groupBy as string) || "day"
    ).toLowerCase() as PeriodType;
    const validPeriods: PeriodType[] = [
      "day",
      "week",
      "month",
      "quarter",
      "year",
    ];
    const groupBy = validPeriods.includes(period) ? period : "day";
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.limit)) || 10)
    );
    const search = (req.query.search as string)?.trim();
    const sortBy = (req.query.sortBy as string) || "name";
    const sortOrder =
      ((req.query.sortOrder as string) || "asc").toLowerCase() === "desc"
        ? -1
        : 1;
    const hospitalId = req.query.hospitalId as string | undefined;
    const departmentId = req.query.departmentId as string | undefined;

    const { start, end } = getDateRange(groupBy, from, to);

    // Include all doctors that are not explicitly inactive
    const matchDoctor: Record<string, unknown> = { isActive: { $ne: false } };
    if (hospitalId && /^[a-f0-9]{24}$/i.test(hospitalId)) {
      matchDoctor.$or = [
        { hospital_id: new Types.ObjectId(hospitalId) },
        { assignedHospitalUnitIds: new Types.ObjectId(hospitalId) },
      ];
    }
    if (departmentId && /^[a-f0-9]{24}$/i.test(departmentId)) {
      matchDoctor.department = new Types.ObjectId(departmentId);
    }
    if (search) {
      const searchCond = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { specialization: { $regex: search, $options: "i" } },
      ];
      if (matchDoctor.$or) {
        matchDoctor.$and = [{ $or: matchDoctor.$or }, { $or: searchCond }];
        delete matchDoctor.$or;
      } else {
        matchDoctor.$or = searchCond;
      }
    }

    let doctorIds = await DoctorModel.find(matchDoctor).distinct("_id");
    if (doctorIds.length === 0 && (hospitalId || departmentId)) {
      const fallbackMatch: Record<string, unknown> = {
        isActive: { $ne: false },
      };
      doctorIds = await DoctorModel.find(fallbackMatch).distinct("_id");
    }
    if (doctorIds.length === 0) {
      return successListResponse(res, [], buildPaginationMeta(0, page, limit));
    }

    const visits = await ScanShareVisitModel.find({
      visitDate: { $gte: start, $lte: end },
      visitStatus: { $in: [ScanShareVisitStatus.REGISTERED, ScanShareVisitStatus.COMPLETED] },
      doctorId: { $in: doctorIds },
    })
      .select("doctorId isFollowUp treatmentOutcome collaboratingDoctorIds")
      .lean();

    // Select doctor fields for name and specialization
    const doctorList = await DoctorModel.find({ _id: { $in: doctorIds } })
      .select("firstName lastName email specialization primarySpecializationId")
      .populate("primarySpecializationId", "name")
      .lean();

    const byDoctor = new Map<
      string,
      {
        count: number;
        followUp: number;
        success: number;
        withOutcome: number;
        collaborating: number;
      }
    >();

    for (const d of doctorList) {
      byDoctor.set(d._id.toString(), {
        count: 0,
        followUp: 0,
        success: 0,
        withOutcome: 0,
        collaborating: 0,
      });
    }

    for (const v of visits) {
      const did = (v.doctorId as Types.ObjectId)?.toString();
      if (!did || !byDoctor.has(did)) continue;
      const row = byDoctor.get(did)!;
      row.count += 1;
      if (v.isFollowUp) row.followUp += 1;
      if (v.treatmentOutcome) {
        row.withOutcome += 1;
        if (v.treatmentOutcome === "SUCCESS") row.success += 1;
      }
      if (
        Array.isArray(v.collaboratingDoctorIds) &&
        v.collaboratingDoctorIds.length > 0
      )
        row.collaborating += 1;
    }

    const totalVisits = visits.length;
    const rows = doctorList.map((d) => {
      const id = d._id.toString();
      const row = byDoctor.get(id) || {
        count: 0,
        followUp: 0,
        success: 0,
        withOutcome: 0,
        collaborating: 0,
      };
      const docAny = d as any;
      // Use specialization field (string) or populated primarySpecializationId
      const spec =
        docAny.specialization || docAny.primarySpecializationId?.name || "";
      // Build fullName from firstName + lastName
      let rawName = "";
      if (docAny.firstName || docAny.lastName) {
        rawName = `${docAny.firstName || ""} ${docAny.lastName || ""}`.trim();
      }
      if (!rawName && docAny.email) {
        rawName = docAny.email.split("@")[0];
      }
      if (!rawName) {
        rawName = id.slice(-6);
      }
      const displayName = rawName.startsWith("Dr.")
        ? rawName
        : `Dr. ${rawName}`;
      return {
        doctorId: id,
        name: displayName,
        email: docAny.email || "",
        medicalSpecialty: spec,
        totalConsultations: row.count,
        followUpRate:
          row.count > 0
            ? Math.round((row.followUp / row.count) * 10000) / 100
            : 0,
        accuracyOfDiagnoses: 0, // Placeholder until diagnosis verification is implemented
        treatmentSuccessRate:
          row.withOutcome > 0
            ? Math.round((row.success / row.withOutcome) * 10000) / 100
            : 0,
        interdisciplinaryCollaborationRate:
          row.count > 0
            ? Math.round((row.collaborating / row.count) * 10000) / 100
            : 0,
        physicianWorkloadBalance:
          totalVisits > 0
            ? Math.round((row.count / totalVisits) * 10000) / 100
            : 0,
      };
    });

    const sortKey =
      sortBy === "name"
        ? "name"
        : sortBy === "medicalSpecialty"
        ? "medicalSpecialty"
        : sortBy;
    const validSortKeys = [
      "name",
      "medicalSpecialty",
      "followUpRate",
      "treatmentSuccessRate",
      "interdisciplinaryCollaborationRate",
      "physicianWorkloadBalance",
    ];
    const key = validSortKeys.includes(sortKey) ? sortKey : "name";
    rows.sort((a, b) => {
      const aVal = a[key as keyof typeof a];
      const bVal = b[key as keyof typeof b];
      if (typeof aVal === "string" && typeof bVal === "string")
        return sortOrder === 1
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      const an = Number(aVal) ?? 0;
      const bn = Number(bVal) ?? 0;
      return sortOrder === 1 ? an - bn : bn - an;
    });

    const total = rows.length;
    const skip = (page - 1) * limit;
    const data = rows.slice(skip, skip + limit);

    return successListResponse(
      res,
      data,
      buildPaginationMeta(total, page, limit)
    );
  } catch (error: any) {
    console.error("getPhysicianAnalyticsTable error:", error);
    return errorResponse(
      res,
      error.message || "Failed to get physician analytics table",
      STATUS_CODE.ERROR
    );
  }
};
