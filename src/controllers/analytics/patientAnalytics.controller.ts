import { Request, Response } from "express";
import { Types } from "mongoose";
import { PatientModel } from "../../models/Patient";
import { ScanShareVisitModel, ScanShareVisitStatus } from "../../models/ScanShareVisit";
import { VisitAssessmentModel } from "../../models/VisitAssessment";
import { LabReportModel } from "../../models/LabReport";
import { PatientFeedbackModel } from "../../models/PatientFeedback";
import { WellnessProgramModel } from "../../models/WellnessProgram";
import { successResponse, errorResponse } from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";
import {
  parseAnalyticsParams,
  parseDateRange,
  toObjectId,
  pct,
  dowLabel,
  sortByDayOfWeek,
  getHospitalId,
} from "../../utils/analytics.helpers";
import {
  buildCacheKey,
  getCached,
  setCached,
  invalidateEndpoint,
  CACHE_TTL,
} from "../../utils/analytics.cache";

const CTRL = "[patientAnalytics]";



export const getAgeDistribution = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "patient-age-distribution", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      departmentId: params.departmentId,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = { dob: { $exists: true, $ne: null } };
    if (hospitalId && /^[a-f0-9]{24}$/i.test(hospitalId)) {
      match.hospitalId = new Types.ObjectId(hospitalId);
    }

    const now = new Date();
    const pipeline: object[] = [
      { $match: match },
      {
        $addFields: {
          ageYears: {
            $dateDiff: {
              startDate: { $dateFromString: { dateString: "$dob", onError: "$$REMOVE" } },
              endDate: now,
              unit: "year",
            },
          },
        },
      },
      { $match: { ageYears: { $gte: 0, $lte: 120 } } },
      {
        $bucket: {
          groupBy: "$ageYears",
          boundaries: [0, 18, 25, 35, 45, 57, 66, 200],
          default: "Unknown",
          output: { count: { $sum: 1 } },
        },
      },
    ];

    const raw = await PatientModel.aggregate(pipeline as any[]);

    const LABELS: Record<string | number, string> = {
      0: "1-17", 18: "18-24", 25: "25-34",
      35: "35-44", 45: "45-56", 57: "56-65", 66: "65+",
    };

    const total = raw.reduce((s: number, r: any) => s + (r.count || 0), 0);
    const ageDistribution = raw
      .filter((r: any) => r._id !== "Unknown")
      .map((r: any) => ({
        label: LABELS[r._id] ?? `${r._id}+`,
        count: r.count,
        percentage: pct(r.count, total),
      }));

    const data = {
      ageDistribution,
      meta: { totalPatients: total, computedAt: new Date().toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getAgeDistribution error:`, error);
    return errorResponse(res, error.message || "Failed to get age distribution", STATUS_CODE.ERROR);
  }
};

export const getVisitIntervals = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "patient-visit-intervals", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = {
      visitStatus: ScanShareVisitStatus.COMPLETED,
      patientId: { $exists: true, $ne: null },
      visitDate: { $gte: params.start, $lte: params.end },
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
      { $sort: { patientId: 1, visitDate: 1 } },
      {
        $group: {
          _id: "$patientId",
          visitDates: { $push: "$visitDate" },
          visitType: { $first: "$visitType" },
        },
      },
      { $match: { "visitDates.1": { $exists: true } } },
      {
        $addFields: {
          intervals: {
            $map: {
              input: { $range: [1, { $size: "$visitDates" }] },
              as: "i",
              in: {
                $divide: [
                  {
                    $subtract: [
                      { $arrayElemAt: ["$visitDates", "$$i"] },
                      { $arrayElemAt: ["$visitDates", { $subtract: ["$$i", 1] }] },
                    ],
                  },
                  86400000,
                ],
              },
            },
          },
        },
      },
      { $unwind: "$intervals" },
      { $match: { intervals: { $gte: 0, $lte: 730 } } },
      {
        $group: {
          _id: {
            $cond: [
              { $in: ["$visitType", ["CHRONIC", "Chronic", "chronic"]] },
              "Chronic",
              {
                $cond: [
                  { $in: ["$visitType", ["ACUTE", "Acute", "acute", "Emergency"]] },
                  "Acute Conditions",
                  "Other",
                ],
              },
            ],
          },
          avgDays: { $avg: "$intervals" },
          sampleSize: { $sum: 1 },
        },
      },
      { $project: { _id: 0, category: "$_id", avgDays: { $round: ["$avgDays", 1] }, sampleSize: 1 } },
    ];

    const visitIntervals = await ScanShareVisitModel.aggregate(pipeline as any[]);

    const data = {
      visitIntervals,
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        computedAt: new Date().toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getVisitIntervals error:`, error);
    return errorResponse(res, error.message || "Failed to get visit intervals", STATUS_CODE.ERROR);
  }
};

