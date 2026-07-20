import { Request, Response } from "express";
import { Types } from "mongoose";
import { ResourceUtilizationModel } from "../models/ResourceUtilization";
import { successResponse, errorResponse, successListResponse, buildPaginationMeta } from "../utils/common";
import { STATUS_CODE } from "../utils/constant";
import { invalidateEndpoint } from "../utils/analytics.cache";
import { parseTableParams } from "../utils/analytics.helpers";

const CTRL = "[resources]";

const VALID_RESOURCE_TYPES = ["DEPARTMENT", "EQUIPMENT", "FACILITY"];

export const upsertUtilization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { resourceType, resourceId, resourceName, utilizationRate, capacity, activeCount, recordedDate } = req.body;

    if (!resourceType || !VALID_RESOURCE_TYPES.includes(resourceType)) {
      return errorResponse(res, `resourceType must be one of: ${VALID_RESOURCE_TYPES.join(", ")}`, STATUS_CODE.BAD_REQUEST);
    }
    if (!resourceId || !resourceName) {
      return errorResponse(res, "resourceId and resourceName are required", STATUS_CODE.BAD_REQUEST);
    }
    if (utilizationRate === undefined || utilizationRate < 0 || utilizationRate > 100) {
      return errorResponse(res, "utilizationRate must be between 0 and 100", STATUS_CODE.BAD_REQUEST);
    }

    const hospitalId = (req as any).user?.hospitalId;

    const rawDate = recordedDate ? new Date(recordedDate) : new Date();
    const normalizedDate = new Date(rawDate);
    normalizedDate.setUTCHours(0, 0, 0, 0);

    const filter = {
      resourceType,
      resourceId: resourceId.toString(),
      recordedDate: normalizedDate,
    };

    const update = {
      $set: {
        resourceName,
        utilizationRate: Number(utilizationRate),
        capacity: capacity !== undefined ? Number(capacity) : undefined,
        activeCount: activeCount !== undefined ? Number(activeCount) : undefined,
        hospitalId: hospitalId ? new Types.ObjectId(hospitalId.toString()) : undefined,
        dataSource: "MANUAL",
      },
    };

    const snapshot = await ResourceUtilizationModel.findOneAndUpdate(
      filter,
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const hospId = hospitalId?.toString();
    await Promise.all([
      invalidateEndpoint(hospId, "dashboard-resource-utilization"),
      invalidateEndpoint(hospId, "dashboard-equipment-utilization"),
      invalidateEndpoint(hospId, "dashboard-facility-utilization"),
    ]);

    return successResponse(res, snapshot, "Utilization snapshot saved", 200);
  } catch (error: any) {
    console.error(`${CTRL} upsertUtilization error:`, error);
    return errorResponse(res, error.message || "Failed to save utilization snapshot", STATUS_CODE.ERROR);
  }
};

export const listUtilization = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseTableParams(req.query as Record<string, unknown>);
    const hospitalId = (req as any).user?.hospitalId;

    const match: Record<string, unknown> = {};
    if (hospitalId) match.hospitalId = new Types.ObjectId(hospitalId);
    if (req.query.resourceType) match.resourceType = req.query.resourceType as string;
    if (req.query.resourceId) match.resourceId = req.query.resourceId as string;
    if (req.query.from || req.query.to) {
      match.recordedDate = {
        ...(req.query.from ? { $gte: new Date(req.query.from as string) } : {}),
        ...(req.query.to ? { $lte: new Date(req.query.to as string) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      ResourceUtilizationModel.find(match)
        .sort({ recordedDate: -1 })
        .skip((params.page - 1) * params.limit)
        .limit(params.limit)
        .lean(),
      ResourceUtilizationModel.countDocuments(match),
    ]);

    return successListResponse(res, data, buildPaginationMeta(total, params.page, params.limit));
  } catch (error: any) {
    console.error(`${CTRL} listUtilization error:`, error);
    return errorResponse(res, error.message || "Failed to list utilization", STATUS_CODE.ERROR);
  }
};

export const getLatestUtilization = async (req: Request, res: Response): Promise<void> => {
  try {
    const hospitalId = (req as any).user?.hospitalId;
    const resourceType = req.query.resourceType as string | undefined;

    const match: Record<string, unknown> = {};
    if (hospitalId) match.hospitalId = new Types.ObjectId(hospitalId);
    if (resourceType && VALID_RESOURCE_TYPES.includes(resourceType)) {
      match.resourceType = resourceType;
    }

    const pipeline = [
      { $match: match },
      { $sort: { recordedDate: -1 as const } },
      {
        $group: {
          _id: { resourceType: "$resourceType", resourceId: "$resourceId" },
          resourceName: { $first: "$resourceName" },
          utilizationRate: { $first: "$utilizationRate" },
          capacity: { $first: "$capacity" },
          activeCount: { $first: "$activeCount" },
          snapshotDate: { $first: "$recordedDate" },
          dataSource: { $first: "$dataSource" },
        },
      },
      {
        $project: {
          _id: 0,
          resourceType: "$_id.resourceType",
          resourceId: "$_id.resourceId",
          resourceName: 1,
          utilizationRate: 1,
          capacity: 1,
          activeCount: 1,
          snapshotDate: 1,
          dataSource: 1,
        },
      },
      { $sort: { utilizationRate: -1 as const } },
    ];

    const data = await ResourceUtilizationModel.aggregate(pipeline as any[]);
    return successResponse(res, data);
  } catch (error: any) {
    console.error(`${CTRL} getLatestUtilization error:`, error);
    return errorResponse(res, error.message || "Failed to get latest utilization", STATUS_CODE.ERROR);
  }
};
