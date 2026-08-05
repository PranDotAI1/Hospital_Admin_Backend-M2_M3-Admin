import { Request, Response } from "express";
import { ScanShareVisitModel, ScanShareVisitStatus } from "../../models/ScanShareVisit";
import { ResourceUtilizationModel } from "../../models/ResourceUtilization";
import { IncidentReportModel } from "../../models/IncidentReport";
import { VisitDayCareBilling } from "../../models/VisitDayCareBilling";
import { DoctorModel } from "../../models/Doctor";
import { NurseModel } from "../../models/Nurse";
import { successResponse, errorResponse } from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";
import {
  parseAnalyticsParams,
  toObjectId,
  getHospitalId,
} from "../../utils/analytics.helpers";
import {
  buildCacheKey,
  getCached,
  setCached,
  CACHE_TTL,
} from "../../utils/analytics.cache";

const CTRL = "[staffEfficiencyAnalytics]";

const fetchResourceSparkline = async (
  resourceType: string,
  hospitalId: string | undefined,
  resourceNameFilter?: RegExp
): Promise<
  Array<{
    name: string;
    currentRate: number;
    changePercent: number;
    changeDirection: "UP" | "DOWN";
    sparkline: Array<{ date: string; value: number }>;
  }>
> => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const match: Record<string, unknown> = {
    resourceType,
    recordedDate: { $gte: sevenDaysAgo },
  };
  const hospitalObjId = toObjectId(hospitalId);
  if (hospitalObjId) match.hospitalId = hospitalObjId;
  if (resourceNameFilter) match.resourceName = { $regex: resourceNameFilter };

  const pipeline: object[] = [
    { $match: match },
    { $sort: { recordedDate: 1 } },
    {
      $group: {
        _id: "$resourceName",
        sparkline: {
          $push: {
            date: {
              $dateToString: { format: "%Y-%m-%d", date: "$recordedDate" },
            },
            value: "$utilizationRate",
          },
        },
        currentRate: { $last: "$utilizationRate" },
        prevRate: { $first: "$utilizationRate" },
      },
    },
  ];

  const rawResults = await ResourceUtilizationModel.aggregate(
    pipeline as any[]
  );

  return rawResults.map((r: any) => {
    const weekChange =
      r.prevRate > 0
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
};

export const getStaffAllocationEfficiency = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(
      hospitalId,
      "staff-allocation-efficiency",
      { hospitalId: hospitalId ?? "global" }
    );

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
            visitStatus: {
              $in: [
                ScanShareVisitStatus.REGISTERED,
                ScanShareVisitStatus.PENDING,
              ],
            },
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
        visitStatus: {
          $in: [
            ScanShareVisitStatus.REGISTERED,
            ScanShareVisitStatus.PENDING,
          ],
        },
      });
    }

    const docQuery: Record<string, unknown> = {
      isActive: { $ne: false },
      currentStatus: { $ne: "UNAVAILABLE" },
    };
    const nurseQuery: Record<string, unknown> = { isActive: { $ne: false } };

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
    const patientToStaffRatio =
      totalStaff > 0
        ? Math.round((activePatientsToday / totalStaff) * 10) / 10
        : 0;

    const allocationStatus =
      patientToStaffRatio > 5
        ? "CRITICAL"
        : patientToStaffRatio > 3
        ? "HIGH"
        : patientToStaffRatio > 1
        ? "NORMAL"
        : "LOW";

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const staffMatch: Record<string, unknown> = {
      resourceType: "DEPARTMENT",
      recordedDate: { $gte: sevenDaysAgo },
    };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) staffMatch.hospitalId = hospitalObjId;

    const sparklinePipeline: object[] = [
      { $match: staffMatch },
      { $sort: { recordedDate: 1 } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$recordedDate" },
          },
          avgRate: { $avg: "$utilizationRate" },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id",
          value: { $round: ["$avgRate", 1] },
        },
      },
    ];

    const sparklineRaw = await ResourceUtilizationModel.aggregate(
      sparklinePipeline as any[]
    );

    const data = {
      activePatientsToday,
      availableDoctors,
      availableNurses,
      totalAvailableStaff: totalStaff,
      patientToStaffRatio,
      allocationStatus,
      sparkline: sparklineRaw,
      meta: { asOf: now.toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_LIVE);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getStaffAllocationEfficiency error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get staff allocation efficiency",
      STATUS_CODE.ERROR
    );
  }
};