export const getPatientSatisfaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "patient-satisfaction", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const hospitalObjId = toObjectId(hospitalId);
    const baseMatch: Record<string, unknown> = hospitalObjId ? { hospitalId: hospitalObjId } : {};

    const [current] = await PatientFeedbackModel.aggregate([
      {
        $match: {
          ...baseMatch,
          submittedAt: { $gte: params.start, $lte: params.end },
        },
      },
      {
        $group: {
          _id: null,
          avgScore: { $avg: "$score" },
          totalResponses: { $sum: 1 },
          score5: { $sum: { $cond: [{ $eq: ["$score", 5] }, 1, 0] } },
          score4: { $sum: { $cond: [{ $eq: ["$score", 4] }, 1, 0] } },
          score3: { $sum: { $cond: [{ $eq: ["$score", 3] }, 1, 0] } },
          score2: { $sum: { $cond: [{ $eq: ["$score", 2] }, 1, 0] } },
          score1: { $sum: { $cond: [{ $eq: ["$score", 1] }, 1, 0] } },
        },
      },
    ]);

    const periodMs = params.end.getTime() - params.start.getTime();
    const prevEnd = new Date(params.start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);

    const [previous] = await PatientFeedbackModel.aggregate([
      {
        $match: {
          ...baseMatch,
          submittedAt: { $gte: prevStart, $lte: prevEnd },
        },
      },
      { $group: { _id: null, avgScore: { $avg: "$score" } } },
    ]);

    const currentScore = current ? Math.round(((current.avgScore ?? 0) / 5) * 1000) / 10 : 0;
    const previousScore = previous ? Math.round(((previous.avgScore ?? 0) / 5) * 1000) / 10 : 0;
    const changePercent = previousScore > 0
      ? Math.round(((currentScore - previousScore) / previousScore) * 10000) / 100
      : 0;

    const data = {
      satisfactionScore: currentScore,
      previousPeriodScore: previousScore,
      changePercent: Math.abs(changePercent),
      changeDirection: changePercent >= 0 ? "UP" : "DOWN",
      totalResponses: current?.totalResponses ?? 0,
      breakdown: {
        "5_star": current?.score5 ?? 0,
        "4_star": current?.score4 ?? 0,
        "3_star": current?.score3 ?? 0,
        "2_star": current?.score2 ?? 0,
        "1_star": current?.score1 ?? 0,
      },
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        computedAt: new Date().toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getPatientSatisfaction error:`, error);
    return errorResponse(res, error.message || "Failed to get satisfaction score", STATUS_CODE.ERROR);
  }
};

export const getPrimaryDiagnosis = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "patient-primary-diagnosis", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      ageGroup: params.ageGroup,
      limit: params.limit,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, any> = {
      createdAt: { $gte: params.start, $lte: params.end },
      "primaryDiagnosis.code": { $exists: true, $ne: null },
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
          _id: "$primaryDiagnosis.code",
          display: { $first: "$primaryDiagnosis.display" },
          cases: { $sum: 1 },
        },
      },
      { $sort: { cases: -1 } },
      { $limit: params.limit },
      { $project: { _id: 0, code: "$_id", display: 1, cases: 1 } },
    ];

    const primaryDiagnosis = await VisitAssessmentModel.aggregate(pipeline as any[]);

    const data = {
      primaryDiagnosis,
      meta: {
        totalCases: primaryDiagnosis.reduce((s: number, r: any) => s + r.cases, 0),
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        ageGroup: params.ageGroup || "All",
        computedAt: new Date().toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getPrimaryDiagnosis error:`, error);
    return errorResponse(res, error.message || "Failed to get primary diagnosis data", STATUS_CODE.ERROR);
  }
};

