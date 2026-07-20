import crypto from "crypto";
import { getRedisConnection } from "../config/redis";

const LOG_PREFIX = "[ANALYTICS_CACHE]";

export const CACHE_TTL = {
  ANALYTICS_SHORT: 5 * 60,
  ANALYTICS_LIVE: 60,
  ANALYTICS_MEDIUM: 10 * 60,
  ANALYTICS_LONG: 15 * 60,
} as const;

export const buildCacheKey = (
  hospitalId: string | undefined,
  endpoint: string,
  params: Record<string, unknown>
): string => {
  const hosp = hospitalId || "global";
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
  const hash = crypto.createHash("md5").update(sorted).digest("hex").slice(0, 12);
  return `analytics:${hosp}:${endpoint}:${hash}`;
};


export const getCached = async <T>(key: string): Promise<T | null> => {
  try {
    const redis = getRedisConnection();
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} getCached error (key=${key}):`, err.message);
    return null;
  }
};

export const setCached = async (
  key: string,
  data: unknown,
  ttlSeconds: number
): Promise<void> => {
  try {
    const redis = getRedisConnection();
    await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} setCached error (key=${key}):`, err.message);
  }
};

export const invalidatePattern = async (pattern: string): Promise<void> => {
  try {
    const redis = getRedisConnection();
    let cursor = "0";
    const keysToDelete: string[] = [];

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== "0");

    if (keysToDelete.length > 0) {
      const pipeline = redis.pipeline();
      keysToDelete.forEach((k) => pipeline.del(k));
      await pipeline.exec();
      console.log(
        `${LOG_PREFIX} Invalidated ${keysToDelete.length} keys matching "${pattern}"`
      );
    }
  } catch (err: any) {
    console.warn(
      `${LOG_PREFIX} invalidatePattern error (pattern=${pattern}):`,
      err.message
    );
  }
};

export const invalidateHospitalAnalytics = async (
  hospitalId: string
): Promise<void> => {
  await invalidatePattern(`analytics:${hospitalId}:*`);
};

export const invalidateEndpoint = async (
  hospitalId: string | undefined,
  endpoint: string
): Promise<void> => {
  const hosp = hospitalId || "*";
  await invalidatePattern(`analytics:${hosp}:${endpoint}:*`);
};