export const getLogisticsEfficiency = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);

    const cacheKey = buildCacheKey(hospitalId, "staff-logistics-efficiency", {
      from: params.start.toISOString(),
      to: params.end.toISOString(),
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const logisticsResources = await fetchResourceSparkline(
      "LOGISTICS",
      hospitalId
    );

    let deliveryTimeHours: number;
    let changePercent: number;
    let changeDirection: "UP" | "DOWN";
    let sparkline: Array<{ date: string; value: number }> = [];

    if (logisticsResources.length > 0) {
      const resource = logisticsResources[0];
      deliveryTimeHours = Math.round(resource.currentRate * 10) / 10;
      changePercent = resource.changePercent;
      changeDirection = resource.changeDirection;
      sparkline = resource.sparkline;
    } else {
      const incidentMatch: Record<string, unknown> = {
        type: "MEDICATION_ERROR",
        reportedAt: { $gte: params.start, $lte: params.end },
        isResolved: true,
        resolvedAt: { $exists: true },
      };
      const hospitalObjId = toObjectId(hospitalId);
      if (hospitalObjId) incidentMatch.hospitalId = hospitalObjId;

      const [current, previous] = await Promise.all([
        IncidentReportModel.aggregate([
          { $match: incidentMatch },
          {
            $addFields: {
              resolutionHours: {
                $divide: [
                  { $subtract: ["$resolvedAt", "$reportedAt"] },
                  3600000,
                ],
              },
            },
          },
          {
            $group: { _id: null, avgHours: { $avg: "$resolutionHours" } },
          },
        ] as any[]),
        IncidentReportModel.aggregate([
          {
            $match: {
              ...incidentMatch,
              reportedAt: {
                $gte: new Date(
                  params.start.getTime() -
                    (params.end.getTime() - params.start.getTime())
                ),
                $lte: params.start,
              },
            },
          },
          {
            $addFields: {
              resolutionHours: {
                $divide: [
                  { $subtract: ["$resolvedAt", "$reportedAt"] },
                  3600000,
                ],
              },
            },
          },
          { $group: { _id: null, avgHours: { $avg: "$resolutionHours" } } },
        ] as any[]),
      ]);

      const currentHrs = current[0]?.avgHours ?? 0;
      const prevHrs = previous[0]?.avgHours ?? 0;

      deliveryTimeHours = Math.round(currentHrs * 10) / 10;
      const rawChange =
        prevHrs > 0
          ? Math.round(((currentHrs - prevHrs) / prevHrs) * 10000) / 100
          : 0;
      changePercent = Math.abs(rawChange);
      changeDirection = rawChange >= 0 ? "UP" : "DOWN";
      sparkline = [];
    }

    const data = {
      deliveryTimeHours,
      changePercent,
      changeDirection,
      sparkline,
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getLogisticsEfficiency error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get logistics efficiency",
      STATUS_CODE.ERROR
    );
  }
};

export const getOperationalCostPerPatient = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);

    const cacheKey = buildCacheKey(
      hospitalId,
      "staff-operational-cost",
      {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
      }
    );

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const billingMatch: Record<string, unknown> = {
      date: { $gte: params.start, $lte: params.end },
      status: { $ne: "Draft" },
    };

    const kpiPipeline: object[] = [
      ...(hospitalId
        ? [
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
                ...billingMatch,
                "patientInfo.hospitalId": toObjectId(hospitalId),
              },
            },
          ]
        : [{ $match: billingMatch }]),
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalGross" },
          uniquePatients: { $addToSet: "$patient" },
        },
      },
    ];

    const prevStart = new Date(params.start);
    const periodMs = params.end.getTime() - params.start.getTime();
    prevStart.setTime(prevStart.getTime() - periodMs);

    const prevBillingMatch: Record<string, unknown> = {
      date: { $gte: prevStart, $lte: params.start },
      status: { $ne: "Draft" },
    };
    const prevKpiPipeline: object[] = [
      ...(hospitalId
        ? [
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
                ...prevBillingMatch,
                "patientInfo.hospitalId": toObjectId(hospitalId),
              },
            },
          ]
        : [{ $match: prevBillingMatch }]),
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalGross" },
          uniquePatients: { $addToSet: "$patient" },
        },
      },
    ];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const sparklineMatch: Record<string, unknown> = {
      date: { $gte: sevenDaysAgo },
      status: { $ne: "Draft" },
    };
    const sparklinePipeline: object[] = [
      ...(hospitalId
        ? [
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
            },
          ]
        : [{ $match: sparklineMatch }]),
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
          costPerPatient: {
            $round: [
              {
                $divide: [
                  "$totalRevenue",
                  { $max: [{ $size: "$uniquePatients" }, 1] },
                ],
              },
              2,
            ],
          },
        },
      },
    ];

    const [[kpiRaw], [prevKpiRaw], sparklineRaw] = await Promise.all([
      VisitDayCareBilling.aggregate(kpiPipeline as any[]),
      VisitDayCareBilling.aggregate(prevKpiPipeline as any[]),
      VisitDayCareBilling.aggregate(sparklinePipeline as any[]),
    ]);

    const totalRevenue = kpiRaw?.totalRevenue ?? 0;
    const uniquePatients = kpiRaw?.uniquePatients?.length ?? 0;
    const costPerPatient =
      uniquePatients > 0
        ? Math.round((totalRevenue / uniquePatients) * 100) / 100
        : 0;

    const prevRevenue = prevKpiRaw?.totalRevenue ?? 0;
    const prevPatients = prevKpiRaw?.uniquePatients?.length ?? 0;
    const prevCostPerPatient =
      prevPatients > 0
        ? Math.round((prevRevenue / prevPatients) * 100) / 100
        : 0;

    const rawChange =
      prevCostPerPatient > 0
        ? Math.round(
            ((costPerPatient - prevCostPerPatient) / prevCostPerPatient) *
              10000
          ) / 100
        : 0;

    const data = {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      uniquePatients,
      costPerPatient,
      changePercent: Math.abs(rawChange),
      changeDirection: rawChange >= 0 ? "UP" : "DOWN",
      sparkline: sparklineRaw,
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getOperationalCostPerPatient error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get operational cost per patient",
      STATUS_CODE.ERROR
    );
  }
};