export const getSecondaryDiagnosis = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "patient-secondary-diagnosis", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      ageGroup: params.ageGroup,
      limit: params.limit,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, any> = {
      createdAt: { $gte: params.start, $lte: params.end },
      "secondaryDiagnoses.0": { $exists: true },
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
      { $unwind: "$secondaryDiagnoses" },
      {
        $group: {
          _id: "$secondaryDiagnoses.code",
          display: { $first: "$secondaryDiagnoses.display" },
          cases: { $sum: 1 },
        },
      },
      { $sort: { cases: -1 } },
      { $limit: params.limit },
      { $project: { _id: 0, code: "$_id", display: 1, cases: 1 } },
    ];

    const secondaryDiagnosis = await VisitAssessmentModel.aggregate(pipeline as any[]);

    const data = {
      secondaryDiagnosis,
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        ageGroup: params.ageGroup || "All",
        computedAt: new Date().toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getSecondaryDiagnosis error:`, error);
    return errorResponse(res, error.message || "Failed to get secondary diagnosis data", STATUS_CODE.ERROR);
  }
};

export const getSocialDeterminants = async (req: Request, res: Response): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "patient-social-determinants", { hospitalId });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const baseMatch: Record<string, unknown> = { socialProfile: { $exists: true } };
    if (hospitalId && /^[a-f0-9]{24}$/i.test(hospitalId)) {
      baseMatch.hospitalId = new Types.ObjectId(hospitalId);
    }

    const [totals, eduCount, unemployedCount, economicCount, accessCount, foodCount, crimeCount, employmentCount] = await Promise.all([
      PatientModel.countDocuments(baseMatch),
      PatientModel.countDocuments({ ...baseMatch, "socialProfile.education": { $in: ["NONE", "PRIMARY"] } }),
      PatientModel.countDocuments({ ...baseMatch, "socialProfile.employment": "UNEMPLOYED" }),
      PatientModel.countDocuments({ ...baseMatch, "socialProfile.incomeLevel": { $in: ["VERY_LOW", "LOW"] } }),
      PatientModel.countDocuments({ ...baseMatch, "socialProfile.accessToHealthcare": { $in: ["LIMITED", "NO_ACCESS"] } }),
      PatientModel.countDocuments({ ...baseMatch, "socialProfile.foodSecurity": "INSECURE" }),
      PatientModel.countDocuments({ ...baseMatch, "socialProfile.hasCriminalSafetyRisk": true }),
      PatientModel.countDocuments({ ...baseMatch, "socialProfile.employment": { $in: ["UNEMPLOYED", "RETIRED"] } }),
    ]);

    const factors = [
      { factor: "Education",                   count: eduCount },
      { factor: "Unemployment",                count: unemployedCount },
      { factor: "Economic",                    count: economicCount },
      { factor: "Access to quality healthcare", count: accessCount },
      { factor: "Food insecurity",             count: foodCount },
      { factor: "Crime",                       count: crimeCount },
      { factor: "Employment status",           count: employmentCount },
      { factor: "Poverty",                     count: economicCount },
    ];

    const grandTotal = factors.reduce((s, f) => s + f.count, 0);
    const socialDeterminants = factors.map((f) => ({
      ...f,
      percentage: pct(f.count, grandTotal),
    }));

    const data = {
      socialDeterminants,
      meta: {
        totalPatients: totals,
        patientsWithProfile: await PatientModel.countDocuments(baseMatch),
        computedAt: new Date().toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_LONG);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getSocialDeterminants error:`, error);
    return errorResponse(res, error.message || "Failed to get social determinants", STATUS_CODE.ERROR);
  }
};

