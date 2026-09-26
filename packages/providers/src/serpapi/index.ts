import type { ProviderModule } from "../types.js";
import { descriptor } from "./descriptor.js";
import { extractors } from "./extractors.js";
/** Provider B: no per-call cost, monthly plan, query auth. See docs/PROVIDERS.md section 5. */
export const serpapi: ProviderModule = { descriptor, extractors };
