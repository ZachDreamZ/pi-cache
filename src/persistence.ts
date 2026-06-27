import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export interface PersistedCache {
  version: 1;
  entries: Array<{
    key: string;
    namespace: string;
    value: unknown;
    createdAt: number;
    ttlMs: number;
    staleWhileRevalidateMs: number;
    tags: string[];
  }>;
}

/**
 * Read a persisted cache file. Returns null if file doesn't exist or is invalid.
 */
export function readPersistedCache(filePath: string): PersistedCache | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as PersistedCache;
    if (data.version !== 1 || !Array.isArray(data.entries)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Write a cache to disk atomically (write to temp + rename).
 */
export function writePersistedCache(
  filePath: string,
  cache: PersistedCache,
): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
  try {
    renameSync(tmp, filePath);
  } catch {
    // Fallback: direct write
    writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf-8");
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
  }
}
