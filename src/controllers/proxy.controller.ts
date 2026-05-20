import { Request, Response } from "express";
import axios, { AxiosRequestConfig, Method } from "axios";

const TARGET_BASE_URL = "https://bhmis.pran.ai";

export const proxyRequest = async (req: Request, res: Response) => {
  try {
    const fullPath = req.path;
    const targetPath = fullPath.replace(/^\/proxy\/?/, "");
    const targetUrl = `${TARGET_BASE_URL}/${targetPath}`;

    const forwardHeaders: Record<string, string> = {};
    const excludeHeaders = ["host", "content-length", "connection", "origin"];

    for (const [key, value] of Object.entries(req.headers)) {
      if (
        !excludeHeaders.includes(key.toLowerCase()) &&
        typeof value === "string"
      ) {
        forwardHeaders[key] = value;
      }
    }

    const axiosConfig: AxiosRequestConfig = {
      method: req.method as Method,
      url: targetUrl,
      headers: forwardHeaders,
      params: req.query,
      data: req.body,
      validateStatus: () => true,
      timeout: 30000,
    };

    console.log(`[Proxy] ${req.method} ${targetUrl}`);

    const response = await axios(axiosConfig);

    const excludeResponseHeaders = [
      "transfer-encoding",
      "content-encoding",
      "connection",
      "access-control-allow-origin",
      "access-control-allow-methods",
      "access-control-allow-headers",
      "access-control-allow-credentials",
      "access-control-expose-headers",
      "access-control-max-age",
    ];
    for (const [key, value] of Object.entries(response.headers)) {
      if (!excludeResponseHeaders.includes(key.toLowerCase())) {
        res.setHeader(key, value as string);
      }
    }

    res.status(response.status).send(response.data);
  } catch (error: any) {
    console.error("[Proxy] Error:", error.message);

    if (error.code === "ECONNREFUSED") {
      return res.status(502).json({
        error: "Bad Gateway",
        message: "Unable to connect to target server",
      });
    }

    if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
      return res.status(504).json({
        error: "Gateway Timeout",
        message: "Target server did not respond in time",
      });
    }

    return res.status(500).json({
      error: "Internal Server Error",
      message: "An error occurred while proxying the request",
    });
  }
};
