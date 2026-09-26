import type { ProviderModule } from "../types.js";
import { descriptor } from "./descriptor.js";
import { extractors } from "./extractors.js";
/** Provider A: per-call cost, prepaid balance, basic auth. See docs/PROVIDERS.md section 5. */
export const dataforseo: ProviderModule = { descriptor, extractors };
export { priceKeys } from "./extractors.js";
