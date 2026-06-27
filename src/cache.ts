import { LRUCache } from "lru-cache";
import { computeKeyHash } from "./hash.js";
import {
  readPersistedCache,
  writePersistedCache,
  type PersistedCache,
} from "./persistence.js";

export interface CacheEntry {
  value: unknown;
  createdAt: number;
  ttlMs: number;
  staleWhileRevalidateMs: number;
  tags: string[];
  namespace: string;
  key: string;
}

export interface CacheGetResult {
  hit: boolean;
  value?: unknown;
  createdAt?: number;
  ageMs?: number;
  ttlRemainingMs?: number;
  stale?: boolean;
  swrEligible?: boolean;
  tags?: string[];
  namespace: string;
  key: string;
}

export interface CacheSetResult {
  key: string;
  namespace: string;
  expiresAt: number | null;
  ttlMs: number;
  tags: string[];
  entryCount: number;
  approximateBytes: number;
}

export interface CacheInvalidateResult {
  invalidatedCount: number;
  freedBytesEstimate: number;
  remainingEntries: number;
  matchedKeys: string[];
}

// ─── Helper: check if value is JSON-serializable ───

function isJsonSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function estimateBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 0;
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

// ─── Cache Engine ───

export class CacheEngine {
  private lru: LRUCache<string, CacheEntry>;
  private tagIndex = new Map<string, Set<string>>();
  private totalApproxBytes = 0;

  constructor(options?: { maxEntries?: number; maxSizeBytes?: number }) {
    const lruOpts: LRUCache.Options<string, CacheEntry, unknown> = {
      max: options?.maxEntries ?? 1000,
      ttl: 0,
      allowStale: true,
    };
    if (options?.maxSizeBytes) {
      lruOpts.maxSize = options.maxSizeBytes;
      lruOpts.sizeCalculation = (entry) => estimateBytes(entry.value);
    }
    this.lru = new LRUCache(lruOpts);
  }

  resolveKey(namespace: string, explicitKey?: string, input?: unknown): string {
    if (explicitKey !== undefined) return `${namespace}:${explicitKey}`;
    if (input !== undefined) return `${namespace}:${computeKeyHash(namespace, input)}`;
    throw new Error("Either 'key' or 'input' must be provided");
  }

  get(
    namespace: string,
    explicitKey?: string,
    input?: unknown,
    allowStale = false,
    now?: number,
  ): CacheGetResult {
    const compositeKey = this.resolveKey(namespace, explicitKey, input);
    const displayKey = explicitKey ?? (input !== undefined ? computeKeyHash(namespace, input) : "");
    const currentTime = now ?? Date.now();

    const entry = this.lru.get(compositeKey, { allowStale: true });
    if (!entry) return { hit: false, namespace, key: displayKey };

    const ageMs = currentTime - entry.createdAt;
    const ttlRemainingMs = Math.max(0, entry.ttlMs - ageMs);
    const expired = ageMs >= entry.ttlMs;
    const swrWindow = entry.staleWhileRevalidateMs;
    const withinSwr = expired && swrWindow > 0 && ageMs < entry.ttlMs + swrWindow;
    const stale = expired;

    if (expired && !withinSwr) {
      this.lru.delete(compositeKey);
      this.removeFromTagIndex(compositeKey);
      return { hit: false, namespace, key: displayKey };
    }

    if (stale && !allowStale) {
      return { hit: false, namespace, key: displayKey, stale: true, swrEligible: withinSwr };
    }

    return {
      hit: true,
      value: entry.value,
      createdAt: entry.createdAt,
      ageMs,
      ttlRemainingMs: stale ? 0 : ttlRemainingMs,
      stale,
      swrEligible: withinSwr,
      tags: entry.tags,
      namespace: entry.namespace,
      key: displayKey,
    };
  }

