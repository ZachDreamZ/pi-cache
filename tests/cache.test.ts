import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CacheEngine } from "../src/cache.js";
import { computeKeyHash, canonicalStringify } from "../src/hash.js";
import { readPersistedCache } from "../src/persistence.js";
import {
  CacheGetParams,
  CacheSetParams,
  CacheInvalidateParams,
} from "../src/schemas.js";
import { Value } from "@sinclair/typebox/value";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync, writeFileSync } from "node:fs";

describe("pi-cache", () => {
  let engine: CacheEngine;

  beforeEach(() => {
    engine = new CacheEngine();
  });

  // ─── cache_get ───

  describe("cache_get", () => {
    it("returns miss for non-existent key", () => {
      const result = engine.get("default", "nonexistent");
      expect(result.hit).toBe(false);
      expect(result.namespace).toBe("default");
      expect(result.key).toBe("nonexistent");
    });

    it("returns hit with value after cache_set", () => {
      engine.set("default", { hello: "world" }, { explicitKey: "k1", ttlMs: 5000 });
      const result = engine.get("default", "k1");
      expect(result.hit).toBe(true);
      expect(result.value).toEqual({ hello: "world" });
      expect(result.createdAt).toBeDefined();
      expect(result.ageMs).toBeGreaterThanOrEqual(0);
      expect((result.ttlRemainingMs ?? 0) as number).toBeGreaterThan(0);
      expect(result.tags).toEqual([]);
    });
  });

  // ─── cache_set ───

  describe("cache_set", () => {
    it("stores value with TTL and returns correct metadata", () => {
      const result = engine.set("api", { data: 42 }, {
        explicitKey: "test-key",
        ttlMs: 10000,
        tags: ["data", "api"],
      });
      expect(result.key).toBe("test-key");
      expect(result.namespace).toBe("api");
      expect(result.ttlMs).toBe(10000);
      expect(result.tags).toEqual(["data", "api"]);
      expect(result.entryCount).toBe(1);
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it("generates deterministic key from input object", () => {
      const r1 = engine.set("ns", "val1", { input: { a: 1, b: 2 }, ttlMs: 5000 });
      const r2 = engine.set("ns", "val2", { input: { b: 2, a: 1 }, ttlMs: 5000 });
      expect(r1.key).toBe(r2.key);
    });
  });

  // ─── cache_invalidate ───

  describe("cache_invalidate", () => {
    it("invalidates by explicit key", () => {
      engine.set("default", "v", { explicitKey: "del-me", ttlMs: 5000 });
      engine.set("default", "v2", { explicitKey: "keep-me", ttlMs: 5000 });
      const result = engine.invalidate({ key: "del-me" });
      expect(result.invalidatedCount).toBe(1);
      expect(result.remainingEntries).toBe(1);
      expect(engine.get("default", "del-me").hit).toBe(false);
      expect(engine.get("default", "keep-me").hit).toBe(true);
    });

    it("invalidates by namespace", () => {
      engine.set("ns1", "v1", { explicitKey: "k1", ttlMs: 5000 });
      engine.set("ns1", "v2", { explicitKey: "k2", ttlMs: 5000 });
      engine.set("ns2", "v3", { explicitKey: "k3", ttlMs: 5000 });
      const result = engine.invalidate({ namespace: "ns1" });
      expect(result.invalidatedCount).toBe(2);
      expect(result.remainingEntries).toBe(1);
    });

    it("invalidates by tag", () => {
      engine.set("default", "v1", { explicitKey: "k1", ttlMs: 5000, tags: ["user"] });
      engine.set("default", "v2", { explicitKey: "k2", ttlMs: 5000, tags: ["admin"] });
      engine.set("default", "v3", { explicitKey: "k3", ttlMs: 5000, tags: ["user", "admin"] });
      const result = engine.invalidate({ tag: "user" });
      expect(result.invalidatedCount).toBe(2);
      expect(result.remainingEntries).toBe(1);
    });

    it("invalidates by glob pattern", () => {
      engine.set("default", "v1", { explicitKey: "user:123", ttlMs: 5000 });
      engine.set("default", "v2", { explicitKey: "user:456", ttlMs: 5000 });
      engine.set("default", "v3", { explicitKey: "admin:1", ttlMs: 5000 });
      const result = engine.invalidate({ pattern: "user:*" });
      expect(result.invalidatedCount).toBe(2);
      expect(result.remainingEntries).toBe(1);
    });

    it("sweeps expired entries with expiredOnly", () => {
      const now = Date.now();
      engine.set("default", "v", { explicitKey: "old", ttlMs: 0 });
      const result = engine.invalidate({ expiredOnly: true, now: now + 1 });
      expect(result.invalidatedCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Persistence ───

  describe("persistence", () => {
    const testFile = join(tmpdir(), `pi-cache-test-${Date.now()}.json`);

    afterEach(() => {
      try {
        if (existsSync(testFile)) unlinkSync(testFile);
      } catch {
        // ignore
      }
    });

    it("round-trips cache to/from JSON file", () => {
      engine.set("default", { data: "persisted" }, {
        explicitKey: "pk",
        ttlMs: 60000,
        tags: ["persist"],
      });
      engine.saveToFile(testFile);

      const engine2 = new CacheEngine();
      const loaded = engine2.loadFromFile(testFile);
      expect(loaded).toBe(1);
      const result = engine2.get("default", "pk");
      expect(result.hit).toBe(true);
      expect(result.value).toEqual({ data: "persisted" });
      expect(result.tags).toEqual(["persist"]);
    });

    it("returns null for non-existent file", () => {
      const result = readPersistedCache("/nonexistent/path/cache.json");
      expect(result).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      const badFile = join(tmpdir(), `pi-cache-bad-${Date.now()}.json`);
      writeFileSync(badFile, "not json!!!", "utf-8");
      try {
        const result = readPersistedCache(badFile);
        expect(result).toBeNull();
      } finally {
        unlinkSync(badFile);
      }
    });
  });

  // ─── Stale-while-revalidate ───

  describe("stale-while-revalidate", () => {
    it("returns stale entry within SWR window when allowStale=true", () => {
      const now = Date.now();
      engine.set("default", "swr-value", {
        explicitKey: "swr",
        ttlMs: 1000,
        staleWhileRevalidateMs: 5000,
      });

      const result = engine.get("default", "swr", undefined, true, now + 2000);
      expect(result.hit).toBe(true);
      expect(result.value).toBe("swr-value");
      expect(result.stale).toBe(true);
      expect(result.swrEligible).toBe(true);
    });

    it("returns miss when stale=true but allowStale=false", () => {
      const now = Date.now();
      engine.set("default", "swr2", {
        explicitKey: "swr2",
        ttlMs: 1000,
        staleWhileRevalidateMs: 5000,
      });

      const result = engine.get("default", "swr2", undefined, false, now + 2000);
      expect(result.hit).toBe(false);
      expect(result.stale).toBe(true);
      expect(result.swrEligible).toBe(true);
    });

    it("returns miss when fully expired beyond SWR window", () => {
      const now = Date.now();
      engine.set("default", "expired", {
        explicitKey: "exp",
        ttlMs: 1000,
        staleWhileRevalidateMs: 2000,
      });

      const result = engine.get("default", "exp", undefined, true, now + 5000);
      expect(result.hit).toBe(false);
    });
  });

  // ─── Size / maxEntries limits ───

  describe("maxEntries / size limits", () => {
    it("evicts oldest entries when maxEntries exceeded", () => {
      const smallEngine = new CacheEngine({ maxEntries: 2 });
      smallEngine.set("default", "v1", { explicitKey: "a", ttlMs: 60000 });
      smallEngine.set("default", "v2", { explicitKey: "b", ttlMs: 60000 });
      smallEngine.set("default", "v3", { explicitKey: "c", ttlMs: 60000 });
      expect(smallEngine.size).toBeLessThanOrEqual(2);
    });
  });

  // ─── JSON-serializable validation ───

  describe("JSON-serializable validation", () => {
    it("throws for non-serializable values", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(() => {
        engine.set("default", circular, { explicitKey: "bad" });
      }).toThrow("JSON-serializable");
    });
  });

  // ─── Deterministic hashing ───

  describe("deterministic canonical hashing", () => {
    it("produces same hash regardless of object key order", () => {
      const h1 = computeKeyHash("ns", { z: 1, a: 2, m: 3 });
      const h2 = computeKeyHash("ns", { a: 2, m: 3, z: 1 });
      expect(h1).toBe(h2);
    });

    it("produces different hash for different namespaces", () => {
      const h1 = computeKeyHash("ns1", { x: 1 });
      const h2 = computeKeyHash("ns2", { x: 1 });
      expect(h1).not.toBe(h2);
    });

    it("canonicalStringify is deterministic for nested objects", () => {
      const s1 = canonicalStringify({ b: { d: 4, c: 3 }, a: 1 });
      const s2 = canonicalStringify({ a: 1, b: { c: 3, d: 4 } });
      expect(s1).toBe(s2);
    });
  });

  // ─── Concurrent / sequential access ───

  describe("sequential access sanity", () => {
    it("handles rapid set/get cycles", () => {
      for (let i = 0; i < 100; i++) {
        engine.set("batch", `value-${i}`, {
          explicitKey: `key-${i}`,
          ttlMs: 60000,
        });
      }
      expect(engine.size).toBe(100);

      for (let i = 0; i < 100; i++) {
        const result = engine.get("batch", `key-${i}`);
        expect(result.hit).toBe(true);
        expect(result.value).toBe(`value-${i}`);
      }
    });

    it("overwrites existing key on re-set", () => {
      engine.set("default", "old", { explicitKey: "dup", ttlMs: 5000 });
      engine.set("default", "new", { explicitKey: "dup", ttlMs: 5000 });
      const result = engine.get("default", "dup");
      expect(result.hit).toBe(true);
      expect(result.value).toBe("new");
      expect(engine.size).toBe(1);
    });
  });

  // ─── TypeBox schema validation ───

  describe("TypeBox schema validation", () => {
    it("CacheGetParams validates correct input", () => {
      const valid = { namespace: "test", key: "mykey" };
      expect(Value.Check(CacheGetParams, valid)).toBe(true);
    });

    it("CacheSetParams requires value", () => {
      const valid = { namespace: "test", key: "k", value: { data: 1 } };
      expect(Value.Check(CacheSetParams, valid)).toBe(true);
    });

    it("CacheInvalidateParams accepts any combination of selectors", () => {
      const valid = { tag: "user", namespace: "api" };
      expect(Value.Check(CacheInvalidateParams, valid)).toBe(true);
    });
  });

  // ─── Standard pi.dev response shape ───

  describe("pi.dev response shape", () => {
    it("cache engine returns correct structure for get hit", () => {
      engine.set("default", "val", { explicitKey: "r1", ttlMs: 5000, tags: ["t"] });
      const result = engine.get("default", "r1");
      expect(result).toHaveProperty("hit");
      expect(result).toHaveProperty("namespace");
      expect(result).toHaveProperty("key");
      expect(result).toHaveProperty("value");
      expect(result).toHaveProperty("createdAt");
      expect(result).toHaveProperty("ageMs");
      expect(result).toHaveProperty("ttlRemainingMs");
      expect(result).toHaveProperty("stale");
      expect(result).toHaveProperty("swrEligible");
      expect(result).toHaveProperty("tags");
    });

    it("cache engine returns correct structure for set", () => {
      const result = engine.set("default", "v", { explicitKey: "r2", ttlMs: 1000 });
      expect(result).toHaveProperty("key");
      expect(result).toHaveProperty("namespace");
      expect(result).toHaveProperty("expiresAt");
      expect(result).toHaveProperty("ttlMs");
      expect(result).toHaveProperty("tags");
      expect(result).toHaveProperty("entryCount");
      expect(result).toHaveProperty("approximateBytes");
    });

    it("cache engine returns correct structure for invalidate", () => {
      engine.set("default", "v", { explicitKey: "r3", ttlMs: 1000 });
      const result = engine.invalidate({ key: "r3" });
      expect(result).toHaveProperty("invalidatedCount");
      expect(result).toHaveProperty("freedBytesEstimate");
      expect(result).toHaveProperty("remainingEntries");
      expect(result).toHaveProperty("matchedKeys");
    });
  });
});
