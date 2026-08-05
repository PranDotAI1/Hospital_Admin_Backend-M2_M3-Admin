import { Request, Response } from "express";
import { Types } from "mongoose";
import { ScanShareVisitModel, ScanShareVisitStatus } from "../../models/ScanShareVisit";
import { VisitAssessmentModel } from "../../models/VisitAssessment";
import { LabReportModel } from "../../models/LabReport";
import { DepartmentModel } from "../../models/Department";
import { ResourceUtilizationModel } from "../../models/ResourceUtilization";
import { successResponse, errorResponse } from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";
import {
  parseAnalyticsParams,
  toObjectId,
  pct,
  getHospitalId,
} from "../../utils/analytics.helpers";
import {
  buildCacheKey,
  getCached,
  setCached,
  CACHE_TTL,
} from "../../utils/analytics.cache";

const CTRL = "[departmentAnalytics]";

export const getPatientLoadByDepartment = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);

    const cacheKey = buildCacheKey(hospitalId, "dept-patient-load", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      groupBy: params.groupBy,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const departments = await DepartmentModel.find({ status: true })
      .select("_id name")
      .lean();

    if (departments.length === 0) {
      const empty = {
        departments: [],
        meta: {
          from: params.start.toISOString(),
          to: params.end.toISOString(),
          cached: false,
        },
      };
      await setCached(cacheKey, empty, CACHE_TTL.ANALYTICS_SHORT);
      return successResponse(res, empty);
    }

    const deptIds = departments.map((d) => d._id as Types.ObjectId);

    const visitMatch: Record<string, unknown> = {
      visitDate: { $gte: params.start, $lte: params.end },
      visitStatus: {
        $in: [ScanShareVisitStatus.REGISTERED, ScanShareVisitStatus.COMPLETED],
      },
      departmentId: { $in: deptIds },
    };

    const visitPipeline: object[] = [
      ...(hospitalId
        ? [
            {
              $lookup: {
                from: "Patients",
                localField: "patientId",
                foreignField: "_id",
                as: "patientInfo",
              },
            },
            { $unwind: { path: "$patientInfo", preserveNullAndEmpty: false } },
            {
              $match: {
                ...visitMatch,
                "patientInfo.hospitalId": toObjectId(hospitalId),
              },
            },
          ]
        : [{ $match: visitMatch }]),
      {
        $group: {
          _id: "$departmentId",
          visitCount: { $sum: 1 },
        },
      },
    ];

    const visitCounts = await ScanShareVisitModel.aggregate(
      visitPipeline as any[]
    );

    const visitsByDept = new Map<string, number>();
    for (const row of visitCounts) {
      visitsByDept.set(row._id.toString(), row.visitCount);
    }

    const capacityMatch: Record<string, unknown> = {
      resourceType: "DEPARTMENT",
      resourceId: { $in: deptIds.map((id) => id.toString()) },
    };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) capacityMatch.hospitalId = hospitalObjId;

    const capacityRaw = await ResourceUtilizationModel.aggregate([
      { $match: capacityMatch },
      { $sort: { recordedDate: -1 } },
      {
        $group: {
          _id: "$resourceId",
          capacity: { $first: "$capacity" },
          utilizationRate: { $first: "$utilizationRate" },
        },
      },
    ] as any[]);

    const capacityByDept = new Map<
      string,
      { capacity: number; utilizationRate: number }
    >();
    for (const row of capacityRaw) {
      capacityByDept.set(row._id, {
        capacity: row.capacity ?? 100,
        utilizationRate: row.utilizationRate ?? 0,
      });
    }

    const totalVisits = Array.from(visitsByDept.values()).reduce(
      (s, v) => s + v,
      0
    );

    const result = departments.map((dept) => {
      const id = (dept._id as Types.ObjectId).toString();
      const visits = visitsByDept.get(id) ?? 0;
      const snap = capacityByDept.get(id);

      const utilizationPercent = snap
        ? snap.utilizationRate
        : pct(visits, totalVisits > 0 ? totalVisits : 1);

      return {
        departmentId: id,
        name: dept.name,
        visitCount: visits,
        capacity: snap?.capacity ?? null,
        utilizationPercent,
      };
    });

    const data = {
      departments: result,
      meta: {
        totalVisits,
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        groupBy: params.groupBy,
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getPatientLoadByDepartment error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get patient load by department",
      STATUS_CODE.ERROR
    );
  }
};

