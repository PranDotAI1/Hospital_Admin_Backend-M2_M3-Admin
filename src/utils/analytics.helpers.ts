import { Request } from "express";
import { Types } from "mongoose";

export type PeriodType = "day" | "week" | "month" | "quarter" | "year";

export interface DateRange {
  start: Date;
  end: Date;
}

export interface AnalyticsParams {
  groupBy: PeriodType;
  start: Date;
  end: Date;
  hospitalId?: string;
  departmentId?: string;
  physicianId?: string;
  limit: number;
  page: number;
  search?: string;
  sortBy?: string;
  sortOrder: 1 | -1;
  ageGroup?: string;
}

const VALID_PERIODS: PeriodType[] = ["day", "week", "month", "quarter", "year"];
const DEFAULT_PERIOD: PeriodType = "week";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_TABLE_LIMIT = 100;

export const parseDateRange = (
  period: PeriodType,
  from?: string,
  to?: string
): DateRange => {
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
        break;
      case "month":
        start.setMonth(start.getMonth() - 1);
        break;
      case "quarter":
        start.setMonth(start.getMonth() - 3);
        break;
      case "year":
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        start.setDate(start.getDate() - 6);
    }
  }
  start.setHours(0, 0, 0, 0);
  return { start, end };
};

export const parseAnalyticsParams = (
  query: Record<string, unknown>
): AnalyticsParams => {
  const rawPeriod = (query.groupBy as string || DEFAULT_PERIOD).toLowerCase();
  const groupBy = VALID_PERIODS.includes(rawPeriod as PeriodType)
    ? (rawPeriod as PeriodType)
    : DEFAULT_PERIOD;

  const from = query.from as string | undefined;
  const to = query.to as string | undefined;
  const { start, end } = parseDateRange(groupBy, from, to);

  const rawLimit = parseInt(String(query.limit || DEFAULT_LIMIT), 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit));

  const rawPage = parseInt(String(query.page || 1), 10);
  const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);

  const sortOrder: 1 | -1 =
    (query.sortOrder as string)?.toLowerCase() === "desc" ? -1 : 1;

  return {
    groupBy,
    start,
    end,
    hospitalId: query.hospitalId as string | undefined,
    departmentId: query.departmentId as string | undefined,
    physicianId: query.physicianId as string | undefined,
    limit,
    page,
    search: (query.search as string)?.trim() || undefined,
    sortBy: (query.sortBy as string) || undefined,
    sortOrder,
    ageGroup: (query.ageGroup as string) || undefined,
  };
};

export const parseTableParams = (
  query: Record<string, unknown>
): AnalyticsParams => {
  const params = parseAnalyticsParams(query);
  const rawLimit = parseInt(String(query.limit || 10), 10);
  params.limit = Math.min(MAX_TABLE_LIMIT, Math.max(1, isNaN(rawLimit) ? 10 : rawLimit));
  return params;
};

export const isValidObjectId = (value?: string): boolean =>
  !!value && /^[a-f0-9]{24}$/i.test(value);

export const toObjectId = (value?: string): Types.ObjectId | undefined => {
  if (!isValidObjectId(value)) return undefined;
  return new Types.ObjectId(value!);
};

export const buildDateGroupExpr = (
  dateField: string,
  groupBy: PeriodType
): Record<string, unknown> => {
  const field = `$${dateField}`;
  switch (groupBy) {
    case "day":
      return {
        year: { $year: field },
        month: { $month: field },
        day: { $dayOfMonth: field },
      };
    case "week":
      return {
        year: { $year: field },
        week: { $week: field },
      };
    case "month":
      return {
        year: { $year: field },
        month: { $month: field },
      };
    case "quarter":
      return {
        year: { $year: field },
        quarter: { $ceil: { $divide: [{ $month: field }, 3] } },
      };
    case "year":
      return { year: { $year: field } };
    default:
      return {
        year: { $year: field },
        month: { $month: field },
      };
  }
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const formatPeriodLabel = (
  _id: Record<string, number>,
  groupBy: PeriodType
): string => {
  const { year, month, day, week, quarter } = _id;
  switch (groupBy) {
    case "day":
      return `${MONTH_NAMES[(month ?? 1) - 1]} ${day}, ${year}`;
    case "week":
      return `Week ${week}, ${year}`;
    case "month":
      return `${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
    case "quarter":
      return `Q${quarter} ${year}`;
    case "year":
      return `${year}`;
    default:
      return `${year}`;
  }
};

const DOW_LABELS: Record<number, string> = {
  1: "Sun", 2: "Mon", 3: "Tue", 4: "Wed", 5: "Thu", 6: "Fri", 7: "Sat",
};

export const dowLabel = (dayOfWeek: number): string =>
  DOW_LABELS[dayOfWeek] ?? "?";

export const sortByDayOfWeek = <T extends { dayIndex: number }>(arr: T[]): T[] =>
  arr.sort((a, b) => {
    const normalize = (d: number) => (d === 1 ? 7 : d);
    return normalize(a.dayIndex) - normalize(b.dayIndex);
  });

export const pct = (value: number, total: number, decimals = 1): number => {
  if (total === 0) return 0;
  return Math.round((value / total) * Math.pow(10, decimals + 2)) / Math.pow(10, decimals);
};

/**
 * Resolves hospitalId from the authenticated session first, falling back to an
 * explicit query param. Session-derived values are always preferred so that a
 * regular staff user cannot query another hospital's data by passing a query
 * param — only super-admin tokens that lack a sessionHospitalId will use the
 * param.
 */
export const getHospitalId = (req: Request): string | undefined => {
  const fromSession = (req as any).user?.hospitalId?.toString();
  const fromQuery  = req.query.hospitalId as string | undefined;
  return fromSession || fromQuery;
};
