import { Request, Response } from "express";
import { Types } from "mongoose";
import { ScanShareVisitModel, ScanShareVisitStatus } from "../../models/ScanShareVisit";
import { VisitAssessmentModel } from "../../models/VisitAssessment";
import { VisitDischargeSummaryModel } from "../../models/VisitDischargeSummary";
import { VisitDayCareBilling } from "../../models/VisitDayCareBilling";
import { IncidentReportModel, INFECTION_INCIDENT_TYPES, PHYSICAL_INCIDENT_TYPES } from "../../models/IncidentReport";
import { ResourceUtilizationModel } from "../../models/ResourceUtilization";
import { DoctorModel } from "../../models/Doctor";
import { NurseModel } from "../../models/Nurse";
import { successResponse, errorResponse } from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";
import {
  parseAnalyticsParams,
  toObjectId,
  pct,
  formatPeriodLabel,
  buildDateGroupExpr,
  getHospitalId,
} from "../../utils/analytics.helpers";
import {
  buildCacheKey,
  getCached,
  setCached,
  CACHE_TTL,
} from "../../utils/analytics.cache";

const CTRL = "[dashboardAnalytics]";



export const getRecoveryRates = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-recovery-rates", {
      from: params.start.toISOString(), to: params.end.toISOString(), groupBy: params.groupBy,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, any> = {
      visitDate: { $gte: params.start, $lte: params.end },
      visitStatus: { $in: [ScanShareVisitStatus.COMPLETED, ScanShareVisitStatus.REGISTERED] },
    };

    const pipeline: object[] = [
      ...(hospitalId ? [
        {
          $lookup: {
            from: "Patients",
            localField: "patientId",
            foreignField: "_id",
            as: "patientInfo",
          },
        },
        { $unwind: "$patientInfo" },
        {
          $match: {
            ...match,
            "patientInfo.hospitalId": toObjectId(hospitalId),
          },
        }
      ] : [
        { $match: match }
      ]),
      {
        $group: {
          _id: buildDateGroupExpr("visitDate", params.groupBy),
          newPatients: { $sum: 1 },
          recoveredPatients: {
            $sum: { $cond: [{ $eq: ["$treatmentOutcome", "SUCCESS"] }, 1, 0] },
          },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.week": 1 } },
      {
        $project: {
          _id: 0,
          period: "$$ROOT._id",
          newPatients: 1,
          recoveredPatients: 1,
        },
      },
    ];

    const rawResults = await ScanShareVisitModel.aggregate(pipeline as any[]);
    const totalNew = rawResults.reduce((s: number, r: any) => s + r.newPatients, 0);
    const totalRecovered = rawResults.reduce((s: number, r: any) => s + r.recoveredPatients, 0);

    const recoveryRates = rawResults.map((r: any) => ({
      period: formatPeriodLabel(r.period, params.groupBy),
      newPatients: r.newPatients,
      recoveredPatients: r.recoveredPatients,
    }));

    const data = {
      recoveryRates,
      overallRecoveryRate: pct(totalRecovered, totalNew),
      meta: { groupBy: params.groupBy, from: params.start.toISOString(), to: params.end.toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getRecoveryRates error:`, error);
    return errorResponse(res, error.message || "Failed to get recovery rates", STATUS_CODE.ERROR);
  }
};

export const getComplicationRates = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-complication-rates", {
      from: params.start.toISOString(), to: params.end.toISOString(), groupBy: params.groupBy,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, any> = {
      createdAt: { $gte: params.start, $lte: params.end },
    };

    const pipeline: object[] = [
      ...(hospitalId ? [
        {
          $lookup: {
            from: "Patients",
            localField: "patientId",
            foreignField: "_id",
            as: "patientInfo",
          },
        },
        { $unwind: "$patientInfo" },
        {
          $match: {
            ...match,
            "patientInfo.hospitalId": toObjectId(hospitalId),
          },
        }
      ] : [
        { $match: match }
      ]),
      {
        $group: {
          _id: buildDateGroupExpr("createdAt", params.groupBy),
          totalVisits: { $sum: 1 },
          withComplications: {
            $sum: {
              $cond: [{ $gt: [{ $size: { $ifNull: ["$complications", []] } }, 0] }, 1, 0],
            },
          },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
    ];

    const rawResults = await VisitAssessmentModel.aggregate(pipeline as any[]);
    const totalVisits = rawResults.reduce((s: number, r: any) => s + r.totalVisits, 0);
    const totalWithComp = rawResults.reduce((s: number, r: any) => s + r.withComplications, 0);

    const complicationRates = rawResults.map((r: any) => ({
      period: formatPeriodLabel(r._id, params.groupBy),
      totalVisits: r.totalVisits,
      withComplications: r.withComplications,
      rate: pct(r.withComplications, r.totalVisits),
    }));

    const data = {
      complicationRates,
      overallComplicationRate: pct(totalWithComp, totalVisits),
      meta: { groupBy: params.groupBy, from: params.start.toISOString(), to: params.end.toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getComplicationRates error:`, error);
    return errorResponse(res, error.message || "Failed to get complication rates", STATUS_CODE.ERROR);
  }
};

export const getComplicationTypes = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-complication-types", {
      from: params.start.toISOString(), to: params.end.toISOString(), limit: params.limit,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, any> = {
      createdAt: { $gte: params.start, $lte: params.end },
      "complications.0": { $exists: true },
    };

    const pipeline: object[] = [
      ...(hospitalId ? [
        {
          $lookup: {
            from: "Patients",
            localField: "patientId",
            foreignField: "_id",
            as: "patientInfo",
          },
        },
        { $unwind: "$patientInfo" },
        {
          $match: {
            ...match,
            "patientInfo.hospitalId": toObjectId(hospitalId),
          },
        }
      ] : [
        { $match: match }
      ]),
      { $unwind: "$complications" },
      { $match: { complications: { $nin: [null, ""] } } },
      { $group: { _id: "$complications", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: params.limit },
    ];

    const rawResults = await VisitAssessmentModel.aggregate(pipeline as any[]);
    const grandTotal = rawResults.reduce((s: number, r: any) => s + r.count, 0);

    const complicationTypes = rawResults.map((r: any) => ({
      type: r._id,
      count: r.count,
      percentage: pct(r.count, grandTotal),
    }));

    const data = {
      complicationTypes,
      meta: { totalComplications: grandTotal, from: params.start.toISOString(), to: params.end.toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getComplicationTypes error:`, error);
    return errorResponse(res, error.message || "Failed to get complication types", STATUS_CODE.ERROR);
  }
};

export const getSurvivalRates = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-survival-rates", {
      from: params.start.toISOString(), to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, any> = {
      createdAt: { $gte: params.start, $lte: params.end },
      diseaseCategory: { $exists: true, $ne: null },
      outcomeStatus: { $in: ["SURVIVED", "DECEASED", "TRANSFERRED"] },
    };

    const pipeline: object[] = [
      ...(hospitalId ? [
        {
          $lookup: {
            from: "Patients",
            localField: "patientId",
            foreignField: "_id",
            as: "patientInfo",
          },
        },
        { $unwind: "$patientInfo" },
        {
          $match: {
            ...match,
            "patientInfo.hospitalId": toObjectId(hospitalId),
          },
        }
      ] : [
        { $match: match }
      ]),
      {
        $group: {
          _id: "$diseaseCategory",
          total: { $sum: 1 },
          survived: { $sum: { $cond: [{ $eq: ["$outcomeStatus", "SURVIVED"] }, 1, 0] } },
          deceased: { $sum: { $cond: [{ $eq: ["$outcomeStatus", "DECEASED"] }, 1, 0] } },
        },
      },
      { $sort: { total: -1 } },
      { $limit: params.limit },
      {
        $project: {
          _id: 0,
          disease: "$_id",
          total: 1,
          survived: 1,
          deceased: 1,
          survivalRate: {
            $round: [{ $multiply: [{ $divide: ["$survived", { $max: ["$total", 1] }] }, 100] }, 1],
          },
        },
      },
    ];

    const survivalRates = await VisitDischargeSummaryModel.aggregate(pipeline as any[]);

    const data = {
      survivalRates,
      meta: {
        totalDischarges: survivalRates.reduce((s: number, r: any) => s + r.total, 0),
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getSurvivalRates error:`, error);
    return errorResponse(res, error.message || "Failed to get survival rates", STATUS_CODE.ERROR);
  }
};

export const getServiceDelivery = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-service-delivery", {
      from: params.start.toISOString(), to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, any> = {
      visitDate: { $gte: params.start, $lte: params.end },
      consultationStartedAt: { $exists: true },
    };

    const pipeline: object[] = [
      ...(hospitalId ? [
        {
          $lookup: {
            from: "Patients",
            localField: "patientId",
            foreignField: "_id",
            as: "patientInfo",
          },
        },
        { $unwind: "$patientInfo" },
        {
          $match: {
            ...match,
            "patientInfo.hospitalId": toObjectId(hospitalId),
          },
        }
      ] : [
        { $match: match }
      ]),
      {
        $addFields: {
          waitMinutes: {
            $divide: [
              { $subtract: ["$consultationStartedAt", "$visitDate"] },
              60000,
            ],
          },
        },
      },
      { $match: { waitMinutes: { $gte: 0 } } },
      {
        $addFields: {
          serviceCategory: {
            $switch: {
              branches: [
                { case: { $in: ["$visitType", ["INPATIENT", "BED", "Ward"]] }, then: "Bed Wait" },
                { case: { $in: ["$visitType", ["SURGERY", "PRE_OP", "Pre-Op"]] }, then: "Pre-op Wait" },
                { case: { $in: ["$visitType", ["OUTPATIENT", "OPD", "Outpatient"]] }, then: "Out-patient Wait" },
              ],
              default: "Non-Ward Wait",
            },
          },
        },
      },
      {
        $group: {
          _id: "$serviceCategory",
          count: { $sum: 1 },
          avgWaitMinutes: { $avg: "$waitMinutes" },
        },
      },
      {
        $project: {
          _id: 0,
          category: "$_id",
          count: 1,
          avgWaitMinutes: { $round: ["$avgWaitMinutes", 0] },
        },
      },
      { $sort: { count: -1 } },
    ];

    const serviceDelivery = await ScanShareVisitModel.aggregate(pipeline as any[]);

    const data = {
      serviceDelivery,
      meta: { from: params.start.toISOString(), to: params.end.toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getServiceDelivery error:`, error);
    return errorResponse(res, error.message || "Failed to get service delivery data", STATUS_CODE.ERROR);
  }
};

export const getInfectionRates = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-infection-rates", {
      from: params.start.toISOString(), to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = {
      type: { $in: INFECTION_INCIDENT_TYPES },
      reportedAt: { $gte: params.start, $lte: params.end },
    };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) match.hospitalId = hospitalObjId;

    const pipeline: object[] = [
      { $match: match },
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ];

    const rawResults = await IncidentReportModel.aggregate(pipeline as any[]);
    const totalInfections = rawResults.reduce((s: number, r: any) => s + r.count, 0);

    const INFECTION_LABELS: Record<string, string> = {
      SURGICAL_SITE_INFECTION: "Surgical Site Infections",
      VAP: "Ventilator-associated Pneumonia",
      BLOODSTREAM_INFECTION: "Bloodstream Infection",
      C_DIFF_INFECTION: "Clostridium Infection",
    };

    const infectionRates = rawResults.map((r: any) => ({
      type: INFECTION_LABELS[r._id] ?? r._id,
      typeKey: r._id,
      count: r.count,
      percentage: pct(r.count, totalInfections),
    }));

    let totalAdmissions = 0;
    if (hospitalId) {
      const admRaw = await ScanShareVisitModel.aggregate([
        { $match: { visitDate: { $gte: params.start, $lte: params.end } } },
        {
          $lookup: {
            from: "Patients",
            localField: "patientId",
            foreignField: "_id",
            as: "pi",
          },
        },
        { $unwind: "$pi" },
        { $match: { "pi.hospitalId": toObjectId(hospitalId) } },
        { $count: "count" },
      ]);
      totalAdmissions = admRaw[0]?.count ?? 0;
    } else {
      totalAdmissions = await ScanShareVisitModel.countDocuments({
        visitDate: { $gte: params.start, $lte: params.end },
      });
    }

    const data = {
      infectionRates,
      totalInfectionIncidents: totalInfections,
      infectionRatePercentOfAdmissions: pct(totalInfections, totalAdmissions),
      meta: { from: params.start.toISOString(), to: params.end.toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getInfectionRates error:`, error);
    return errorResponse(res, error.message || "Failed to get infection rates", STATUS_CODE.ERROR);
  }
};