  set(
    namespace: string,
    value: unknown,
    options?: {
      explicitKey?: string;
      input?: unknown;
      ttlMs?: number;
      staleWhileRevalidateMs?: number;
      tags?: string[];
      maxEntries?: number;
      maxSizeBytes?: number;
    },
  ): CacheSetResult {
    if (!isJsonSerializable(value)) throw new Error("Value must be JSON-serializable");

    const compositeKey = this.resolveKey(namespace, options?.explicitKey, options?.input);
    const displayKey = options?.explicitKey ?? (options?.input !== undefined ? computeKeyHash(namespace, options.input) : "");
    const ttlMs = options?.ttlMs ?? 60000;
    const swrMs = options?.staleWhileRevalidateMs ?? 0;
    const tags = options?.tags ?? [];

    this.removeFromTagIndex(compositeKey);

    const entry: CacheEntry = {
      value,
      createdAt: Date.now(),
      ttlMs,
      staleWhileRevalidateMs: swrMs,
      tags,
      namespace,
      key: displayKey,
    };

    const oldSize = this.estimateEntrySize(this.lru.get(compositeKey));
    this.lru.set(compositeKey, entry, { ttl: ttlMs + swrMs });
    const newSize = estimateBytes(value);
    this.totalApproxBytes = this.totalApproxBytes - oldSize + newSize;

    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag)!.add(compositeKey);
    }

    const expiresAt = ttlMs > 0 ? entry.createdAt + ttlMs : null;

    return { key: displayKey, namespace, expiresAt, ttlMs, tags, entryCount: this.lru.size, approximateBytes: this.totalApproxBytes };
  }

  invalidate(options?: {
    key?: string;
    namespace?: string;
    tag?: string;
    pattern?: string;
    expiredOnly?: boolean;
    now?: number;
  }): CacheInvalidateResult {
    const currentTime = options?.now ?? Date.now();
    let matchedKeys: string[] = [];
    const deletedCompositeKeys = new Set<string>();

    if (options?.key !== undefined) {
      const ns = options?.namespace ?? "default";
      const composite = this.resolveKey(ns, options.key);
      if (this.lru.has(composite)) {
        matchedKeys.push(options.key);
        deletedCompositeKeys.add(composite);
      }
    }

    if (options?.namespace !== undefined && options?.key === undefined) {
      const entries = Array.from(this.lru.entries());
      for (const [composite, entry] of entries) {
        if (entry.namespace === options.namespace) {
          matchedKeys.push(entry.key);
          deletedCompositeKeys.add(composite);
        }
      }
    }

    if (options?.tag !== undefined) {
      const tagKeys = this.tagIndex.get(options.tag) ?? new Set();
      const keys = Array.from(tagKeys);
      for (const composite of keys) {
        const entry = this.lru.get(composite, { allowStale: true });
        if (entry) {
          matchedKeys.push(entry.key);
          deletedCompositeKeys.add(composite);
        }
      }
    }

    if (options?.pattern !== undefined) {
      const regex = globToRegex(options.pattern);
      const entries = Array.from(this.lru.entries());
      for (const [composite, entry] of entries) {
        if (regex.test(entry.key) || regex.test(composite)) {
          matchedKeys.push(entry.key);
          deletedCompositeKeys.add(composite);
        }
      }
    }

    if (options?.expiredOnly && options?.key === undefined && options?.namespace === undefined && options?.tag === undefined && options?.pattern === undefined) {
      const entries = Array.from(this.lru.entries());
      for (const [composite, entry] of entries) {
        const ageMs = currentTime - entry.createdAt;
        if (ageMs >= entry.ttlMs + entry.staleWhileRevalidateMs) {
          matchedKeys.push(entry.key);
          deletedCompositeKeys.add(composite);
        }
      }
    }

    if (matchedKeys.length > 200) matchedKeys = matchedKeys.slice(0, 200);

    let freedBytes = 0;
    const deleted = Array.from(deletedCompositeKeys);
    for (const composite of deleted) {
      const entry = this.lru.get(composite, { allowStale: true });
      if (entry) {
        freedBytes += estimateBytes(entry.value);
        this.totalApproxBytes -= estimateBytes(entry.value);
        this.lru.delete(composite);
        this.removeFromTagIndex(composite);
      }
    }
    if (this.totalApproxBytes < 0) this.totalApproxBytes = 0;

    return { invalidatedCount: deletedCompositeKeys.size, freedBytesEstimate: freedBytes, remainingEntries: this.lru.size, matchedKeys };
  }

  loadFromFile(filePath: string): number {
    const data = readPersistedCache(filePath);
    if (!data) return 0;

    let loaded = 0;
    for (const entry of data.entries) {
      const composite = `${entry.namespace}:${entry.key}`;
      const cacheEntry: CacheEntry = {
        value: entry.value,
        createdAt: entry.createdAt,
        ttlMs: entry.ttlMs,
        staleWhileRevalidateMs: entry.staleWhileRevalidateMs,
        tags: entry.tags,
        namespace: entry.namespace,
        key: entry.key,
      };
      this.lru.set(composite, cacheEntry, { ttl: entry.ttlMs + entry.staleWhileRevalidateMs });
      for (const tag of entry.tags) {
        if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
        this.tagIndex.get(tag)!.add(composite);
      }
      loaded++;
    }
    this.recalcBytes();
    return loaded;
  }

  saveToFile(filePath: string): void {
    const entries: PersistedCache["entries"] = [];
    const allEntries = Array.from(this.lru.entries());
    for (const [, entry] of allEntries) {
      entries.push({
        key: entry.key,
        namespace: entry.namespace,
        value: entry.value,
        createdAt: entry.createdAt,
        ttlMs: entry.ttlMs,
        staleWhileRevalidateMs: entry.staleWhileRevalidateMs,
        tags: entry.tags,
      });
    }
    writePersistedCache(filePath, { version: 1, entries });
  }

  get size(): number {
    return this.lru.size;
  }

  get approxBytes(): number {
    return this.totalApproxBytes;
  }

  private estimateEntrySize(entry: CacheEntry | undefined): number {
    if (!entry) return 0;
    return estimateBytes(entry.value);
  }

  private removeFromTagIndex(compositeKey: string): void {
    const tagEntries = Array.from(this.tagIndex.entries());
    for (const [, keys] of tagEntries) {
      keys.delete(compositeKey);
    }
  }

  private recalcBytes(): void {
    this.totalApproxBytes = 0;
    const entries = Array.from(this.lru.entries());
    for (const [, entry] of entries) {
      this.totalApproxBytes += estimateBytes(entry.value);
    }
  }
}
