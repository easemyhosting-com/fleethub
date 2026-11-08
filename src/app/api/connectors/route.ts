import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { checkUrl, ConnectorError, connectorConfig } from "@/lib/connectors/clients";
import { createConnector, deleteConnector, listConnectorHosts, listConnectors, SecretStoreNotReady } from "@/lib/connectors/service";
import { revokeRescanKey, rotateRescanKey, setScanInterval, UnknownConnectorId } from "@/lib/connectors/schedule";
import { InvalidConnectorHost } from "@/lib/connectors/hosts";
import { scanIntervalChoices } from "@/lib/connectors/schedule-rules";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ error: "Connector storage unavailable" }, { status: 503, headers });
const connectorId = z.string().regex(/^conn-[0-9a-f-]{36}$/);
const update = z.strictObject({
  id: connectorId,
  scanIntervalMinutes: z.union([z.literal(null), ...scanIntervalChoices.map(value => z.literal(value))]).optional(),
  rescanKey: z.enum(["rotate", "revoke"]).optional(),
}).refine(value => value.scanIntervalMinutes !== undefined || value.rescanKey !== undefined);
const create = connectorConfig.and(z.object({ secret: z.string().min(1).max(8192).optional() }));

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  try { if (!(await bootstrapDatabase()).success) return unavailable(); const [connectors, hosts] = await Promise.all([listConnectors(), listConnectorHosts().catch(() => [])]); return NextResponse.json({ connectors, hosts }, { headers }); } catch { return unavailable(); }
}

/** Operator-only. The credential goes to the encrypted secret store and is never returned. Use a read-only token. */
export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can add connectors." }, { status: 403, headers });
  const raw = await readJsonWithLimit<unknown>(req, 40 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const parsed = create.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide kind (kubernetes, docker, prometheus), label, hostName, url, and a read-only token. Plain http needs allowHttp." }, { status: 400, headers });
  const { secret, ...config } = parsed.data as z.infer<typeof connectorConfig> & { secret?: string };
  try { checkUrl(config.url, config.allowHttp); } catch (error) { if (error instanceof ConnectorError) return NextResponse.json({ error: "URL must be https (or http with allowHttp) without credentials" }, { status: 400, headers }); }
  if (config.kind === "kubernetes" && !secret) return NextResponse.json({ error: "A Kubernetes connector needs a read-only service account token" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return NextResponse.json(await createConnector(config, secret, auth.user?.email ?? auth.principalId ?? "api:admin"), { status: 201, headers });
  } catch (error) {
    if (error instanceof InvalidConnectorHost) return NextResponse.json({ error: error.message }, { status: 400, headers });
    if (error instanceof SecretStoreNotReady) return NextResponse.json({ error: "Verify a secret store (Infisical or the built-in store) in setup first" }, { status: 409, headers });
    return unavailable();
  }
}

export async function DELETE(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can remove connectors." }, { status: 403, headers });
  const id = connectorId.safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "Invalid connector id" }, { status: 400, headers });
  try { if (!(await bootstrapDatabase()).success) return unavailable(); return (await deleteConnector(id.data)) ? NextResponse.json({ removed: true }, { headers }) : NextResponse.json({ error: "Not found" }, { status: 404, headers }); } catch { return unavailable(); }
}

/** Operator-only. Sets the automatic scan interval (null returns to the kind's default) or replaces/revokes the rescan webhook key, which is returned once. */
export async function PATCH(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can change connectors." }, { status: 403, headers });
  const raw = await readJsonWithLimit<unknown>(req, 4 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const parsed = update.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: `Provide id plus scanIntervalMinutes (${scanIntervalChoices.join(", ")} or null) and/or rescanKey (rotate, revoke).` }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    if (parsed.data.scanIntervalMinutes !== undefined) await setScanInterval(parsed.data.id, parsed.data.scanIntervalMinutes);
    if (parsed.data.rescanKey === "revoke") await revokeRescanKey(parsed.data.id);
    const rescanKey = parsed.data.rescanKey === "rotate" ? await rotateRescanKey(parsed.data.id) : undefined;
    return NextResponse.json({ updated: true, ...(rescanKey ? { rescanKey } : {}) }, { headers });
  } catch (error) {
    if (error instanceof UnknownConnectorId) return NextResponse.json({ error: "Not found" }, { status: 404, headers });
    return unavailable();
  }
}
