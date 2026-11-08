import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { observationInput, recordObservation, listObservations, ReportConflict, UnknownResource } from "../src/lib/observations/report";
describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("observation PostgreSQL storage", () => {
 beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
  expect((await bootstrapDatabase()).success).toBe(true);
  await queryClient`INSERT INTO resources (id,name,category,provider,account_email,is_protected) VALUES ('observation-fixture','Fixture','compute','oracle','fixture.invalid',true)`;
 });
 afterAll(async () => { await queryClient`DELETE FROM resources WHERE id='observation-fixture'`; await queryClient.end(); });
 it("atomically deduplicates concurrent reports without altering protected inventory", async () => {
  const input = observationInput.parse({ resourceId: "observation-fixture", source: "external_agent", observedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+3600000).toISOString(), facts: { resourceState: "offline" } });
  const results = await Promise.all(Array.from({length: 8}, () => recordObservation(input, "fixture-reporter", "same-key")));
  expect(results.filter(result => !result.duplicate)).toHaveLength(1); expect(new Set(results.map(result => result.id)).size).toBe(1);
  await expect(recordObservation({ ...input, facts: { resourceState: "online" } }, "fixture-reporter", "same-key")).rejects.toBeInstanceOf(ReportConflict);
  await expect(recordObservation({ ...input, resourceId: "absent-fixture" }, "fixture-reporter", "absent-key")).rejects.toBeInstanceOf(UnknownResource);
  const history = await listObservations("observation-fixture"); expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ freshness: "current", authoritative: false, facts: { resourceState: "offline" } });
  const [resource] = await queryClient`SELECT state,is_protected FROM resources WHERE id='observation-fixture'`;
  expect(resource).toEqual({state: "online", is_protected: true});
 });
});