export const getResourceUtilization = async (req: Request, res: Response): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-resource-utilization", { hospitalId });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = { resourceType: "DEPARTMENT" };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) match.hospitalId = hospitalObjId;

    const pipeline: object[] = [
      { $match: match },
      { $sort: { recordedDate: -1 } },
      {
        $group: {
          _id: "$resourceId",
          resourceName: { $first: "$resourceName" },
          utilizationRate: { $first: "$utilizationRate" },
          capacity: { $first: "$capacity" },
          activeCount: { $first: "$activeCount" },
          snapshotDate: { $first: "$recordedDate" },
        },
      },
      { $sort: { utilizationRate: -1 } },
      {
        $project: {
          _id: 0,
          resourceId: "$_id",
          name: "$resourceName",
          utilizationRate: 1,
          capacity: 1,
          activeCount: 1,
          snapshotDate: 1,
        },
      },
    ];

    const resourceUtilization = await ResourceUtilizationModel.aggregate(pipeline as any[]);

    const data = {
      resourceUtilization,
      meta: { snapshotDate: new Date().toISOString(), hospitalId, cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_MEDIUM);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getResourceUtilization error:`, error);
    return errorResponse(res, error.message || "Failed to get resource utilization", STATUS_CODE.ERROR);
  }
};

export const getEquipmentUtilization = async (req: Request, res: Response): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-equipment-utilization", { hospitalId });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = { resourceType: "EQUIPMENT" };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) match.hospitalId = hospitalObjId;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const pipeline: object[] = [
      { $match: { ...match, recordedDate: { $gte: sevenDaysAgo } } },
      { $sort: { recordedDate: 1 } },
      {
        $group: {
          _id: "$resourceName",
          sparkline: {
            $push: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$recordedDate" } },
              value: "$utilizationRate",
            },
          },
          currentRate: { $last: "$utilizationRate" },
          prevRate: { $first: "$utilizationRate" },
        },
      },
    ];

    const rawResults = await ResourceUtilizationModel.aggregate(pipeline as any[]);

    const equipmentUtilization = rawResults.map((r: any) => {
      const weekChange = r.prevRate > 0
        ? Math.round(((r.currentRate - r.prevRate) / r.prevRate) * 10000) / 100
        : 0;
      return {
        name: r._id,
        currentRate: r.currentRate,
        changePercent: Math.abs(weekChange),
        changeDirection: weekChange >= 0 ? "UP" : "DOWN",
        sparkline: r.sparkline,
      };
    });

    const data = {
      equipmentUtilization,
      meta: { daysBack: 7, hospitalId, cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_MEDIUM);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getEquipmentUtilization error:`, error);
    return errorResponse(res, error.message || "Failed to get equipment utilization", STATUS_CODE.ERROR);
  }
};

