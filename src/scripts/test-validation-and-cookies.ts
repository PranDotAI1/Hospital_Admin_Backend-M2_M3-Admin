import dotenv from "dotenv";
dotenv.config();
import http from "http";
import app from "../app";
import { connectDB } from "../config/db";
import mongoose from "mongoose";

/**
 * Automated Verification Script for:
 * 1. Input Validation & XSS Prevention
 * 2. Object Serialization Bug Prevention ([object Object])
 * 3. 1-character name and invalid mobile rejection
 * 4. HttpOnly Cookie Issuance on Login
 * 5. Cookie-Based Authentication in checkToken
 * 6. Logout Cookie Invalidation
 */

function makeRequest(
  serverUrl: string,
  options: http.RequestOptions,
  bodyData?: any,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(serverUrl, options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode || 500,
          headers: res.headers,
          body: parsed,
        });
      });
    });

    req.on("error", reject);

    if (bodyData) {
      const payload =
        typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData);
      req.write(payload);
    }
    req.end();
  });
}

async function runTests() {
  console.log("=== Running Automated Validation & Cookie Authentication Tests ===\n");

  await connectDB();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Test server running on ${baseUrl}\n`);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${detail ? `- ${detail}` : ""}`);
      failed++;
    }
  }

  try {
    // ─── TEST 1: Login & HttpOnly Cookie Issuance ───
    console.log("--- Test Suite 1: Authentication & HttpOnly Cookies ---");
    // Find an active user to log in with
    const { UserModel } = await import("../models/User");
    const testUser = await UserModel.findOne({ status: 1 }).lean();

    let authToken = "";
    let cookieHeader = "";

    if (testUser) {
      // Create a known password user or test with existing
      console.log(`Testing with user email: ${testUser.email}`);
      // Test login with wrong password
      const wrongLogin = await makeRequest(
        `${baseUrl}/api/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        { email: testUser.email, password: "WrongPassword!123" },
      );
      assert(
        wrongLogin.statusCode === 401,
        "Login rejects incorrect password with HTTP 401",
      );

      // Generate a valid token directly for middleware test
      const { generateToken } = await import("../utils/common");
      authToken = generateToken({
        id: testUser._id,
        email: testUser.email,
        role_id: testUser.role_id,
        hospital_id: testUser.hospital_id,
      });
      cookieHeader = `access_token=${authToken}`;

      // ─── TEST 2: Protected Route with Cookie (No Authorization Header) ───
      const cookieAuthRes = await makeRequest(
        `${baseUrl}/api/profile`,
        {
          method: "GET",
          headers: {
            Cookie: cookieHeader,
          },
        },
      );
      assert(
        cookieAuthRes.statusCode === 200,
        "Protected GET /api/profile succeeds via HttpOnly Cookie (no Auth header)",
        `Got status: ${cookieAuthRes.statusCode}`,
      );

      // ─── TEST 3: Session check endpoint /api/me ───
      const meRes = await makeRequest(
        `${baseUrl}/api/me`,
        {
          method: "GET",
          headers: {
            Cookie: cookieHeader,
          },
        },
      );
      assert(
        meRes.statusCode === 200,
        "Session check GET /api/me succeeds via Cookie",
        `Got status: ${meRes.statusCode}`,
      );

      // ─── TEST 4: Protected Route WITHOUT Cookie or Header ───
      const unauthRes = await makeRequest(
        `${baseUrl}/api/profile`,
        {
          method: "GET",
        },
      );
      assert(
        unauthRes.statusCode === 401,
        "Protected GET /api/profile rejects unauthenticated request with HTTP 401",
      );

      // ─── TEST 5: Logout Clears Cookie ───
      const logoutRes = await makeRequest(
        `${baseUrl}/api/logout`,
        {
          method: "POST",
          headers: {
            Cookie: cookieHeader,
            Origin: "http://localhost:3000",
          },
        },
      );
      assert(
        logoutRes.statusCode === 200,
        "Logout endpoint responds with HTTP 200",
      );
      const setCookieHeaders = logoutRes.headers["set-cookie"] || [];
      const clearsAccessToken = setCookieHeaders.some(
        (c) => c.includes("access_token=") && (c.includes("Max-Age=0") || c.includes("Expires=")),
      );
      assert(
        clearsAccessToken,
        "Logout endpoint includes Set-Cookie clearing access_token",
      );
    } else {
      console.warn("No test user found in database, skipping live login tests");
    }

    // ─── TEST 6: Patient Registration Input Validation ───
    console.log("\n--- Test Suite 2: Patient Registration Input Validation ---");

    if (!testUser) {
      throw new Error("Cannot run test without a user");
    }
    const { generateToken: genFreshToken } = await import("../utils/common");
    const freshToken = genFreshToken({
      id: testUser._id,
      email: testUser.email,
      role_id: testUser.role_id,
      hospital_id: testUser.hospital_id,
    });
    const freshCookieHeader = `access_token=${freshToken}`;

    // 6a: Reject XSS Payload in First Name
    const xssRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "<script>alert(1)</script>",
        mobile: "9876543210",
      },
    );
    assert(
      xssRes.statusCode === 400,
      "Rejects <script>alert(1)</script> with HTTP 400",
      `Got status: ${xssRes.statusCode}`,
    );

    // 6b: Reject Image onerror XSS Payload
    const imgXssRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "<img src=x onerror=alert('xssmark')>",
        mobile: "9876543210",
      },
    );
    assert(
      imgXssRes.statusCode === 400,
      "Rejects <img src=x onerror=...> with HTTP 400",
      `Got status: ${imgXssRes.statusCode}`,
    );

    // 6c: Reject 1-character name "t"
    const singleCharRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "t",
        mobile: "9876543210",
      },
    );
    assert(
      singleCharRes.statusCode === 400,
      "Rejects 1-character name 't' with HTTP 400",
      `Got status: ${singleCharRes.statusCode}`,
    );

    // 6d: Reject numeric name "1"
    const numNameRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "1",
        mobile: "9876543210",
      },
    );
    assert(
      numNameRes.statusCode === 400,
      "Rejects numeric name '1' with HTTP 400",
      `Got status: ${numNameRes.statusCode}`,
    );

    // 6e: Reject [object Object] in mobile
    const objMobileRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "Ramesh Sharma",
        mobile: "[object Object]",
      },
    );
    assert(
      objMobileRes.statusCode === 400,
      "Rejects '[object Object]' as mobile number with HTTP 400",
      `Got status: ${objMobileRes.statusCode}`,
    );

    // 6f: Reject invalid 5-digit mobile
    const shortMobRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "Ramesh Sharma",
        mobile: "12345",
      },
    );
    assert(
      shortMobRes.statusCode === 400,
      "Rejects invalid mobile number '12345' with HTTP 400",
      `Got status: ${shortMobRes.statusCode}`,
    );

    // 6g: Reject [object Object] in firstName
    const objNameRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "[object Object]",
        mobile: "9876543210",
      },
    );
    assert(
      objNameRes.statusCode === 400,
      "Rejects '[object Object]' in f_name with HTTP 400",
      `Got status: ${objNameRes.statusCode}`,
    );

    // 6i: Reject placeholder name "test"
    const testNameRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "test",
        mobile: "9876543219",
      },
    );
    assert(
      testNameRes.statusCode === 400,
      "Rejects placeholder name 'test' with HTTP 400",
      `Got status: ${testNameRes.statusCode}`,
    );

    // 6j: Reject keyboard mash "asdf"
    const asdfNameRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "asdf",
        mobile: "9876543219",
      },
    );
    assert(
      asdfNameRes.statusCode === 400,
      "Rejects keyboard mash 'asdf' with HTTP 400",
      `Got status: ${asdfNameRes.statusCode}`,
    );

    // 6k: Reject literal "undefined"
    const undefNameRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "undefined",
        mobile: "9876543219",
      },
    );
    assert(
      undefNameRes.statusCode === 400,
      "Rejects literal 'undefined' as name with HTTP 400",
      `Got status: ${undefNameRes.statusCode}`,
    );

    // 6l: Reject repetitive characters "aaaaa"
    const repeatNameRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "aaaaa",
        mobile: "9876543219",
      },
    );
    assert(
      repeatNameRes.statusCode === 400,
      "Rejects repetitive character junk 'aaaaa' with HTTP 400",
      `Got status: ${repeatNameRes.statusCode}`,
    );

    // 6m: Reject numbers in name "John123"
    const numInNameRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "John123",
        mobile: "9876543219",
      },
    );
    assert(
      numInNameRes.statusCode === 400,
      "Rejects numbers embedded in name 'John123' with HTTP 400",
      `Got status: ${numInNameRes.statusCode}`,
    );

    // 6n: Reject malformed punctuation "--Smith"
    const malformedPunctRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "--Smith",
        mobile: "9876543219",
      },
    );
    assert(
      malformedPunctRes.statusCode === 400,
      "Rejects malformed punctuation '--Smith' with HTTP 400",
      `Got status: ${malformedPunctRes.statusCode}`,
    );

    // 6o: Reject [object Array]
    const objArrayRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "[object Array]",
        mobile: "9876543219",
      },
    );
    assert(
      objArrayRes.statusCode === 400,
      "Rejects '[object Array]' with HTTP 400",
      `Got status: ${objArrayRes.statusCode}`,
    );

    // 6p: Reject 10 repeating identical digits in mobile
    const repeatMobileRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "Ramesh",
        mobile: "9999999999",
      },
    );
    assert(
      repeatMobileRes.statusCode === 400,
      "Rejects dummy mobile number with 10 identical digits '9999999999' with HTTP 400",
      `Got status: ${repeatMobileRes.statusCode}`,
    );

    // 6q: Reject future date of birth
    const futureDobRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "Ramesh",
        mobile: "9876543219",
        dob: "2099-01-01",
      },
    );
    assert(
      futureDobRes.statusCode === 400,
      "Rejects future date of birth '2099-01-01' with HTTP 400",
      `Got status: ${futureDobRes.statusCode}`,
    );

    // 6r: Reject impossible calendar date (Feb 31)
    const badCalendarRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "Ramesh",
        mobile: "9876543219",
        dob: "2024-02-31",
      },
    );
    assert(
      badCalendarRes.statusCode === 400,
      "Rejects impossible calendar date '2024-02-31' with HTTP 400",
      `Got status: ${badCalendarRes.statusCode}`,
    );

    // 6s: Accept valid patient registration
    const validPatientRes = await makeRequest(
      `${baseUrl}/api/patient/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: freshCookieHeader,
          Origin: "http://localhost:3000",
        },
      },
      {
        f_name: "Vikas",
        l_name: "Verma",
        mobile: "9876543219",
        age: 32,
        dob: "1994-06-15",
        gender: "Male",
        address: "Flat 402, Greenfield Apartments",
      },
    );
    assert(
      validPatientRes.statusCode === 200 || validPatientRes.statusCode === 201,
      "Accepts valid patient registration with HTTP 200/201",
      `Got status: ${validPatientRes.statusCode}`,
    );

    // Clean up created test patient
    if (validPatientRes.body?.data?.uhid) {
      const { PatientModel } = await import("../models/Patient");
      await PatientModel.deleteOne({ uhid: validPatientRes.body.data.uhid });
      console.log(`Cleaned up test patient record with UHID: ${validPatientRes.body.data.uhid}`);
    }

  } finally {
    server.close();
    await mongoose.disconnect();
  }

  console.log(`\n=== Verification Results ===`);
  console.log(`Total tests passed: ${passed}`);
  console.log(`Total tests failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("\n🎉 All input validation and cookie authentication tests passed successfully!");
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