export const getEquipmentUtilizationRate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(
      hospitalId,
      "staff-equipment-utilization",
      { hospitalId: hospitalId ?? "global" }
    );

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const diagnosticItems = await fetchResourceSparkline(
      "EQUIPMENT",
      hospitalId,
      /diagnostic/i
    );

    const medicalItems = await fetchResourceSparkline(
      "EQUIPMENT",
      hospitalId,
      /medical|imaging|monitor|ventilator/i
    );

    // Aggregate into two buckets
    const avgRate = (
      items: ReturnType<typeof fetchResourceSparkline> extends Promise<infer T>
        ? T
        : never
    ) => {
      if (items.length === 0) return 0;
      const sum = items.reduce((s, i) => s + i.currentRate, 0);
      return Math.round((sum / items.length) * 10) / 10;
    };

    const diagnosticRate = avgRate(diagnosticItems);
    const medicalRate = avgRate(medicalItems);

    const bucketChange = (
      items: ReturnType<typeof fetchResourceSparkline> extends Promise<infer T>
        ? T
        : never
    ) => {
      if (items.length === 0)
        return { changePercent: 0, changeDirection: "UP" as const };
      const avg =
        items.reduce((s, i) => s + i.changePercent, 0) / items.length;
      const dir = items.every((i) => i.changeDirection === "DOWN")
        ? "DOWN"
        : "UP";
      return { changePercent: Math.round(avg * 10) / 10, changeDirection: dir as "UP" | "DOWN" };
    };

    const data = {
      diagnostic: {
        utilizationRate: diagnosticRate,
        ...bucketChange(diagnosticItems),
        items: diagnosticItems,
      },
      medical: {
        utilizationRate: medicalRate,
        ...bucketChange(medicalItems),
        items: medicalItems,
      },
      meta: { asOf: new Date().toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_MEDIUM);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getEquipmentUtilizationRate error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get equipment utilization rate",
      STATUS_CODE.ERROR
    );
  }
};

