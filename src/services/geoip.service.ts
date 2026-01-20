export interface GeoInfo {
  ipAddress: string;
  city?: string;
  region?: string;
  country?: string;
  countryName?: string;
  timezone?: string;
  isp?: string;
}

interface IpApiResponse {
  status: "success" | "fail";
  message?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
  timezone?: string;
  isp?: string;
  query: string;
}

const geoCache = new Map<string, { data: GeoInfo; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getGeoInfo(ip: string): Promise<GeoInfo> {
  if (isPrivateIp(ip)) {
    return {
      ipAddress: ip,
      city: "Local",
      country: "LOCAL",
      countryName: "Local Network",
    };
  }

  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const fields =
      "status,message,country,countryCode,region,regionName,city,timezone,isp,query";
    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=${fields}`,
      { signal: AbortSignal.timeout(5000) },
    );

    if (!response.ok) {
      console.warn(`GeoIP API returned ${response.status}`);
      return { ipAddress: ip };
    }

    const data: IpApiResponse = await response.json();

    if (data.status === "fail") {
      console.warn(`GeoIP lookup failed: ${data.message}`);
      return { ipAddress: ip };
    }

    const geoInfo: GeoInfo = {
      ipAddress: ip,
      city: data.city,
      region: data.regionName,
      country: data.countryCode,
      countryName: data.country,
      timezone: data.timezone,
      isp: data.isp,
    };

    geoCache.set(ip, { data: geoInfo, timestamp: Date.now() });

    return geoInfo;
  } catch (error) {
    console.error("GeoIP lookup error:", error);
    return { ipAddress: ip };
  }
}

function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip === "::ffff:127.0.0.1") {
    return true;
  }

  const parts = ip.replace("::ffff:", "").split(".");
  if (parts.length !== 4) return false;

  const [first, second] = parts.map(Number);

  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function extractClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const ips = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded.split(",")[0];
    return ips.trim();
  }

  const realIp = req.headers["x-real-ip"];
  if (realIp && typeof realIp === "string") {
    return realIp.trim();
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function cleanupGeoCache(): void {
  const now = Date.now();
  for (const [ip, entry] of geoCache.entries()) {
    if (now - entry.timestamp >= CACHE_TTL_MS) {
      geoCache.delete(ip);
    }
  }
}
