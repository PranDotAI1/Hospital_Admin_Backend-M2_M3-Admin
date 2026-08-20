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

/**
 * Generates a complete ordered list of period labels between `start` and `end`
 * for the given `groupBy` granularity. This ensures time-series charts always
 * render a full skeleton of x-axis buckets even when the database has no
 * records for certain periods.
 *
 * Caps: day → 60 buckets max, week → 26, month → 24, quarter → 12, year → 10.
 */
export const generatePeriodSkeleton = (
  start: Date,
  end: Date,
  groupBy: PeriodType
): string[] => {
  const labels: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  const CAPS: Record<PeriodType, number> = {
    day: 60,
    week: 26,
    month: 24,
    quarter: 12,
    year: 10,
  };
  const cap = CAPS[groupBy] ?? 26;

  while (cursor <= end && labels.length < cap) {
    const year  = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    const day   = cursor.getDate();

    switch (groupBy) {
      case "day":
        labels.push(`${MONTH_NAMES[month - 1]} ${day}, ${year}`);
        cursor.setDate(cursor.getDate() + 1);
        break;
      case "week": {
        // ISO week number
        const tmp = new Date(cursor);
        tmp.setHours(0, 0, 0, 0);
        tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
        const week1 = new Date(tmp.getFullYear(), 0, 4);
        const weekNo =
          1 +
          Math.round(
            ((tmp.getTime() - week1.getTime()) / 86400000 -
              3 +
              ((week1.getDay() + 6) % 7)) /
              7
          );
        labels.push(`Week ${weekNo}, ${year}`);
        cursor.setDate(cursor.getDate() + 7);
        break;
      }
      case "month":
        labels.push(`${MONTH_NAMES[month - 1]} ${year}`);
        cursor.setMonth(cursor.getMonth() + 1);
        break;
      case "quarter": {
        const q = Math.ceil(month / 3);
        labels.push(`Q${q} ${year}`);
        cursor.setMonth(cursor.getMonth() + 3);
        break;
      }
      case "year":
        labels.push(`${year}`);
        cursor.setFullYear(cursor.getFullYear() + 1);
        break;
      default:
        cursor.setDate(cursor.getDate() + 7);
    }
  }

  return labels;
};

/**
 * Merges real data points into a full period skeleton.
 * Any period missing from `realData` gets a zero-filled row using `zeroFactory`.
 *
 * @param skeleton  - ordered period labels from generatePeriodSkeleton
 * @param realData  - the actual aggregation results (must have a `period` string field)
 * @param periodKey - the field name that holds the period label in each real-data item
 * @param zeroFactory - function that returns a zeroed-out row for a given period label
 */
export const fillPeriodGaps = <T extends Record<string, unknown>>(
  skeleton: string[],
  realData: T[],
  periodKey: keyof T,
  zeroFactory: (period: string) => T
): T[] => {
  const dataMap = new Map<string, T>(
    realData.map((d) => [String(d[periodKey]), d])
  );
  return skeleton.map((label) => dataMap.get(label) ?? zeroFactory(label));
};
