// eslint-disable-next-line @typescript-eslint/no-require-imports
const UAParser = require("ua-parser-js");
import { DeviceType } from "../models/Session";

export interface ParsedUserAgent {
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  deviceType: DeviceType;
  deviceName?: string;
}

export function parseUserAgent(userAgent: string): ParsedUserAgent {
  const parser = new UAParser(userAgent);

  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();

  return {
    browser: browser.name,
    browserVersion: browser.version,
    os: os.name,
    osVersion: os.version,
    deviceType: mapDeviceType(device.type),
    deviceName: device.model || device.vendor || undefined,
  };
}

function mapDeviceType(type: string | undefined): DeviceType {
  switch (type) {
    case "mobile":
    case "wearable":
      return DeviceType.MOBILE;
    case "tablet":
      return DeviceType.TABLET;
    case "console":
    case "smarttv":
    case "embedded":
      return DeviceType.DESKTOP;
    default:
      return type ? DeviceType.UNKNOWN : DeviceType.DESKTOP;
  }
}

export function getDeviceDescription(parsed: ParsedUserAgent): string {
  const parts: string[] = [];

  if (parsed.browser) {
    parts.push(
      `${parsed.browser}${parsed.browserVersion ? ` ${parsed.browserVersion}` : ""}`,
    );
  }

  if (parsed.os) {
    parts.push(
      `on ${parsed.os}${parsed.osVersion ? ` ${parsed.osVersion}` : ""}`,
    );
  }

  if (parsed.deviceName) {
    parts.push(`(${parsed.deviceName})`);
  }

  return parts.join(" ") || "Unknown Device";
}
