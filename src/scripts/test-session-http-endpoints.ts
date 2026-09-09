/**
 * HTTP Integration Test Suite:
 * Tests live HTTP endpoints for Login, Dual HttpOnly Cookies, Session Validation,
 * Refresh Token Rotation (RTR), and Token Reuse Attack rejection.
 */

import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { connectDB } from "../config/db";
import { UserModel } from "../models/User";
import { hashPassword } from "../utils/common";

const baseUrl = "http://localhost:4000";

interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  setCookies: string[];
}

const makeRequest = (
  url: string,
  options: http.RequestOptions = {},
  postData?: any,
): Promise<HttpResponse> => {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const postBody = postData ? JSON.stringify(postData) : "";

    const headers: any = {
      ...(options.headers || {}),
      ...(postBody
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postBody),
          }
        : {}),
    };

    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "GET",
        headers,
      },
      (res) => {
        let rawData = "";
        res.on("data", (chunk) => (rawData += chunk));
        res.on("end", () => {
          let parsedBody = rawData;
          try {
            parsedBody = JSON.parse(rawData);
          } catch {
            // Keep raw string
          }
          const setCookies: string[] = res.headers["set-cookie"] || [];
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: parsedBody,
            setCookies,
          });
        });
      },
    );

    req.on("error", reject);
    if (postBody) {
      req.write(postBody);
    }
    req.end();
  });
};

