import { hostKey } from "@/lib/capacity/addresses";

export class InvalidConnectorHost extends Error {}
/** Host spelling may vary, but a normalized key must name exactly one current compute resource. */
export function resolveConnectorHost(name: string, known: Array<{ name: string }>): string {
  const matches = known.filter(host => hostKey(host.name) === hostKey(name));
  if (matches.length === 1) return matches[0].name;
  throw new InvalidConnectorHost(matches.length ? "That host name matches multiple compute resources. Give those resources distinct names before connecting." : "Choose an existing compute resource as the host. Add or scan the provider account first if it is missing.");
}
