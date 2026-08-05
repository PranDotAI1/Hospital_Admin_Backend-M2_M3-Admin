import { Request, Response } from "express";
import { Types } from "mongoose";
import { LabReportModel } from "../../models/LabReport";
import { PatientModel } from "../../models/Patient";
import { successResponse, errorResponse } from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";
import {
  parseAnalyticsParams,
  buildDateGroupExpr,
  formatPeriodLabel,
  toObjectId,
  getHospitalId,
} from "../../utils/analytics.helpers";
import {
  buildCacheKey,
  getCached,
  setCached,
  CACHE_TTL,
} from "../../utils/analytics.cache";

const CTRL = "[laboratoryAnalytics]";

const DIAG_TYPE_MAP: Record<string, string[]> = {
  liver_profile: ["liver function test", "lft", "liver profile"],
  cbc: ["complete blood count", "cbc", "blood count"],
  lipid_profile: ["lipid profile", "cholesterol panel"],
  kidney_function: ["kidney function test", "kft", "renal function"],
  thyroid: ["thyroid function test", "tft", "thyroid"],
};

const LIVER_PARAMS: Record<string, string> = {
  "a/g ratio": "agRatio",
  "ag ratio": "agRatio",
  albumin: "albumin",
  alp: "alp",
  "alkaline phosphatase": "alp",
  protein: "protein",
  "total protein": "protein",
  sgot: "sgot",
  "ast (sgot)": "sgot",
  sgpt: "sgpt",
  "alt (sgpt)": "sgpt",
  "direct bilirubin": "directBilirubin",
  "total bilirubin": "totalBilirubin",
  bilirubin: "totalBilirubin",
};

const PANEL_PARAMS_MAP: Record<string, Record<string, string>> = {
  liver_profile: LIVER_PARAMS,
};

const buildLabBaseMatch = async (
  diagType: string,
  hospitalId: string | undefined,
  city: string | undefined,
  ageGroup: string | undefined,
  from: Date,
  to: Date,
): Promise<{
  reportMatch: Record<string, unknown>;
  patientFilter: boolean;
  patientIds: Types.ObjectId[] | null;
}> => {
  const testTypes = DIAG_TYPE_MAP[diagType] ?? [diagType.toLowerCase()];

  const reportMatch: Record<string, unknown> = {
    createdAt: { $gte: from, $lte: to },
    "tests.testType": { $in: testTypes },
  };

  const needsPatientFilter = !!(hospitalId || city || ageGroup);
  if (!needsPatientFilter) {
    return { reportMatch, patientFilter: false, patientIds: null };
  }

  const patientQuery: Record<string, unknown> = {};
  if (hospitalId && /^[a-f0-9]{24}$/i.test(hospitalId)) {
    patientQuery.hospitalId = new Types.ObjectId(hospitalId);
  }
  if (city) {
    patientQuery.address = { $regex: city, $options: "i" };
  }
  if (ageGroup) {
    const [minStr, maxStr] = ageGroup.split("-");
    const min = parseInt(minStr, 10);
    const max = parseInt(maxStr, 10);
    if (!isNaN(min) && !isNaN(max)) {
      const now = new Date();
      const maxDob = new Date(now);
      maxDob.setFullYear(now.getFullYear() - min);
      const minDob = new Date(now);
      minDob.setFullYear(now.getFullYear() - max - 1);
      patientQuery.dob = {
        $gte: minDob.toISOString().slice(0, 10),
        $lte: maxDob.toISOString().slice(0, 10),
      };
    }
  }

  const patientIds = await PatientModel.find(patientQuery)
    .distinct("_id")
    .lean();

  reportMatch.patientId = { $in: patientIds };

  return { reportMatch, patientFilter: true, patientIds };
};

export const getLabProfileTrend = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const diagType = (
      (req.query.diagType as string) || "liver_profile"
    ).toLowerCase();
    const city = (req.query.city as string) || undefined;
    const ageGroup = (req.query.ageGroup as string) || undefined;

    const cacheKey = buildCacheKey(hospitalId, "lab-profile-trend", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      groupBy: params.groupBy,
      diagType,
      city: city ?? "",
      ageGroup: ageGroup ?? "",
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const { reportMatch } = await buildLabBaseMatch(
      diagType,
      hospitalId,
      city,
      ageGroup,
      params.start,
      params.end,
    );

    const trendPipeline: object[] = [
      { $match: reportMatch },
      {
        $group: {
          _id: buildDateGroupExpr("createdAt", params.groupBy),
          patientCount: { $addToSet: "$patientId" },
          testCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          period: "$$ROOT._id",
          patientCount: { $size: "$patientCount" },
          testCount: 1,
        },
      },
      {
        $sort: {
          "period.year": 1,
          "period.month": 1,
          "period.day": 1,
          "period.week": 1,
        },
      },
    ];

    const trendRaw = await LabReportModel.aggregate(trendPipeline as any[]);

    const trendSeries = trendRaw.map((r: any) => ({
      period: formatPeriodLabel(r.period, params.groupBy),
      patientCount: r.patientCount,
      testCount: r.testCount,
    }));

    const totalPatients = trendRaw.reduce(
      (s: number, r: any) => s + r.patientCount,
      0,
    );

    const prevStart = new Date(params.start);
    const periodMs = params.end.getTime() - params.start.getTime();
    prevStart.setTime(prevStart.getTime() - periodMs);

    const { reportMatch: prevMatch } = await buildLabBaseMatch(
      diagType,
      hospitalId,
      city,
      ageGroup,
      prevStart,
      params.start,
    );

    const prevCountRaw = await LabReportModel.aggregate([
      { $match: prevMatch },
      {
        $group: { _id: null, patientCount: { $addToSet: "$patientId" } },
      },
      { $project: { patientCount: { $size: "$patientCount" } } },
    ] as any[]);

    const prevTotal = prevCountRaw[0]?.patientCount ?? 0;
    const weekChangePercent =
      prevTotal > 0
        ? Math.round(((totalPatients - prevTotal) / prevTotal) * 10000) / 100
        : 0;

    const data = {
      diagType,
      totalPatients,
      weekChangePercent,
      changeDirection: weekChangePercent >= 0 ? "UP" : "DOWN",
      trendSeries,
      meta: {
        groupBy: params.groupBy,
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        city: city ?? null,
        ageGroup: ageGroup ?? null,
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getLabProfileTrend error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get lab profile trend",
      STATUS_CODE.ERROR,
    );
  }
};