export const getFacilityUtilization = async (req: Request, res: Response): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-facility-utilization", { hospitalId });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = { resourceType: "FACILITY" };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) match.hospitalId = hospitalObjId;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const pipeline: object[] = [
      { $match: { ...match, recordedDate: { $gte: sevenDaysAgo } } },
      { $sort: { recordedDate: 1 } },
      {
        $group: {
          _id: "$resourceName",
          sparkline: { $push: { date: { $dateToString: { format: "%Y-%m-%d", date: "$recordedDate" } }, value: "$utilizationRate" } },
          currentRate: { $last: "$utilizationRate" },
          prevRate: { $first: "$utilizationRate" },
        },
      },
    ];

    const rawResults = await ResourceUtilizationModel.aggregate(pipeline as any[]);
    const facilityUtilization = rawResults.map((r: any) => {
      const weekChange = r.prevRate > 0
        ? Math.round(((r.currentRate - r.prevRate) / r.prevRate) * 10000) / 100
        : 0;
      return {
        name: r._id,
        currentRate: r.currentRate,
        changePercent: Math.abs(weekChange),
        changeDirection: weekChange >= 0 ? "UP" : "DOWN",
        sparkline: r.sparkline,
      };
    });

    const data = {
      facilityUtilization,
      meta: { daysBack: 7, hospitalId, cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_MEDIUM);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getFacilityUtilization error:`, error);
    return errorResponse(res, error.message || "Failed to get facility utilization", STATUS_CODE.ERROR);
  }
};

export const getStaffAllocation = async (req: Request, res: Response): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-staff-allocation", { hospitalId });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    let activePatientsToday = 0;
    if (hospitalId) {
      const activeRaw = await ScanShareVisitModel.aggregate([
        {
          $match: {
            visitDate: { $gte: todayStart, $lte: now },
            visitStatus: { $in: [ScanShareVisitStatus.REGISTERED, ScanShareVisitStatus.PENDING] },
          },
        },
        {
          $lookup: {
            from: "Patients",
            localField: "patientId",
            foreignField: "_id",
            as: "patientInfo",
          },
        },
        { $unwind: "$patientInfo" },
        { $match: { "patientInfo.hospitalId": toObjectId(hospitalId) } },
        { $count: "count" },
      ]);
      activePatientsToday = activeRaw[0]?.count ?? 0;
    } else {
      activePatientsToday = await ScanShareVisitModel.countDocuments({
        visitDate: { $gte: todayStart, $lte: now },
        visitStatus: { $in: [ScanShareVisitStatus.REGISTERED, ScanShareVisitStatus.PENDING] },
      });
    }

    const docQuery: Record<string, any> = { isActive: { $ne: false }, currentStatus: { $ne: "UNAVAILABLE" } };
    const nurseQuery: Record<string, any> = { isActive: { $ne: false } };
    if (hospitalId) {
      const hospitalObjId = toObjectId(hospitalId);
      docQuery.$or = [
        { hospital_id: hospitalObjId },
        { assignedHospitalUnitIds: hospitalObjId },
      ];
      nurseQuery.$or = [
        { hospital_id: hospitalObjId },
        { assignedHospitalUnitIds: hospitalObjId },
      ];
    }

    const [availableDoctors, availableNurses] = await Promise.all([
      DoctorModel.countDocuments(docQuery),
      NurseModel.countDocuments(nurseQuery),
    ]);

    const totalStaff = availableDoctors + availableNurses;
    const patientToStaffRatio = totalStaff > 0
      ? Math.round((activePatientsToday / totalStaff) * 10) / 10
      : 0;

    const data = {
      activePatientsToday,
      availableDoctors,
      availableNurses,
      totalAvailableStaff: totalStaff,
      patientToStaffRatio,
      allocationStatus:
        patientToStaffRatio > 5 ? "CRITICAL" :
        patientToStaffRatio > 3 ? "HIGH" :
        patientToStaffRatio > 1 ? "NORMAL" : "LOW",
      meta: { asOf: now.toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_LIVE);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getStaffAllocation error:`, error);
    return errorResponse(res, error.message || "Failed to get staff allocation", STATUS_CODE.ERROR);
  }
};