export const getAvgTimeToDiagnosis = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);

    const cacheKey = buildCacheKey(hospitalId, "dept-avg-time-to-diagnosis", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      limit: params.limit,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const assessmentMatch: Record<string, unknown> = {
      createdAt: { $gte: params.start, $lte: params.end },
      "primaryDiagnosis.code": { $exists: true, $ne: null },
      "primaryDiagnosis.display": { $exists: true, $ne: "" },
    };

    const pipeline: object[] = [
      ...(hospitalId
        ? [
            {
              $lookup: {
                from: "Patients",
                localField: "patientId",
                foreignField: "_id",
                as: "patientInfo",
              },
            },
            { $unwind: { path: "$patientInfo", preserveNullAndEmpty: false } },
            {
              $match: {
                ...assessmentMatch,
                "patientInfo.hospitalId": toObjectId(hospitalId),
              },
            },
          ]
        : [{ $match: assessmentMatch }]),
      {
        $lookup: {
          from: "scan_share_visits",
          localField: "visitId",
          foreignField: "_id",
          as: "visitInfo",
        },
      },
      {
        $unwind: {
          path: "$visitInfo",
          preserveNullAndEmpty: false,
        },
      },
      {
        $addFields: {
          diagnosisDays: {
            $divide: [
              {
                $subtract: [
                  "$createdAt",
                  { $ifNull: ["$visitInfo.visitDate", "$createdAt"] },
                ],
              },
              86400000, // ms → days
            ],
          },
        },
      },
      {
        $match: {
          diagnosisDays: { $gte: 0 },
        },
      },
      {
        $group: {
          _id: {
            code: "$primaryDiagnosis.code",
            display: "$primaryDiagnosis.display",
          },
          avgDays: { $avg: "$diagnosisDays" },
          caseCount: { $sum: 1 },
        },
      },
      { $sort: { caseCount: -1 } },
      { $limit: params.limit },
      {
        $project: {
          _id: 0,
          code: "$_id.code",
          display: "$_id.display",
          avgDays: { $round: ["$avgDays", 1] },
          caseCount: 1,
        },
      },
    ];

    const results = await VisitAssessmentModel.aggregate(pipeline as any[]);

    const data = {
      avgTimeToDiagnosis: results,
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        limit: params.limit,
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getAvgTimeToDiagnosis error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get avg time to diagnosis",
      STATUS_CODE.ERROR
    );
  }
};

export const getDiagnosticTestUtilization = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);

    const cacheKey = buildCacheKey(
      hospitalId,
      "dept-diagnostic-test-utilization",
      {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        limit: params.limit,
      }
    );

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const reportMatch: Record<string, unknown> = {
      createdAt: { $gte: params.start, $lte: params.end },
    };

    const pipeline: object[] = [
      ...(hospitalId
        ? [
            {
              $lookup: {
                from: "Patients",
                localField: "patientId",
                foreignField: "_id",
                as: "patientInfo",
              },
            },
            { $unwind: { path: "$patientInfo", preserveNullAndEmpty: false } },
            {
              $match: {
                ...reportMatch,
                "patientInfo.hospitalId": toObjectId(hospitalId),
              },
            },
          ]
        : [{ $match: reportMatch }]),
      { $unwind: { path: "$tests", preserveNullAndEmpty: false } },
      {
        $group: {
          _id: "$tests.testType",
          testCount: { $sum: 1 },
          patientCount: { $addToSet: "$patientId" },
        },
      },
      {
        $project: {
          _id: 0,
          testType: "$_id",
          testCount: 1,
          patientCount: { $size: "$patientCount" },
        },
      },
      { $sort: { testCount: -1 } },
      { $limit: params.limit },
    ];

    const results = await LabReportModel.aggregate(pipeline as any[]);
    const grandTotal = results.reduce(
      (s: number, r: any) => s + r.testCount,
      0
    );

    const diagnosticTestUtilization = results.map((r: any) => ({
      testType: r.testType,
      testCount: r.testCount,
      patientCount: r.patientCount,
      percentage: pct(r.testCount, grandTotal),
    }));

    const data = {
      diagnosticTestUtilization,
      meta: {
        totalTests: grandTotal,
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getDiagnosticTestUtilization error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get diagnostic test utilization",
      STATUS_CODE.ERROR
    );
  }
};

export const getCaseComplexityIndex = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);

    const cacheKey = buildCacheKey(hospitalId, "dept-case-complexity", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
      limit: params.limit,
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const assessmentMatch: Record<string, unknown> = {
      createdAt: { $gte: params.start, $lte: params.end },
    };

    const pipeline: object[] = [
      ...(hospitalId
        ? [
            {
              $lookup: {
                from: "Patients",
                localField: "patientId",
                foreignField: "_id",
                as: "patientInfo",
              },
            },
            { $unwind: { path: "$patientInfo", preserveNullAndEmpty: false } },
            {
              $match: {
                ...assessmentMatch,
                "patientInfo.hospitalId": toObjectId(hospitalId),
              },
            },
          ]
        : [{ $match: assessmentMatch }]),
      {
        $lookup: {
          from: "scan_share_visits",
          localField: "visitId",
          foreignField: "_id",
          as: "visitInfo",
        },
      },
      { $unwind: { path: "$visitInfo", preserveNullAndEmpty: false } },
      {
        $addFields: {
          complexityScore: {
            $add: [
              { $size: { $ifNull: ["$secondaryDiagnoses", []] } },
              { $size: { $ifNull: ["$complications", []] } },
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            departmentId: "$visitInfo.departmentId",
            department: "$visitInfo.department",
          },
          avgComplexity: { $avg: "$complexityScore" },
          caseCount: { $sum: 1 },
          totalComplexity: { $sum: "$complexityScore" },
        },
      },
      {
        $project: {
          _id: 0,
          departmentId: { $toString: "$_id.departmentId" },
          department: {
            $ifNull: ["$_id.department", "Unknown"],
          },
          avgComplexity: { $round: ["$avgComplexity", 2] },
          caseCount: 1,
          totalComplexity: 1,
        },
      },
      { $sort: { avgComplexity: -1 } },
      { $limit: params.limit },
    ];

    const results = await VisitAssessmentModel.aggregate(pipeline as any[]);

    const data = {
      caseComplexity: results,
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getCaseComplexityIndex error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get case complexity index",
      STATUS_CODE.ERROR
    );
  }
};
