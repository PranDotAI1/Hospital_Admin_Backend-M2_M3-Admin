import { Request, Response } from "express";
import { Types } from "mongoose";
import { ScanShareVisitModel, ScanShareVisitStatus } from "../../models/ScanShareVisit";
import { PatientModel } from "../../models/Patient";
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
  generatePeriodSkeleton,
  fillPeriodGaps,
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

    const pipeline: object[] = [
      ...(hospitalId ? [{ $match: { hospitalId: toObjectId(hospitalId) } }] : []),
      { $unwind: "$visits" },
      { $replaceRoot: { newRoot: "$visits" } },
      {
        $match: {
          visitDate: { $gte: params.start, $lte: params.end },
          visitStatus: { $in: ["COMPLETED", "REGISTERED"] },
        },
      },
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

    const rawResults = await PatientModel.aggregate(pipeline as any[]);
    const totalNew = rawResults.reduce((s: number, r: any) => s + r.newPatients, 0);
    const totalRecovered = rawResults.reduce((s: number, r: any) => s + r.recoveredPatients, 0);

    const rawRates = rawResults.map((r: any) => ({
      period: formatPeriodLabel(r.period, params.groupBy),
      newPatients: r.newPatients,
      recoveredPatients: r.recoveredPatients,
    }));

    // Always render a full skeleton so the chart shows all buckets even when
    // most periods have no data (avoids a single lonely bar).
    const skeleton = generatePeriodSkeleton(params.start, params.end, params.groupBy);
    const recoveryRates = fillPeriodGaps(
      skeleton,
      rawRates,
      "period",
      (period) => ({ period, newPatients: 0, recoveredPatients: 0 })
    );

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

    const pipeline: object[] = [
      ...(hospitalId ? [{ $match: { hospitalId: toObjectId(hospitalId) } }] : []),
      { $unwind: "$visits" },
      { $replaceRoot: { newRoot: "$visits" } },
      {
        $match: {
          visitDate: { $gte: params.start, $lte: params.end },
        },
      },
      {
        $lookup: {
          from: "visit_assessments",
          localField: "visitId",
          foreignField: "visitId",
          as: "assessment",
        },
      },
      {
        $addFields: {
          complications: { $arrayElemAt: ["$assessment.complications", 0] },
        },
      },
      {
        $group: {
          _id: buildDateGroupExpr("visitDate", params.groupBy),
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

    const rawResults = await PatientModel.aggregate(pipeline as any[]);
    const totalVisits = rawResults.reduce((s: number, r: any) => s + r.totalVisits, 0);
    const totalWithComp = rawResults.reduce((s: number, r: any) => s + r.withComplications, 0);

    const rawRates = rawResults.map((r: any) => ({
      period: formatPeriodLabel(r._id, params.groupBy),
      totalVisits: r.totalVisits,
      withComplications: r.withComplications,
      rate: pct(r.withComplications, r.totalVisits),
    }));

    // Fill in zero-valued buckets for every period in the range so the chart
    // always displays a complete x-axis instead of a single lonely bar.
    const skeleton = generatePeriodSkeleton(params.start, params.end, params.groupBy);
    const complicationRates = fillPeriodGaps(
      skeleton,
      rawRates,
      "period",
      (period) => ({ period, totalVisits: 0, withComplications: 0, rate: 0 })
    );

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
      diagnosis: { $exists: true, $ne: null },
      conditionAtDischarge: { $exists: true, $ne: null },
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
          _id: "$diagnosis",
          total: { $sum: 1 },
          survived: { 
            $sum: { 
              $cond: [
                { $in: ["$conditionAtDischarge", ["Stable", "Improved", "Recovered", "SURVIVED"]] }, 
                1, 
                0
              ] 
            } 
          },
          deceased: { 
            $sum: { 
              $cond: [
                { $in: ["$conditionAtDischarge", ["Critical", "Deceased", "DECEASED"]] }, 
                1, 
                0
              ] 
            } 
          },
        },
      },
      { $sort: { total: -1 } },
      { $limit: params.limit },
      {
        $project: {
          _id: 0,
          period: "$_id",
          total: 1,
          survived: 1,
          deceased: 1,
          rate: {
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

    const pipeline: object[] = [
      ...(hospitalId ? [{ $match: { hospitalId: toObjectId(hospitalId) } }] : []),
      { $unwind: "$visits" },
      { $replaceRoot: { newRoot: "$visits" } },
      {
        $match: {
          visitDate: { $gte: params.start, $lte: params.end },
        },
      },
      {
        $group: {
          _id: null,
          totalWaitTimeMs: {
            $sum: {
              $cond: [
                { $ifNull: ["$consultationStartedAt", false] },
                { $max: [0, { $subtract: ["$consultationStartedAt", "$visitDate"] }] },
                0
              ]
            }
          },
          waitCount: {
            $sum: {
              $cond: [
                { $ifNull: ["$consultationStartedAt", false] },
                1,
                0
              ]
            }
          },
          totalBedWaitTimeMs: {
            $sum: {
              $cond: [
                { $and: [{ $in: ["$visitType", ["INPATIENT", "BED", "Ward"]] }, { $ifNull: ["$consultationStartedAt", false] }] },
                { $max: [0, { $subtract: ["$consultationStartedAt", "$visitDate"] }] },
                0
              ]
            }
          },
          bedWaitCount: {
            $sum: {
              $cond: [
                { $and: [{ $in: ["$visitType", ["INPATIENT", "BED", "Ward"]] }, { $ifNull: ["$consultationStartedAt", false] }] },
                1,
                0
              ]
            }
          },
          totalDocWaitTimeMs: {
            $sum: {
              $cond: [
                { $and: [{ $in: ["$visitType", ["OUTPATIENT", "OPD", "Outpatient"]] }, { $ifNull: ["$consultationStartedAt", false] }] },
                { $max: [0, { $subtract: ["$consultationStartedAt", "$visitDate"] }] },
                0
              ]
            }
          },
          docWaitCount: {
            $sum: {
              $cond: [
                { $and: [{ $in: ["$visitType", ["OUTPATIENT", "OPD", "Outpatient"]] }, { $ifNull: ["$consultationStartedAt", false] }] },
                1,
                0
              ]
            }
          },
          totalStayTimeMs: {
            $sum: {
              $cond: [
                { $and: [{ $in: ["$visitType", ["INPATIENT", "BED", "Ward"]] }, { $ifNull: ["$consultationEndedAt", false] }] },
                { $max: [0, { $subtract: ["$consultationEndedAt", "$visitDate"] }] },
                0
              ]
            }
          },
          stayCount: {
            $sum: {
              $cond: [
                { $and: [{ $in: ["$visitType", ["INPATIENT", "BED", "Ward"]] }, { $ifNull: ["$consultationEndedAt", false] }] },
                1,
                0
              ]
            }
          }
        }
      }
    ];

    const rawResult = await PatientModel.aggregate(pipeline as any[]);
    const aggs = rawResult[0] || {
      totalWaitTimeMs: 0, waitCount: 0,
      totalBedWaitTimeMs: 0, bedWaitCount: 0,
      totalDocWaitTimeMs: 0, docWaitCount: 0,
      totalStayTimeMs: 0, stayCount: 0
    };

    const waitMinutes = aggs.waitCount > 0 ? Math.round(aggs.totalWaitTimeMs / aggs.waitCount / 60000) : 0;
    const bedWaitMinutes = aggs.bedWaitCount > 0 ? Math.round(aggs.totalBedWaitTimeMs / aggs.bedWaitCount / 60000) : 0;
    const docWaitMinutes = aggs.docWaitCount > 0 ? Math.round(aggs.totalDocWaitTimeMs / aggs.docWaitCount / 60000) : 0;
    const stayDays = aggs.stayCount > 0 ? Math.round(aggs.totalStayTimeMs / aggs.stayCount / 86400000) : 0;

    const serviceDelivery = [
      { category: "Wait time", value: waitMinutes, unit: "min" },
      { category: "Length of stay", value: stayDays, unit: "Days" },
      { category: "To Get Bed", value: bedWaitMinutes, unit: "min" },
      { category: "To See Doctor", value: docWaitMinutes, unit: "min" }
    ];

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
      const admRaw = await PatientModel.aggregate([
        { $match: { hospitalId: toObjectId(hospitalId) } },
        { $unwind: "$visits" },
        { $match: { "visits.visitDate": { $gte: params.start, $lte: params.end } } },
        { $count: "count" },
      ]);
      totalAdmissions = admRaw[0]?.count ?? 0;
    } else {
      const admRaw = await PatientModel.aggregate([
        { $unwind: "$visits" },
        { $match: { "visits.visitDate": { $gte: params.start, $lte: params.end } } },
        { $count: "count" },
      ]);
      totalAdmissions = admRaw[0]?.count ?? 0;
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
          category: "$resourceName",
          percentage: "$utilizationRate",
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

    const equipment = rawResults.map((r: any) => {
      const weekChange = r.prevRate > 0
        ? Math.round(((r.currentRate - r.prevRate) / r.prevRate) * 10000) / 100
        : 0;
      return {
        name: r._id,
        percentage: r.currentRate,
        changePercent: Math.abs(weekChange),
        changeDirection: weekChange >= 0 ? "UP" : "DOWN",
        sparkline: r.sparkline,
      };
    });

    const data = {
      equipment,
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
    const facilities = rawResults.map((r: any) => {
      const weekChange = r.prevRate > 0
        ? Math.round(((r.currentRate - r.prevRate) / r.prevRate) * 10000) / 100
        : 0;
      return {
        name: r._id,
        percentage: r.currentRate,
        changePercent: Math.abs(weekChange),
        changeDirection: weekChange >= 0 ? "UP" : "DOWN",
        status: r.currentRate >= 85 ? "Critical" : "Optimal",
        sparkline: r.sparkline,
      };
    });

    const data = {
      facilities,
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
      const activeRaw = await PatientModel.aggregate([
        { $match: { hospitalId: toObjectId(hospitalId) } },
        { $unwind: "$visits" },
        {
          $match: {
            "visits.visitDate": { $gte: todayStart, $lte: now },
            "visits.visitStatus": { $in: ["REGISTERED", "PENDING"] },
          },
        },
        { $count: "count" },
      ]);
      activePatientsToday = activeRaw[0]?.count ?? 0;
    } else {
      const activeRaw = await PatientModel.aggregate([
        { $unwind: "$visits" },
        {
          $match: {
            "visits.visitDate": { $gte: todayStart, $lte: now },
            "visits.visitStatus": { $in: ["REGISTERED", "PENDING"] },
          },
        },
        { $count: "count" },
      ]);
      activePatientsToday = activeRaw[0]?.count ?? 0;
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

    const data = {
      staffAllocation: [
        { department: "Doctors", count: availableDoctors, status: availableDoctors >= activePatientsToday / 5 ? "Optimal" : "Critical" },
        { department: "Nurses", count: availableNurses, status: availableNurses >= activePatientsToday / 3 ? "Optimal" : "Critical" }
      ],
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
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-revenue-per-patient-v2", { hospitalId });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    
    const fourteenDaysAgo = new Date(sevenDaysAgo);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 7);

    const hospitalObjId = toObjectId(hospitalId);
    const baseMatch = hospitalObjId ? { hospitalId: hospitalObjId } : {};

    // 1. Appointments & Insurance (from Patient visits)
    const visitPipeline: object[] = [
      ...(hospitalId ? [{ $match: { hospitalId: hospitalObjId } }] : []),
      { $unwind: "$visits" },
      {
        $match: {
          "visits.visitDate": { $gte: fourteenDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$visits.visitDate" } },
          totalConsultationFee: { $sum: { $ifNull: ["$visits.consultationFee", 0] } },
          visitCount: { $sum: 1 },
          insuranceCount: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$insurance", []] } }, 0] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ];

    // 2. Procedures (from VisitDayCareBilling)
    const billingPipeline: object[] = [
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
            "patientInfo.hospitalId": hospitalObjId,
            date: { $gte: fourteenDaysAgo },
            status: { $ne: "Draft" },
          },
        }
      ] : [
        { $match: { date: { $gte: fourteenDaysAgo }, status: { $ne: "Draft" } } }
      ]),
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          totalGross: { $sum: "$totalGross" },
          billCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const [visitRaw, billingRaw] = await Promise.all([
      PatientModel.aggregate(visitPipeline as any[]),
      VisitDayCareBilling.aggregate(billingPipeline as any[]),
    ]);

    const calculateMetrics = (data: any[], dateField: string = "_id") => {
      const currentWeek = data.filter((d: any) => new Date(d[dateField]) >= sevenDaysAgo);
      const prevWeek = data.filter((d: any) => new Date(d[dateField]) < sevenDaysAgo);
      return { currentWeek, prevWeek };
    };

    const visitMetrics = calculateMetrics(visitRaw);
    const billingMetrics = calculateMetrics(billingRaw);

    // Appointments (Avg Fee)
    const currentApptFee = visitMetrics.currentWeek.reduce((sum, d) => sum + d.totalConsultationFee, 0);
    const currentApptCount = visitMetrics.currentWeek.reduce((sum, d) => sum + d.visitCount, 0);
    const prevApptFee = visitMetrics.prevWeek.reduce((sum, d) => sum + d.totalConsultationFee, 0);
    const prevApptCount = visitMetrics.prevWeek.reduce((sum, d) => sum + d.visitCount, 0);
    
    const currentApptAvg = currentApptCount > 0 ? Math.round(currentApptFee / currentApptCount) : 0;
    const prevApptAvg = prevApptCount > 0 ? Math.round(prevApptFee / prevApptCount) : 0;
    const apptChange = prevApptAvg > 0 ? Math.round(((currentApptAvg - prevApptAvg) / prevApptAvg) * 10000) / 100 : 0;
    const apptSparkline = visitMetrics.currentWeek.map(d => ({ date: d._id, value: d.visitCount > 0 ? Math.round(d.totalConsultationFee / d.visitCount) : 0 }));

    // Procedures (Avg Gross)
    const currentProcGross = billingMetrics.currentWeek.reduce((sum, d) => sum + d.totalGross, 0);
    const currentProcCount = billingMetrics.currentWeek.reduce((sum, d) => sum + d.billCount, 0);
    const prevProcGross = billingMetrics.prevWeek.reduce((sum, d) => sum + d.totalGross, 0);
    const prevProcCount = billingMetrics.prevWeek.reduce((sum, d) => sum + d.billCount, 0);
    
    const currentProcAvg = currentProcCount > 0 ? Math.round(currentProcGross / currentProcCount) : 0;
    const prevProcAvg = prevProcCount > 0 ? Math.round(prevProcGross / prevProcCount) : 0;
    const procChange = prevProcAvg > 0 ? Math.round(((currentProcAvg - prevProcAvg) / prevProcAvg) * 10000) / 100 : 0;
    const procSparkline = billingMetrics.currentWeek.map(d => ({ date: d._id, value: d.billCount > 0 ? Math.round(d.totalGross / d.billCount) : 0 }));

    // Insurance %
    const currentInsCount = visitMetrics.currentWeek.reduce((sum, d) => sum + d.insuranceCount, 0);
    const prevInsCount = visitMetrics.prevWeek.reduce((sum, d) => sum + d.insuranceCount, 0);
    const currentInsRate = currentApptCount > 0 ? Math.round((currentInsCount / currentApptCount) * 100) : 0;
    const prevInsRate = prevApptCount > 0 ? Math.round((prevInsCount / prevApptCount) * 100) : 0;
    const insChange = prevInsRate > 0 ? Math.round(((currentInsRate - prevInsRate) / prevInsRate) * 10000) / 100 : 0;
    const insSparkline = visitMetrics.currentWeek.map(d => ({ date: d._id, value: d.visitCount > 0 ? Math.round((d.insuranceCount / d.visitCount) * 100) : 0 }));

    const data = {
      appointments: {
        value: currentApptAvg,
        changePercent: Math.abs(apptChange),
        changeDirection: apptChange >= 0 ? "UP" : "DOWN",
        sparkline: apptSparkline,
      },
      procedures: {
        value: currentProcAvg,
        changePercent: Math.abs(procChange),
        changeDirection: procChange >= 0 ? "UP" : "DOWN",
        sparkline: procSparkline,
      },
      insuranceReimbursementRate: {
        value: currentInsRate,
        changePercent: Math.abs(insChange),
        changeDirection: insChange >= 0 ? "UP" : "DOWN",
        sparkline: insSparkline,
      },
      meta: { daysBack: 7, hospitalId, cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_MEDIUM);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getRevenuePerPatient error:`, error);
    return errorResponse(res, error.message || "Failed to get revenue per patient", STATUS_CODE.ERROR);
  }
};

export const getPatientSafety = async (req: Request, res: Response): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "dashboard-patient-safety-v2", { hospitalId });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const fourteenDaysAgo = new Date(sevenDaysAgo);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 7);

    const hospitalObjId = toObjectId(hospitalId);

    // 1. Visits Pipeline
    const visitsPipeline: object[] = [
      ...(hospitalId ? [{ $match: { hospitalId: hospitalObjId } }] : []),
      { $unwind: "$visits" },
      { $match: { "visits.visitDate": { $gte: fourteenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$visits.visitDate" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    // 2. Readmissions Pipeline
    const readmissionsPipeline: object[] = [
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
            "patientInfo.hospitalId": hospitalObjId,
            createdAt: { $gte: fourteenDaysAgo },
            isReadmission: true,
          },
        }
      ] : [
        { $match: { createdAt: { $gte: fourteenDaysAgo }, isReadmission: true } }
      ]),
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    // 3. Incidents Pipeline
    const incidentsMatch: Record<string, any> = {
      reportedAt: { $gte: fourteenDaysAgo },
      type: { $in: ["COMPLAINT", "MEDICATION_ERROR"] },
    };
    if (hospitalObjId) incidentsMatch.hospitalId = hospitalObjId;

    const incidentsPipeline: object[] = [
      { $match: incidentsMatch },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$reportedAt" } },
            type: "$type",
          },
          count: { $sum: 1 },
        },
      },
    ];

    const [visitsRaw, readmissionsRaw, incidentsRaw] = await Promise.all([
      PatientModel.aggregate(visitsPipeline as any[]),
      VisitAssessmentModel.aggregate(readmissionsPipeline as any[]),
      IncidentReportModel.aggregate(incidentsPipeline as any[]),
    ]);

    const calculateMetrics = (data: any[], dateField: string = "_id", valField: string = "count") => {
      const currentWeek = data.filter((d: any) => new Date(d[dateField]) >= sevenDaysAgo);
      const prevWeek = data.filter((d: any) => new Date(d[dateField]) < sevenDaysAgo);
      const currentVal = currentWeek.reduce((sum, d) => sum + d[valField], 0);
      const prevVal = prevWeek.reduce((sum, d) => sum + d[valField], 0);
      return { currentWeek, prevWeek, currentVal, prevVal };
    };

    const visitM = calculateMetrics(visitsRaw);
    const readmissionM = calculateMetrics(readmissionsRaw);
    
    const complaintData = incidentsRaw.filter(d => d._id.type === "COMPLAINT").map(d => ({ _id: d._id.date, count: d.count }));
    const complaintM = calculateMetrics(complaintData);
    
    const medErrorData = incidentsRaw.filter(d => d._id.type === "MEDICATION_ERROR").map(d => ({ _id: d._id.date, count: d.count }));
    const medErrorM = calculateMetrics(medErrorData);

    // Readmission Rate
    const currentReadmissionRate = visitM.currentVal > 0 ? Math.round((readmissionM.currentVal / visitM.currentVal) * 100) : 0;
    const prevReadmissionRate = visitM.prevVal > 0 ? Math.round((readmissionM.prevVal / visitM.prevVal) * 100) : 0;
    const readmissionChange = prevReadmissionRate > 0 ? Math.round(((currentReadmissionRate - prevReadmissionRate) / prevReadmissionRate) * 10000) / 100 : 0;
    
    const readmissionSparkline = readmissionM.currentWeek.map(d => {
      const v = visitM.currentWeek.find(v => v._id === d._id);
      return { date: d._id, value: v && v.count > 0 ? Math.round((d.count / v.count) * 100) : 0 };
    });

    // Complaints
    const complaintChange = complaintM.prevVal > 0 ? Math.round(((complaintM.currentVal - complaintM.prevVal) / complaintM.prevVal) * 10000) / 100 : 0;
    const complaintSparkline = complaintM.currentWeek.map(d => ({ date: d._id, value: d.count }));

    // Medication Errors
    const medErrorChange = medErrorM.prevVal > 0 ? Math.round(((medErrorM.currentVal - medErrorM.prevVal) / medErrorM.prevVal) * 10000) / 100 : 0;
    const medErrorSparkline = medErrorM.currentWeek.map(d => ({ date: d._id, value: d.count }));

    const data = {
      readmissionRates: {
        value: currentReadmissionRate,
        changePercent: Math.abs(readmissionChange),
        changeDirection: readmissionChange >= 0 ? "UP" : "DOWN",
        sparkline: readmissionSparkline,
      },
      complaints: {
        value: complaintM.currentVal,
        changePercent: Math.abs(complaintChange),
        changeDirection: complaintChange >= 0 ? "UP" : "DOWN",
        sparkline: complaintSparkline,
      },
      medicationErrors: {
        value: medErrorM.currentVal,
        changePercent: Math.abs(medErrorChange),
        changeDirection: medErrorChange >= 0 ? "UP" : "DOWN",
        sparkline: medErrorSparkline,
      },
      meta: { daysBack: 7, hospitalId, cached: false },
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