export const getRevenuePerPatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-revenue-per-patient", {
      from: params.start.toISOString(), to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const sparklineMatch = { date: { $gte: sevenDaysAgo }, status: { $ne: "Draft" } };
    const sparklinePipeline: object[] = [
      ...(hospitalId ? [
        {
          $lookup: {
            from: "Patients",
            localField: "patient",
            foreignField: "_id",
            as: "patientInfo",
          },
        },
        { $unwind: "$patientInfo" },
        {
          $match: {
            ...sparklineMatch,
            "patientInfo.hospitalId": toObjectId(hospitalId),
          },
        }
      ] : [
        { $match: sparklineMatch }
      ]),
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          totalRevenue: { $sum: "$totalGross" },
          uniquePatients: { $addToSet: "$patient" },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id",
          totalRevenue: { $round: ["$totalRevenue", 2] },
          patientCount: { $size: "$uniquePatients" },
          revenuePerPatient: {
            $round: [
              { $divide: ["$totalRevenue", { $max: [{ $size: "$uniquePatients" }, 1] }] },
              2,
            ],
          },
        },
      },
    ];

    const kpiMatch = {
      date: { $gte: params.start, $lte: params.end },
      status: { $ne: "Draft" },
    };
    const kpiPipeline: object[] = [
      ...(hospitalId ? [
        {
          $lookup: {
            from: "Patients",
            localField: "patient",
            foreignField: "_id",
            as: "patientInfo",
          },
        },
        { $unwind: "$patientInfo" },
        {
          $match: {
            ...kpiMatch,
            "patientInfo.hospitalId": toObjectId(hospitalId),
          },
        }
      ] : [
        { $match: kpiMatch }
      ]),
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalGross" },
          uniquePatients: { $addToSet: "$patient" },
        },
      },
    ];

    const [sparklineRaw, [kpiRaw]] = await Promise.all([
      VisitDayCareBilling.aggregate(sparklinePipeline as any[]),
      VisitDayCareBilling.aggregate(kpiPipeline as any[]),
    ]);

    const totalRevenue = kpiRaw?.totalRevenue ?? 0;
    const uniquePatients = kpiRaw?.uniquePatients?.length ?? 0;
    const revenuePerPatient = uniquePatients > 0
      ? Math.round((totalRevenue / uniquePatients) * 100) / 100
      : 0;

    const data = {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      uniquePatients,
      revenuePerPatient,
      sparkline: sparklineRaw,
      meta: { from: params.start.toISOString(), to: params.end.toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getRevenuePerPatient error:`, error);
    return errorResponse(res, error.message || "Failed to get revenue per patient", STATUS_CODE.ERROR);
  }
};

export const getPatientSafety = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-patient-safety", {
      from: params.start.toISOString(), to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const incidentMatch: Record<string, unknown> = {
      reportedAt: { $gte: params.start, $lte: params.end },
      type: { $in: ["COMPLAINT", "MEDICATION_ERROR"] },
    };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) incidentMatch.hospitalId = hospitalObjId;

    let readmissionCount = 0;
    let totalVisits = 0;

    if (hospitalId) {
      const [readmissionRaw, totalVisitsRaw] = await Promise.all([
        VisitAssessmentModel.aggregate([
          {
            $match: {
              createdAt: { $gte: params.start, $lte: params.end },
              isReadmission: true,
            },
          },
          {
            $lookup: {
              from: "Patients",
              localField: "patientId",
              foreignField: "_id",
              as: "patientInfo",
            },
          },
          { $unwind: "$patientInfo" },
          { $match: { "patientInfo.hospitalId": toObjectId(hospitalId) } },
          { $count: "count" },
        ]),
        ScanShareVisitModel.aggregate([
          {
            $match: {
              visitDate: { $gte: params.start, $lte: params.end },
            },
          },
          {
            $lookup: {
              from: "Patients",
              localField: "patientId",
              foreignField: "_id",
              as: "patientInfo",
            },
          },
          { $unwind: "$patientInfo" },
          { $match: { "patientInfo.hospitalId": toObjectId(hospitalId) } },
          { $count: "count" },
        ]),
      ]);
      readmissionCount = readmissionRaw[0]?.count ?? 0;
      totalVisits = totalVisitsRaw[0]?.count ?? 0;
    } else {
      const [rCount, tVisits] = await Promise.all([
        VisitAssessmentModel.countDocuments({
          createdAt: { $gte: params.start, $lte: params.end },
          isReadmission: true,
        }),
        ScanShareVisitModel.countDocuments({
          visitDate: { $gte: params.start, $lte: params.end },
        }),
      ]);
      readmissionCount = rCount;
      totalVisits = tVisits;
    }

    const [incidentCounts] = await Promise.all([
      IncidentReportModel.aggregate([
        { $match: incidentMatch },
        { $group: { _id: "$type", count: { $sum: 1 } } },
      ]),
    ]);

    const incidentByType = new Map(incidentCounts.map((r: any) => [r._id, r.count]));

    const data = {
      readmissionRate: pct(readmissionCount, totalVisits),
      readmissionCount,
      complaintsCount: incidentByType.get("COMPLAINT") ?? 0,
      medicationErrorsCount: incidentByType.get("MEDICATION_ERROR") ?? 0,
      meta: {
        totalVisitsInPeriod: totalVisits,
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getPatientSafety error:`, error);
    return errorResponse(res, error.message || "Failed to get patient safety data", STATUS_CODE.ERROR);
  }
};

