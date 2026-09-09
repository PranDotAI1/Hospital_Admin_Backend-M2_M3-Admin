/**
 * Production-Grade Test Suite:
 * Access & Refresh Token Combination, Session Validation, Refresh Token Rotation,
 * Reuse Detection, and Max 3 Concurrent Sessions Enforcement.
 */

import dotenv from "dotenv";
dotenv.config();

import { connectDB } from "../config/db";
import { UserModel } from "../models/User";
import { SessionModel } from "../models/Session";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  ACCESS_TOKEN_EXPIRY_SECONDS,
} from "../utils/common";
import {
  createSession,
  validateSession,
  rotateSessionToken,
  revokeSession,
  revokeAllUserSessions,
  getUserActiveSessions,
  MAX_CONCURRENT_SESSIONS_PER_USER,
} from "../services/session.service";

const assert = (condition: boolean, testName: string, detail?: string) => {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` — ${detail}` : ""}`);
    throw new Error(`Test failed: ${testName}`);
  }
};

async function runTests() {
  console.log("\n=======================================================");
  console.log("Starting Session & Dual-Token Integration Test Suite");
  console.log("=======================================================\n");

  await connectDB();

  // Find or create a test user
  let testUser: any = await UserModel.findOne({ status: 1 });
  if (!testUser) {
    testUser = await UserModel.create({
      email: `test_session_${Date.now()}@example.com`,
      name: "Test Session User",
      role_id: 1,
      status: 1,
      password: "HashedPassword123!",
    });
  }

  const userId = (testUser._id || testUser.id).toString();
  console.log(`Using test user: ${testUser.email} (ID: ${userId})`);

  // Clean up any old test sessions for this user
  await revokeAllUserSessions(userId);

  // ─── SUITE 1: Token Properties & Lifetimes ───
  console.log("\n--- Suite 1: Token Generation, Expiry, and Claims ---");
  const testSessionId = "test-session-uuid-12345";
  const accessToken = generateAccessToken({
    id: userId,
    email: testUser.email,
    role_id: testUser.role_id,
    sessionId: testSessionId,
  });

  const refreshToken = generateRefreshToken({
    id: userId,
    sessionId: testSessionId,
  });

  assert(typeof accessToken === "string" && accessToken.length > 50, "Access token is generated");
  assert(typeof refreshToken === "string" && refreshToken.length > 50, "Refresh token is generated");

  const decodedAccess: any = verifyAccessToken(accessToken);
  assert(decodedAccess !== null, "Access token verifies cryptographically");
  assert(decodedAccess?.sessionId === testSessionId, "Access token embeds sessionId");
  assert(decodedAccess?.id === userId, "Access token embeds userId");

  // Check access token expiry is ~15 minutes (900 seconds)
  const accessTtl = decodedAccess.exp - decodedAccess.iat;
  assert(
    accessTtl === ACCESS_TOKEN_EXPIRY_SECONDS,
    `Access token TTL is exactly 15 minutes (900s). Got: ${accessTtl}s`,
  );

  const decodedRefresh: any = verifyRefreshToken(refreshToken);
  assert(decodedRefresh !== null, "Refresh token verifies cryptographically");
  assert(decodedRefresh?.sessionId === testSessionId, "Refresh token embeds sessionId");
  assert(decodedRefresh?.type === "refresh", "Refresh token has type 'refresh'");

  // ─── SUITE 2: Server-Side Session Validation ───
  console.log("\n--- Suite 2: Server-Side Session Creation & Validation ---");
  const session1 = await createSession({
    userId,
    email: testUser.email as string,
    role_id: (testUser.role_id as number) || 1,
    refreshToken,
    userAgent: "Mozilla/5.0 Test Suite",
    ipAddress: "127.0.0.1",
  });

  assert(session1 !== null && !!session1.sessionId, "Session 1 created in MongoDB & Redis");

  const validatedSession1 = await validateSession(session1.sessionId);
  assert(validatedSession1 !== null, "validateSession returns active session data");
  assert(validatedSession1?.isValid === true, "Session 1 is active and valid");
  assert(validatedSession1?.email === testUser.email, "Session matches user email");

  // Test Server-Side Session Invalidation (Revocation)
  await revokeSession(session1.sessionId);
  const revokedSession1 = await validateSession(session1.sessionId);
  assert(
    revokedSession1 === null,
    "validateSession returns null immediately after session is revoked (checkToken rejects!)",
  );

  // ─── SUITE 3: Concurrent Session Limit (Max 3 per user) ───
  console.log(`\n--- Suite 3: Max Concurrent Sessions Enforcement (Max ${MAX_CONCURRENT_SESSIONS_PER_USER}) ---`);
  // Clean slate
  await revokeAllUserSessions(userId);

  const s1 = await createSession({
    userId,
    email: testUser.email as string,
    role_id: 1,
    refreshToken: generateRefreshToken({ id: userId, sessionId: "s1" }),
    userAgent: "Device 1 (Chrome)",
  });
  // Sleep 50ms to ensure distinct timestamp
  await new Promise((r) => setTimeout(r, 50));

  const s2 = await createSession({
    userId,
    email: testUser.email as string,
    role_id: 1,
    refreshToken: generateRefreshToken({ id: userId, sessionId: "s2" }),
    userAgent: "Device 2 (Firefox)",
  });
  await new Promise((r) => setTimeout(r, 50));

  const s3 = await createSession({
    userId,
    email: testUser.email as string,
    role_id: 1,
    refreshToken: generateRefreshToken({ id: userId, sessionId: "s3" }),
    userAgent: "Device 3 (Mobile Safari)",
  });

  let activeSessions = await getUserActiveSessions(userId);
  assert(
    activeSessions.length === 3,
    `User has 3 active sessions after 3 logins. Got: ${activeSessions.length}`,
  );

  // Now create 4th session -> Must automatically evict s1 (oldest)!
  await new Promise((r) => setTimeout(r, 50));
  const s4 = await createSession({
    userId,
    email: testUser.email as string,
    role_id: 1,
    refreshToken: generateRefreshToken({ id: userId, sessionId: "s4" }),
    userAgent: "Device 4 (Tablet)",
  });

  activeSessions = await getUserActiveSessions(userId);
  assert(
    activeSessions.length === 3,
    `Active sessions count remains capped at 3 after 4th login. Got: ${activeSessions.length}`,
  );

  const s1Check = await validateSession(s1.sessionId);
  assert(s1Check === null, "Oldest session (s1) was automatically revoked upon 4th login");

  const s2Check = await validateSession(s2.sessionId);
  const s3Check = await validateSession(s3.sessionId);
  const s4Check = await validateSession(s4.sessionId);
  assert(s2Check !== null, "Session 2 remains active");
  assert(s3Check !== null, "Session 3 remains active");
  assert(s4Check !== null, "Session 4 remains active");

  // ─── SUITE 4: Refresh Token Rotation (RTR) ───
  console.log("\n--- Suite 4: Refresh Token Rotation (RTR) ---");
  const currentRefreshToken = generateRefreshToken({ id: userId, sessionId: s4.sessionId });
  // Update s4 with this known refresh token
  const sessionModule = await import("../services/session.service");
  await SessionModel.updateOne(
    { sessionId: s4.sessionId },
    { refreshTokenHash: sessionModule.hashRefreshToken(currentRefreshToken) },
  );

  const nextRefreshToken = generateRefreshToken({ id: userId, sessionId: s4.sessionId });
  const rotationResult = await rotateSessionToken(s4.sessionId, currentRefreshToken, nextRefreshToken);

  assert(rotationResult.success === true, "rotateSessionToken successfully rotated valid token");

  // ─── SUITE 5: In-Flight Grace Period & Token Reuse Attack Detection ───
  console.log("\n--- Suite 5: In-Flight Grace Period & Token Reuse Attack Detection ---");
  
  // Test 5A: Parallel in-flight request presenting the previous token within 30s grace period
  const parallelRequestToken = currentRefreshToken;
  const parallelNextToken = generateRefreshToken({ id: userId, sessionId: s4.sessionId });
  const gracePeriodResult = await rotateSessionToken(s4.sessionId, parallelRequestToken, parallelNextToken);

  assert(
    gracePeriodResult.success === true && gracePeriodResult.isGracePeriod === true,
    "In-flight request within 30s grace period succeeds without terminating session (grace period handled)",
  );

  // Test 5B: Attacker presents an older or unknown token -> Must trigger TOKEN_REUSE_DETECTED and revoke session
  const attackerOldToken = generateRefreshToken({ id: userId, sessionId: s4.sessionId }); // different unknown token
  const attackerNextToken = generateRefreshToken({ id: userId, sessionId: s4.sessionId });
  const attackResult = await rotateSessionToken(s4.sessionId, attackerOldToken, attackerNextToken);

  assert(
    attackResult.success === false && attackResult.error === "TOKEN_REUSE_DETECTED",
    "Server detects reuse of invalid/older token (TOKEN_REUSE_DETECTED)",
  );

  // Verify that the session was immediately destroyed as a result of the attack
  const compromisedSession = await validateSession(s4.sessionId);
  assert(
    compromisedSession === null,
    "Compromised session was immediately terminated on the server upon reuse attempt",
  );

  // ─── SUITE 6: Revoke All Sessions on Password Change ───
  console.log("\n--- Suite 6: Centralized Session Invalidation on Security Events ---");
  const revokedCount = await revokeAllUserSessions(userId);
  assert(revokedCount >= 2, `revokeAllUserSessions invalidated remaining active sessions. Count: ${revokedCount}`);

  const remainingSessions = await getUserActiveSessions(userId);
  assert(remainingSessions.length === 0, "User has 0 active sessions after revokeAllUserSessions");

  console.log("\n=======================================================");
  console.log("🎉 All Dual-Token and Session Validation Tests Passed!");
  console.log("=======================================================\n");

  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
