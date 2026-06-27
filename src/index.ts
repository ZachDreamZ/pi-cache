import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTools } from "./tools.js";

export { CacheEngine } from "./cache.js";
export { computeKeyHash, canonicalStringify } from "./hash.js";
export {
  CacheGetParams,
  CacheSetParams,
  CacheInvalidateParams,
} from "./schemas.js";
export {
  readPersistedCache,
  writePersistedCache,
} from "./persistence.js";
export type {
  CacheGetResult,
  CacheSetResult,
  CacheInvalidateResult,
  CacheEntry,
} from "./cache.js";

/**
 * pi-cache extension entry point.
 * Registers cache_get, cache_set, and cache_invalidate tools.
 */
export default function register(pi: ExtensionAPI): void {
  registerTools(pi);
}
