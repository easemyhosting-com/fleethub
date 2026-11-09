import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { cancelPairing, checkSession, createPairing, createServerSession, listPairings, listSessions, maxActiveSessions, maxPendingPairings, pairingInput, PairingLimitReached, redeemPairing, revokeOtherSessions, revokeSession, SessionLimitReached } from "../src/lib/auth/sessions";
const user = { id: "usr-fixture", email: "fixture@example.test", name: "Fixture", provider: "local" as const, createdAt: Date.now() };
const otherUser = { ...user, id: "usr-other", email: "other@example.test" };
describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("session and pairing PostgreSQL storage", () => {
 beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
  expect((await bootstrapDatabase()).success).toBe(true);
 });
 const clean = async () => { await queryClient`DELETE FROM auth_sessions`; await queryClient`DELETE FROM device_pairings`; };
 afterAll(async () => { await clean(); await queryClient.end(); });
 it("creates, checks, expires and revokes sessions with immediate effect", async () => {
  await clean();
  const sid = await createServerSession(user, "device", "read", "Phone");
  const otherSid = await createServerSession(otherUser, "browser", "operator", "Other user");
  expect((await listSessions(user.id)).map(item => item.id)).toEqual([sid]);
  expect(await revokeSession(otherSid, user.id)).toBe(false);
  expect(await checkSession(sid)).toEqual({ status: "active", scope: "read" });
  const [row] = await queryClient`SELECT * FROM auth_sessions WHERE id = ${sid}`; expect(row.last_seen_at).not.toBeNull();
  await checkSession(sid); const [again] = await queryClient`SELECT last_seen_at FROM auth_sessions WHERE id = ${sid}`; expect(again.last_seen_at).toEqual(row.last_seen_at);
  expect((await listSessions()).find(item => item.id === sid)).toMatchObject({ kind: "device", scope: "read", status: "active" });
  expect(await revokeSession(sid)).toBe(true); expect(await checkSession(sid)).toEqual({ status: "inactive" });
  const second = await createServerSession(user, "browser", "operator", "Chrome"); const third = await createServerSession(user, "browser", "operator", "Safari");
  await queryClient`UPDATE auth_sessions SET expires_at = NOW() - interval '1 second' WHERE id = ${second}`; expect(await checkSession(second)).toEqual({ status: "inactive" });
  expect(await revokeOtherSessions(third)).toBe(0); const fourth = await createServerSession(user, "browser", "operator", "Firefox");
  expect(await revokeOtherSessions(third)).toBe(1); expect(await checkSession(fourth)).toEqual({ status: "inactive" }); expect(await checkSession(third)).toMatchObject({ status: "active" });
  expect(await checkSession(otherSid)).toEqual({ status: "active", scope: "operator" });
  expect(await checkSession("ses-missing")).toEqual({ status: "inactive" });
 });
 it("enforces the active session cap under concurrent sign-ins", async () => {
  await clean();
  const results = await Promise.allSettled(Array.from({ length: maxActiveSessions + 5 }, (_, index) => createServerSession(user, "browser", "operator", `b${index}`)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(maxActiveSessions);
  const otherSid = await createServerSession(otherUser, "browser", "operator", "Other user");
  expect(await checkSession(otherSid)).toEqual({ status: "active", scope: "operator" });
  for (const result of results.filter(result => result.status === "rejected")) expect((result as PromiseRejectedResult).reason).toBeInstanceOf(SessionLimitReached);
 });
 it("redeems a pairing code exactly once, even when attempted concurrently, with the granted scope", async () => {
  await clean();
  const pairing = await createPairing(pairingInput.parse({ label: "iPhone", scope: "read" }), user);
  const [stored] = await queryClient`SELECT * FROM device_pairings WHERE id = ${pairing.id}`; expect(JSON.stringify(stored)).not.toContain(pairing.code.replaceAll("-", ""));
  const results = await Promise.all(Array.from({ length: 8 }, () => redeemPairing(pairing.code.toLowerCase(), "My iPhone")));
  const winners = results.filter(result => result !== null); expect(winners).toHaveLength(1);
  expect(winners[0]).toMatchObject({ scope: "read", label: "My iPhone", user: { email: user.email } });
  expect(await checkSession(winners[0]!.sid)).toEqual({ status: "active", scope: "read" });
  expect(await redeemPairing(pairing.code)).toBeNull(); expect((await listPairings()).find(item => item.id === pairing.id)?.status).toBe("used");
 });
 it("rejects expired, cancelled and unknown codes, and caps pending codes", async () => {
  await clean();
  const expired = await createPairing(pairingInput.parse({ label: "old" }), user); await queryClient`UPDATE device_pairings SET expires_at = NOW() - interval '1 second' WHERE id = ${expired.id}`;
  expect(await redeemPairing(expired.code)).toBeNull();
  const cancelled = await createPairing(pairingInput.parse({ label: "cancel" }), user); expect(await cancelPairing(cancelled.id)).toBe(true); expect(await cancelPairing(cancelled.id)).toBe(false);
  expect(await redeemPairing(cancelled.code)).toBeNull(); expect(await redeemPairing("AAAA-BBBB-CCCC")).toBeNull();
  await clean();
  const results = await Promise.allSettled(Array.from({ length: maxPendingPairings + 3 }, (_, index) => createPairing(pairingInput.parse({ label: `p${index}` }), user)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(maxPendingPairings);
  for (const result of results.filter(result => result.status === "rejected")) expect((result as PromiseRejectedResult).reason).toBeInstanceOf(PairingLimitReached);
 });
 it("cancels pending codes when the session that created them is revoked", async () => {
  await clean();
  const creatorSid = await createServerSession(user, "browser", "operator", "Creator");
  const otherSid = await createServerSession(user, "browser", "operator", "Other");
  const creator = { ...user, sid: creatorSid };
  const revokedByLogout = await createPairing(pairingInput.parse({ label: "lost" }), creator);
  const consumed = await createPairing(pairingInput.parse({ label: "used" }), creator); expect(await redeemPairing(consumed.code)).not.toBeNull();
  const fromOther = await createPairing(pairingInput.parse({ label: "other" }), { ...user, sid: otherSid });
  const legacy = await createPairing(pairingInput.parse({ label: "legacy" }), user);
  const [stored] = await queryClient`SELECT created_by_session FROM device_pairings WHERE id = ${revokedByLogout.id}`; expect(stored.created_by_session).toBe(creatorSid);
  expect(await revokeSession(creatorSid)).toBe(true);
  const status = async (id: string) => (await listPairings()).find(item => item.id === id)?.status;
  expect(await status(revokedByLogout.id)).toBe("cancelled"); expect(await status(consumed.id)).toBe("used");
  expect(await status(fromOther.id)).toBe("pending"); expect(await status(legacy.id)).toBe("pending");
  expect(await redeemPairing(revokedByLogout.code)).toBeNull();
  const keepSid = await createServerSession(user, "browser", "operator", "Keep");
  const keptCode = await createPairing(pairingInput.parse({ label: "kept" }), { ...user, sid: keepSid });
  expect(await revokeOtherSessions(keepSid)).toBeGreaterThanOrEqual(1);
  expect(await status(fromOther.id)).toBe("cancelled"); expect(await status(keptCode.id)).toBe("pending");
  expect(await redeemPairing(fromOther.code)).toBeNull(); expect(await redeemPairing(legacy.code)).not.toBeNull();
 });
 it("still revokes on an upgraded install before the bootstrap has added created_by_session", async () => {
  await clean();
  const [first, second, keep] = await Promise.all(["One", "Two", "Keep"].map(label => createServerSession(user, "browser", "operator", label)));
  await queryClient`ALTER TABLE device_pairings DROP COLUMN created_by_session`;
  try {
   expect(await revokeSession(first)).toBe(true); expect(await checkSession(first)).toEqual({ status: "inactive" });
   expect(await revokeOtherSessions(keep)).toBe(1); expect(await checkSession(second)).toEqual({ status: "inactive" }); expect(await checkSession(keep)).toMatchObject({ status: "active" });
  } finally {
   expect((await bootstrapDatabase()).success).toBe(true);
  }
  const [column] = await queryClient`SELECT 1 AS present FROM information_schema.columns WHERE table_name = 'device_pairings' AND column_name = 'created_by_session'`; expect(column?.present).toBe(1);
 });
 it("refuses a code whose creating session was revoked or expired without going through revokeSession", async () => {
  await clean();
  const creatorSid = await createServerSession(user, "browser", "operator", "Creator");
  const pairing = await createPairing(pairingInput.parse({ label: "race" }), { ...user, sid: creatorSid });
  await queryClient`UPDATE auth_sessions SET expires_at = NOW() - interval '1 second' WHERE id = ${creatorSid}`;
  expect(await redeemPairing(pairing.code)).toBeNull();
  await queryClient`UPDATE auth_sessions SET expires_at = NOW() + interval '1 day' WHERE id = ${creatorSid}`;
  expect(await redeemPairing(pairing.code)).not.toBeNull();
 });
 it("does not burn a code when session creation fails", async () => {
  await clean();
  const pairing = await createPairing(pairingInput.parse({ label: "retry" }), user);
  await Promise.all(Array.from({ length: maxActiveSessions }, (_, index) => createServerSession(user, "browser", "operator", `s${index}`).catch(() => null)));
  await expect(redeemPairing(pairing.code)).rejects.toBeInstanceOf(SessionLimitReached);
  expect((await listPairings()).find(item => item.id === pairing.id)?.status).toBe("pending");
 });
});