export const getIncidentReporting = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-incident-reporting", {
      from: params.start.toISOString(), to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = {
      type: { $in: PHYSICAL_INCIDENT_TYPES },
      reportedAt: { $gte: params.start, $lte: params.end },
    };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) match.hospitalId = hospitalObjId;

    const pipeline: object[] = [
      { $match: match },
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ];

    const rawResults = await IncidentReportModel.aggregate(pipeline as any[]);
    const grandTotal = rawResults.reduce((s: number, r: any) => s + r.count, 0);

    const INCIDENT_LABELS: Record<string, string> = {
      CUTS_AND_PUNCTURES: "Cuts and Punctures",
      MULTIPLE_TRAUMA: "Multiple Trauma",
      FRACTURES: "Fractures",
      BRUISES: "Bruises",
      SORENESS_PAIN: "Soreness Pain",
      SPRAINS_AND_STRAINS: "Sprains and Strains",
    };

    const incidents = rawResults.map((r: any) => ({
      type: INCIDENT_LABELS[r._id] ?? r._id,
      typeKey: r._id,
      count: r.count,
      percentage: pct(r.count, grandTotal),
    }));

    const data = {
      incidents,
      totalIncidents: grandTotal,
      meta: { from: params.start.toISOString(), to: params.end.toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getIncidentReporting error:`, error);
    return errorResponse(res, error.message || "Failed to get incident reporting data", STATUS_CODE.ERROR);
  }
};