export const getLabPanelAverages = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const diagType = (
      (req.query.diagType as string) || "liver_profile"
    ).toLowerCase();
    const city = (req.query.city as string) || undefined;
    const ageGroup = (req.query.ageGroup as string) || undefined;

    const cacheKey = buildCacheKey(hospitalId, "lab-panel-averages", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      diagType,
      city: city ?? "",
      ageGroup: ageGroup ?? "",
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const { reportMatch } = await buildLabBaseMatch(
      diagType,
      hospitalId,
      city,
      ageGroup,
      params.start,
      params.end,
    );

    const testTypes = DIAG_TYPE_MAP[diagType] ?? [diagType.toLowerCase()];

    const reports = await LabReportModel.find(reportMatch)
      .select("tests")
      .lean();

    const paramAliasMap = PANEL_PARAMS_MAP[diagType] ?? {};

    const sums: Record<string, { total: number; count: number }> = {};

    for (const report of reports) {
      for (const test of report.tests) {
        if (!testTypes.includes(test.testType)) continue;
        for (const param of test.parameters) {
          const alias = param.parameterName.toLowerCase().trim();
          const canonicalKey = paramAliasMap[alias];
          if (!canonicalKey) continue;

          const numVal = parseFloat(param.parameterValue);
          if (isNaN(numVal)) continue;

          if (!sums[canonicalKey]) sums[canonicalKey] = { total: 0, count: 0 };
          sums[canonicalKey].total += numVal;
          sums[canonicalKey].count += 1;
        }
      }
    }

    const panelAverages: Record<string, number> = {};
    for (const [key, { total, count }] of Object.entries(sums)) {
      panelAverages[key] =
        count > 0 ? Math.round((total / count) * 100) / 100 : 0;
    }

    const data = {
      diagType,
      panelAverages,
      sampleSize: reports.length,
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        city: city ?? null,
        ageGroup: ageGroup ?? null,
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getLabPanelAverages error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get lab panel averages",
      STATUS_CODE.ERROR,
    );
  }
};

export const getLabScatterDistribution = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);
    const diagType = (
      (req.query.diagType as string) || "liver_profile"
    ).toLowerCase();
    const city = (req.query.city as string) || undefined;
    const ageGroup = (req.query.ageGroup as string) || undefined;

    const rawLimit = parseInt(String(req.query.limit || 200), 10);
    const scatterLimit = Math.min(
      500,
      Math.max(1, isNaN(rawLimit) ? 200 : rawLimit),
    );

    const cacheKey = buildCacheKey(hospitalId, "lab-scatter-distribution", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      diagType,
      city: city ?? "",
      ageGroup: ageGroup ?? "",
      limit: scatterLimit,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const { reportMatch } = await buildLabBaseMatch(
      diagType,
      hospitalId,
      city,
      ageGroup,
      params.start,
      params.end,
    );

    const testTypes = DIAG_TYPE_MAP[diagType] ?? [diagType.toLowerCase()];
    const paramAliasMap = PANEL_PARAMS_MAP[diagType] ?? {};

    const SGOT_ALIASES = Object.entries(paramAliasMap)
      .filter(([, v]) => v === "sgot")
      .map(([k]) => k);
    const SGPT_ALIASES = Object.entries(paramAliasMap)
      .filter(([, v]) => v === "sgpt")
      .map(([k]) => k);

    const reports = await LabReportModel.find(reportMatch)
      .select("patientId tests")
      .limit(scatterLimit * 2) // over-fetch to account for missing values
      .lean();

    const points: Array<{
      index: number;
      patientId: string;
      sgot: number | null;
      sgpt: number | null;
    }> = [];

    let idx = 1;
    for (const report of reports) {
      if (points.length >= scatterLimit) break;

      let sgot: number | null = null;
      let sgpt: number | null = null;

      for (const test of report.tests) {
        if (!testTypes.includes(test.testType)) continue;
        for (const param of test.parameters) {
          const alias = param.parameterName.toLowerCase().trim();
          if (SGOT_ALIASES.includes(alias)) {
            const v = parseFloat(param.parameterValue);
            if (!isNaN(v)) sgot = v;
          }
          if (SGPT_ALIASES.includes(alias)) {
            const v = parseFloat(param.parameterValue);
            if (!isNaN(v)) sgpt = v;
          }
        }
      }

      if (sgot !== null || sgpt !== null) {
        points.push({
          index: idx++,
          patientId: (report.patientId as Types.ObjectId).toString(),
          sgot,
          sgpt,
        });
      }
    }

    const data = {
      diagType,
      scatterData: points,
      meta: {
        totalPoints: points.length,
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        city: city ?? null,
        ageGroup: ageGroup ?? null,
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getLabScatterDistribution error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get lab scatter distribution",
      STATUS_CODE.ERROR,
    );
  }
};
