import { OCI_FREEBIES } from "./oci";
import {
  FreebieCategorySchema, FreebieFitTagSchema, FreebieLimitTypeSchema, FreebieVerificationSchema,
  type FreebieCategory, type FreebieEntry, type FreebieFitTag, type FreebieLimitType, type FreebieVerification,
} from "./schema";

export * from "./schema";

/** Add a provider by writing `<provider>.ts` next to `oci.ts` and appending it here. */
export const FREEBIES: readonly FreebieEntry[] = [...OCI_FREEBIES];

export interface FreebieFilter {
  search?: string;
  provider?: string;
  category?: FreebieCategory;
  limitType?: FreebieLimitType;
  /** true: only home-region-only entries. false: only entries usable in any region. */
  homeRegionOnly?: boolean;
  verification?: FreebieVerification;
  /** Entry must carry every listed tag. */
  fitTags?: readonly FreebieFitTag[];
}

function searchText(entry: FreebieEntry): string {
  return [
    entry.id, entry.provider, entry.providerName, entry.service, entry.category, entry.limit.note, String(entry.limit.value ?? ""), entry.limit.unit ?? "",
    ...entry.caveats.map(caveat => caveat.text), ...entry.suggestedUses, ...entry.fitTags,
  ].join(" ").toLowerCase();
}

/** Every whitespace-separated search term must appear somewhere in the entry. */
export function filterFreebies(entries: readonly FreebieEntry[], filter: FreebieFilter): FreebieEntry[] {
  const terms = (filter.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(entry => {
    if (filter.provider && entry.provider !== filter.provider) return false;
    if (filter.category && entry.category !== filter.category) return false;
    if (filter.limitType && entry.limit.type !== filter.limitType) return false;
    if (filter.homeRegionOnly !== undefined && entry.homeRegionOnly !== filter.homeRegionOnly) return false;
    if (filter.verification && entry.verification !== filter.verification) return false;
    if (filter.fitTags?.some(tag => !entry.fitTags.includes(tag))) return false;
    if (!terms.length) return true;
    const text = searchText(entry);
    return terms.every(term => text.includes(term));
  });
}

export interface FreebieFacets {
  providers: { id: string; name: string }[];
  categories: FreebieCategory[];
  limitTypes: FreebieLimitType[];
  verifications: FreebieVerification[];
  fitTags: FreebieFitTag[];
}

/** Options present in the data, in schema order, so the UI never offers a filter that matches nothing. */
export function freebieFacets(entries: readonly FreebieEntry[]): FreebieFacets {
  const providers = new Map<string, string>();
  for (const entry of entries) providers.set(entry.provider, entry.providerName);
  const present = <T extends string>(options: readonly T[], values: Iterable<T>) => {
    const seen = new Set(values);
    return options.filter(option => seen.has(option));
  };
  return {
    providers: [...providers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    categories: present(FreebieCategorySchema.options, entries.map(entry => entry.category)),
    limitTypes: present(FreebieLimitTypeSchema.options, entries.map(entry => entry.limit.type)),
    verifications: present(FreebieVerificationSchema.options, entries.map(entry => entry.verification)),
    fitTags: present(FreebieFitTagSchema.options, entries.flatMap(entry => entry.fitTags)),
  };
}

/** Parse filter values from URL search params; unknown values are dropped rather than trusted. */
export function parseFreebieFilter(params: URLSearchParams): FreebieFilter {
  const pick = <T extends string>(key: string, options: readonly T[]) => {
    const value = params.get(key);
    return value && (options as readonly string[]).includes(value) ? value as T : undefined;
  };
  const region = params.get("homeRegionOnly");
  const provider = params.get("provider");
  const fitTags = params.getAll("fit").filter((tag): tag is FreebieFitTag => (FreebieFitTagSchema.options as readonly string[]).includes(tag));
  return {
    search: (params.get("q") ?? "").slice(0, 256) || undefined,
    provider: provider && FREEBIES.some(entry => entry.provider === provider) ? provider : undefined,
    category: pick("category", FreebieCategorySchema.options),
    limitType: pick("limit", FreebieLimitTypeSchema.options),
    homeRegionOnly: region === "true" ? true : region === "false" ? false : undefined,
    verification: pick("verification", FreebieVerificationSchema.options),
    fitTags: fitTags.length ? fitTags : undefined,
  };
}

/** Inverse of parseFreebieFilter, for shareable URLs. */
export function freebieFilterToParams(filter: FreebieFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.search) params.set("q", filter.search);
  if (filter.provider) params.set("provider", filter.provider);
  if (filter.category) params.set("category", filter.category);
  if (filter.limitType) params.set("limit", filter.limitType);
  if (filter.homeRegionOnly !== undefined) params.set("homeRegionOnly", String(filter.homeRegionOnly));
  if (filter.verification) params.set("verification", filter.verification);
  for (const tag of filter.fitTags ?? []) params.append("fit", tag);
  return params;
}
