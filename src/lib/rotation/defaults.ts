import { registerRotator, getRotator } from "./registry";
import { cloudflareRotator } from "./cloudflare";

/** Built-in rotators. Add new providers here. */
for (const rotator of [cloudflareRotator]) if (!getRotator(rotator.providerId)) registerRotator(rotator);
