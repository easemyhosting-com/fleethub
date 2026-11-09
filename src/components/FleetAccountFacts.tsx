import { CollectionDiagnostics } from "./CollectionDiagnostics";
import { accountDiagnostics } from "@/lib/connectors/diagnostics";
import type { FleetAccount } from "@/lib/inventory/model";

const time = (value: string | null) => value ? new Date(value).toLocaleString() : "Never";

export function FleetAccountFacts({ account }: { account: FleetAccount }) {
  return <div className="space-y-2 text-xs [overflow-wrap:anywhere]">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="text-zinc-400">Owner</dt><dd className="text-zinc-200">{account.ownerEmail}</dd>
      <dt className="text-zinc-400">Plan</dt><dd className="text-zinc-200">{account.plan ?? "unknown"}</dd>
      <dt className="text-zinc-400">Health</dt><dd className="text-zinc-200">{account.health}</dd>
      <dt className="text-zinc-400">Collection</dt><dd className="text-zinc-200">{account.archived ? "archived" : account.collection.state.replaceAll("_", " ")}</dd>
      <dt className="text-zinc-400">Last success</dt><dd className="text-zinc-200">{time(account.collection.lastSuccessAt)}</dd>
      <dt className="text-zinc-400">Last attempt</dt><dd className="text-zinc-200">{time(account.collection.lastAttemptAt)}</dd>
    </dl>
    <p className="text-zinc-400">{account.collection.resourceCount} collected resources</p>
    {account.collection.message && <p className={account.collection.errorCode ? "text-amber-300" : "text-zinc-300"}>{account.collection.message}</p>}
    {account.collection.errorCode && <p className="text-rose-300">{account.collection.errorCode.replaceAll("_", " ")}</p>}
    <CollectionDiagnostics items={accountDiagnostics(account.collection)} />
  </div>;
}