const assert = (condition: boolean, testName: string, detail?: string) => {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` — ${detail}` : ""}`);
    throw new Error(`Test failed: ${testName}`);
  }
};

async function runHttpTests() {
  console.log("\n=======================================================");
  console.log("Starting Dual-Token & Session HTTP Endpoints Test Suite");
  console.log("=======================================================\n");

  await connectDB();

  // Create a known password test user for live HTTP login
  const testEmail = "http_test_doctor@pran.ai";
  const plainPassword = "SecurePassword!2026";
  const hashedPassword = await hashPassword(plainPassword);

  let user = await UserModel.findOne({ email: testEmail });
  if (!user) {
    user = await UserModel.create({
      email: testEmail,
      password: hashedPassword,
      name: "Dr. HTTP Test",
      role_id: 3,
      status: 1,
    });
  } else {
    user.password = hashedPassword;
    user.status = 1;
    await user.save();
  }

  // ─── TEST 1: POST /api/login Dual-Token Issuance ───
  console.log("--- Test 1: POST /api/login Issues Access & Refresh Tokens ---");
  const loginRes = await makeRequest(
    `${baseUrl}/api/login`,
    { method: "POST", headers: { Origin: "http://localhost:3000" } },
    { email: testEmail, password: plainPassword },
  );

  assert(loginRes.statusCode === 200, "POST /api/login succeeds with HTTP 200");
  assert(!!loginRes.body.data.access_token, "Response body contains access_token");
  assert(!!loginRes.body.data.refresh_token, "Response body contains refresh_token");
  assert(loginRes.body.data.expires_in === 900, "Response body specifies 900s (15m) expiry");
  assert(!!loginRes.body.data.session_id, "Response body returns session_id");

  // Check Set-Cookie headers
  const setCookies = loginRes.setCookies;
  const accessCookie = setCookies.find((c) => c.startsWith("access_token="));
  const refreshCookie = setCookies.find((c) => c.startsWith("refresh_token="));

  assert(!!accessCookie, "Response sets 'access_token' cookie");
  assert(accessCookie!.includes("HttpOnly"), "access_token cookie has HttpOnly flag");
  assert(accessCookie!.includes("Max-Age=900"), "access_token cookie has Max-Age=900 (15m)");

  assert(!!refreshCookie, "Response sets 'refresh_token' cookie");
  assert(refreshCookie!.includes("HttpOnly"), "refresh_token cookie has HttpOnly flag");
  assert(refreshCookie!.includes("Max-Age=604800"), "refresh_token cookie has Max-Age=604800 (7d)");

  const initialAccessToken = loginRes.body.data.access_token;
  const initialRefreshToken = loginRes.body.data.refresh_token;

  // ─── TEST 2: Protected GET /api/me with Cookie ───
  console.log("\n--- Test 2: Protected Route Succeeds via Access Token Cookie ---");
  const cookieHeader = `access_token=${initialAccessToken}`;
  const meRes = await makeRequest(
    `${baseUrl}/api/me`,
    {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
      },
    },
  );

  assert(meRes.statusCode === 200, "GET /api/me succeeds with HTTP 200 using session cookie");
  assert(meRes.body.data.email === testEmail, "User profile correctly identified from session");

  // ─── TEST 3: POST /api/refresh-token (Refresh Token Rotation) ───
  console.log("\n--- Test 3: POST /api/refresh-token Rotates Tokens (RTR) ---");
  const refreshRes = await makeRequest(
    `${baseUrl}/api/refresh-token`,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        Cookie: `refresh_token=${initialRefreshToken}`,
      },
    },
    {},
  );

  assert(refreshRes.statusCode === 200, "POST /api/refresh-token responds with HTTP 200");
  assert(!!refreshRes.body.data.access_token, "Rotated response returns new access_token");
  assert(!!refreshRes.body.data.refresh_token, "Rotated response returns new refresh_token");
  assert(
    refreshRes.body.data.refresh_token !== initialRefreshToken,
    "New refresh token is DIFFERENT from old refresh token (strict rotation)",
  );

  const rotatedAccessToken = refreshRes.body.data.access_token;
  const rotatedRefreshToken = refreshRes.body.data.refresh_token;

  // Verify new access token works
  const meAfterRotate = await makeRequest(
    `${baseUrl}/api/me`,
    {
      method: "GET",
      headers: {
        Cookie: `access_token=${rotatedAccessToken}`,
      },
    },
  );
  assert(meAfterRotate.statusCode === 200, "Rotated access token successfully accesses protected route");

  // ─── TEST 4: Token Reuse Attack Mitigation ───
  console.log("\n--- Test 4: In-Flight Grace Period & True Reuse Attack Detection ---");
  // Test 4A: In-flight parallel request replays previous refresh token within 30s grace period
  const gracePeriodHttpRes = await makeRequest(
    `${baseUrl}/api/refresh-token`,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        Cookie: `refresh_token=${initialRefreshToken}`,
      },
    },
    {},
  );

  assert(
    gracePeriodHttpRes.statusCode === 200 &&
      gracePeriodHttpRes.body?.data?.is_grace_period === true,
    "In-flight refresh token replay within 30s grace period returns HTTP 200 (parallel request handled)",
  );

  // Test 4B: Attacker presents an older/unauthorized refresh token -> Triggers HTTP 401 & securityViolation
  const { generateRefreshToken } = await import("../utils/common");
  const fakeOldToken = generateRefreshToken({ id: user._id.toString(), sessionId: loginRes.body.data.session_id });

  const reuseAttackRes = await makeRequest(
    `${baseUrl}/api/refresh-token`,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        Cookie: `refresh_token=${fakeOldToken}`,
      },
    },
    {},
  );

  assert(reuseAttackRes.statusCode === 401, "Server rejects unauthorized refresh token with HTTP 401");
  assert(
    reuseAttackRes.body.securityViolation === true,
    "Server flags security violation (token reuse detected)",
  );

  // ─── TEST 5: Session Was Destroyed Following Reuse Attack ───
  console.log("\n--- Test 5: Verify Session Was Terminated Following Reuse Detection ---");
  const meAfterAttack = await makeRequest(
    `${baseUrl}/api/me`,
    {
      method: "GET",
      headers: {
        Cookie: `access_token=${rotatedAccessToken}`,
      },
    },
  );

  assert(
    meAfterAttack.statusCode === 401,
    "Previously valid access token now rejected with HTTP 401 because server terminated the compromised session",
  );
  assert(
    meAfterAttack.body.sessionRevoked === true,
    "Response explicitly identifies sessionRevoked: true",
  );

  // ─── TEST 6: Logout Lifecycle ───
  console.log("\n--- Test 6: POST /api/logout Clears All Cookies ---");
  // Log in again to get fresh session
  const login2 = await makeRequest(
    `${baseUrl}/api/login`,
    { method: "POST", headers: { Origin: "http://localhost:3000" } },
    { email: testEmail, password: plainPassword },
  );
  const cleanAccessToken = login2.body.data.access_token;

  const logoutRes = await makeRequest(
    `${baseUrl}/api/logout`,
    {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        Cookie: `access_token=${cleanAccessToken}`,
      },
    },
  );

  assert(logoutRes.statusCode === 200, "POST /api/logout responds with HTTP 200");
  const logoutCookies = logoutRes.setCookies;
  const clearedAccess = logoutCookies.some(
    (c) => c.startsWith("access_token=") && (c.includes("Max-Age=0") || c.includes("Expires=")),
  );
  const clearedRefresh = logoutCookies.some(
    (c) => c.startsWith("refresh_token=") && (c.includes("Max-Age=0") || c.includes("Expires=")),
  );

  assert(clearedAccess, "Logout clears access_token cookie");
  assert(clearedRefresh, "Logout clears refresh_token cookie");

  console.log("\n=======================================================");
  console.log("🎉 All HTTP Endpoint & Cookie Security Tests Passed!");
  console.log("=======================================================\n");

  process.exit(0);
}

runHttpTests().catch((err) => {
  console.error("HTTP test failed:", err);
  process.exit(1);
});