export const getTicketResolutionTime = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const params = parseAnalyticsParams(req.query as Record<string, unknown>);
    const hospitalId = getHospitalId(req);

    const cacheKey = buildCacheKey(
      hospitalId,
      "staff-ticket-resolution",
      {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
      }
    );

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const baseMatch: Record<string, unknown> = {
      reportedAt: { $gte: params.start, $lte: params.end },
      isResolved: true,
      resolvedAt: { $exists: true },
    };
    const hospitalObjId = toObjectId(hospitalId);
    if (hospitalObjId) baseMatch.hospitalId = hospitalObjId;

    const LOGISTICS_TYPES = ["MEDICATION_ERROR"];
    const OPERATIONAL_TYPES = [
      "CUTS_AND_PUNCTURES",
      "MULTIPLE_TRAUMA",
      "FRACTURES",
      "BRUISES",
      "SORENESS_PAIN",
      "SPRAINS_AND_STRAINS",
      "COMPLAINT",
    ];

    const pipeline: object[] = [
      { $match: baseMatch },
      {
        $addFields: {
          resolutionHours: {
            $divide: [
              { $subtract: ["$resolvedAt", "$reportedAt"] },
              3600000,
            ],
          },
          category: {
            $switch: {
              branches: [
                {
                  case: { $in: ["$type", LOGISTICS_TYPES] },
                  then: "Logistics",
                },
                {
                  case: { $in: ["$type", OPERATIONAL_TYPES] },
                  then: "Operational",
                },
              ],
              default: "Other",
            },
          },
        },
      },
      {
        $group: {
          _id: "$category",
          avgResolutionHours: { $avg: "$resolutionHours" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          category: "$_id",
          avgResolutionHours: { $round: ["$avgResolutionHours", 1] },
          count: 1,
        },
      },
    ];

    const prevStart = new Date(params.start);
    const periodMs = params.end.getTime() - params.start.getTime();
    prevStart.setTime(prevStart.getTime() - periodMs);

    const prevMatch: Record<string, unknown> = {
      ...baseMatch,
      reportedAt: { $gte: prevStart, $lte: params.start },
    };

    const [currentRaw, prevRaw] = await Promise.all([
      IncidentReportModel.aggregate(pipeline as any[]),
      IncidentReportModel.aggregate([
        { $match: prevMatch },
        {
          $addFields: {
            resolutionHours: {
              $divide: [
                { $subtract: ["$resolvedAt", "$reportedAt"] },
                3600000,
              ],
            },
          },
        },
        {
          $group: { _id: null, avgHours: { $avg: "$resolutionHours" } },
        },
      ] as any[]),
    ]);

    const currentByCategory = new Map<string, { avgResolutionHours: number; count: number }>();
    for (const r of currentRaw) {
      currentByCategory.set(r.category, {
        avgResolutionHours: r.avgResolutionHours,
        count: r.count,
      });
    }

    const prevAvgHours = prevRaw[0]?.avgHours ?? 0;
    const logisticsCurrent =
      currentByCategory.get("Logistics")?.avgResolutionHours ?? 0;
    const operationalCurrent =
      currentByCategory.get("Operational")?.avgResolutionHours ?? 0;
    const overallCurrent =
      currentRaw.reduce((s: number, r: any) => s + r.avgResolutionHours, 0) /
      (currentRaw.length || 1);

    const overallChange =
      prevAvgHours > 0
        ? Math.round(
            ((overallCurrent - prevAvgHours) / prevAvgHours) * 10000
          ) / 100
        : 0;

    const data = {
      logistics: {
        avgResolutionHours: logisticsCurrent,
        count: currentByCategory.get("Logistics")?.count ?? 0,
      },
      operational: {
        avgResolutionHours: operationalCurrent,
        count: currentByCategory.get("Operational")?.count ?? 0,
      },
      overallAvgResolutionHours: Math.round(overallCurrent * 10) / 10,
      changePercent: Math.abs(overallChange),
      changeDirection: overallChange >= 0 ? "UP" : "DOWN",
      meta: {
        from: params.start.toISOString(),
        to: params.end.toISOString(),
        cached: false,
      },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_SHORT);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getTicketResolutionTime error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get ticket resolution time",
      STATUS_CODE.ERROR
    );
  }
};

export const getITResourceUsage = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(hospitalId, "staff-it-resource-usage", {
      hospitalId: hospitalId ?? "global",
    });

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const itItems = await fetchResourceSparkline("IT", hospitalId);

    const data = {
      itResources: itItems,
      meta: { asOf: new Date().toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_MEDIUM);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getITResourceUsage error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get IT resource usage",
      STATUS_CODE.ERROR
    );
  }
};

export const getFacilityUtilizationRate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const hospitalId = getHospitalId(req);
    const cacheKey = buildCacheKey(
      hospitalId,
      "staff-facility-utilization",
      { hospitalId: hospitalId ?? "global" }
    );

    const cached = await getCached(cacheKey);
    if (cached) return successResponse(res, cached);

    const facilityItems = await fetchResourceSparkline("FACILITY", hospitalId);

    const data = {
      facilityResources: facilityItems,
      meta: { asOf: new Date().toISOString(), cached: false },
    };

    await setCached(cacheKey, data, CACHE_TTL.ANALYTICS_MEDIUM);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getFacilityUtilizationRate error:`, error);
    return errorResponse(
      res,
      error.message || "Failed to get facility utilization rate",
      STATUS_CODE.ERROR
    );
  }
};