export const getDiagnosticTesting = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "patient-diagnostic-testing", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = {
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
        $addFields: {
          dayOfWeek: { $dayOfWeek: "$createdAt" },
          testCount: { $size: { $ifNull: ["$tests", []] } },
        },
      },
      {
        $group: {
          _id: "$dayOfWeek",
          totalTests: { $sum: "$testCount" },
          totalReports: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          dayIndex: "$_id",
          totalTests: 1,
          totalReports: 1,
          avgTestsPerPatient: {
            $round: [{ $divide: ["$totalTests", { $max: ["$totalReports", 1] }] }, 1],
          },
        },
      },
    ];

    const rawResults = await LabReportModel.aggregate(pipeline as any[]);
    const allDays = [1, 2, 3, 4, 5, 6, 7];
    const byDay = new Map(rawResults.map((r: any) => [r.dayIndex, r]));

    const diagnosticTestingPerDay = sortByDayOfWeek(
      allDays.map((d) => {
        const r = byDay.get(d) as any;
        return {
          day: dowLabel(d),
          dayIndex: d,
          avgTestsPerPatient: r?.avgTestsPerPatient ?? 0,
          totalTests: r?.totalTests ?? 0,
          totalPatients: r?.totalReports ?? 0,
        };
      })
    );

    const data = {
      diagnosticTestingPerDay,
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        computedAt: new Date().toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getDiagnosticTesting error:`, error);
    return errorResponse(res, error.message || "Failed to get diagnostic testing data", STATUS_CODE.ERROR);
  }
};

export const getWellnessTraining = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "patient-wellness-training", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = {
      status: "COMPLETED",
      scheduledDate: { $gte: params.start, $lte: params.end },
    };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) match.hospitalId = hospitalObjId;

    const pipeline: object[] = [
      { $match: match },
      { $addFields: { dayOfWeek: { $dayOfWeek: "$scheduledDate" } } },
      { $group: { _id: "$dayOfWeek", sessionsCompleted: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ];

    const rawResults = await WellnessProgramModel.aggregate(pipeline as any[]);
    const allDays = [1, 2, 3, 4, 5, 6, 7];
    const byDay = new Map(rawResults.map((r: any) => [r._id, r.sessionsCompleted]));

    const wellnessTraining = sortByDayOfWeek(
      allDays.map((d) => ({
        day: dowLabel(d),
        dayIndex: d,
        sessionsCompleted: byDay.get(d) ?? 0,
      }))
    );

    const data = {
      wellnessTraining,
      meta: {
        totalSessions: rawResults.reduce((s: number, r: any) => s + r.sessionsCompleted, 0),
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        computedAt: new Date().toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getWellnessTraining error:`, error);
    return errorResponse(res, error.message || "Failed to get wellness training data", STATUS_CODE.ERROR);
  }
};

export const getInsuranceCoverage = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const topN = Math.min(params.limit, 10);
    const cacheKey = buildCacheKey(hospitalId, "patient-insurance-coverage", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      limit: topN,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const match: Record<string, unknown> = {
      "insurance.0": { $exists: true },
    };
    if (hospitalId && /^[a-f0-9]{24}$/i.test(hospitalId)) {
      match.hospitalId = new Types.ObjectId(hospitalId);
    }

    const pipeline: object[] = [
      { $match: match },
      { $unwind: "$insurance" },
      { $match: { "insurance.provider": { $exists: true, $ne: null } } },
      {
        $group: {
          _id: "$insurance.provider",
          patientIds: { $addToSet: "$_id" },
        },
      },
      { $addFields: { patientCount: { $size: "$patientIds" } } },
      { $sort: { patientCount: -1 } },
    ];

    const rawAll = await PatientModel.aggregate(pipeline as any[]);
    const total = rawAll.reduce((s: number, r: any) => s + r.patientCount, 0);
    const uninsuredCount = await PatientModel.countDocuments({
      ...(match.hospitalId ? { hospitalId: match.hospitalId } : {}),
      $or: [{ insurance: { $exists: false } }, { insurance: { $size: 0 } }],
    });

    const topProviders = rawAll.slice(0, topN).map((r: any) => ({
      provider: r._id,
      patientCount: r.patientCount,
      percentage: pct(r.patientCount, total),
    }));

    const othersCount = rawAll.slice(topN).reduce((s: number, r: any) => s + r.patientCount, 0);
    if (othersCount > 0) {
      topProviders.push({
        provider: "Others",
        patientCount: othersCount,
        percentage: pct(othersCount, total),
      });
    }

    const data = {
      insuranceCoverage: topProviders,
      uninsuredCount,
      meta: {
        totalPatientsWithInsurance: total,
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        computedAt: new Date().toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_LONG);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getInsuranceCoverage error:`, error);
    return errorResponse(res, error.message || "Failed to get insurance coverage data", STATUS_CODE.ERROR);
  }
};
