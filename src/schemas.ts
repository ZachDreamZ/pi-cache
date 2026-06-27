import { Type, type Static } from "@sinclair/typebox";

// ─── cache_get schemas ───

export const CacheGetParams = Type.Object({
  namespace: Type.String({
    description: "Cache namespace for isolation",
    default: "default",
  }),
  key: Type.Optional(
    Type.String({
      description: "Explicit cache key (mutually exclusive with input)",
    }),
  ),
  input: Type.Optional(
    Type.Unknown({
      description:
        "Object to hash for deterministic key generation (mutually exclusive with key)",
    }),
  ),
  allowStale: Type.Optional(
    Type.Boolean({
      description: "Return stale entries within SWR window",
      default: false,
    }),
  ),
  now: Type.Optional(
    Type.Number({
      description: "Override current time in ms (for testing)",
    }),
  ),
  persistencePath: Type.Optional(
    Type.String({
      description: "Path to JSON persistence file",
    }),
  ),
});
export type CacheGetParamsType = Static<typeof CacheGetParams>;

// ─── cache_set schemas ───

export const CacheSetParams = Type.Object({
  namespace: Type.String({
    description: "Cache namespace for isolation",
    default: "default",
  }),
  key: Type.Optional(
    Type.String({
      description: "Explicit cache key (mutually exclusive with input)",
    }),
  ),
  input: Type.Optional(
    Type.Unknown({
      description:
        "Object to hash for deterministic key generation (mutually exclusive with key)",
    }),
  ),
  value: Type.Unknown({
    description: "JSON-serializable value to cache",
  }),
  ttlMs: Type.Optional(
    Type.Number({
      description: "Time-to-live in milliseconds",
      default: 60000,
    }),
  ),
  staleWhileRevalidateMs: Type.Optional(
    Type.Number({
      description:
        "SWR window: expired entries eligible as stale for this many ms after TTL",
      default: 0,
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: "Tags for group invalidation",
      default: [],
    }),
  ),
  maxEntries: Type.Optional(
    Type.Number({
      description: "Max entries in this namespace (LRU eviction)",
    }),
  ),
  maxSizeBytes: Type.Optional(
    Type.Number({
      description: "Max approximate size in bytes (LRU eviction)",
    }),
  ),
  persistencePath: Type.Optional(
    Type.String({
      description: "Path to JSON persistence file",
    }),
  ),
});
export type CacheSetParamsType = Static<typeof CacheSetParams>;

// ─── cache_invalidate schemas ───

export const CacheInvalidateParams = Type.Object({
  key: Type.Optional(
    Type.String({
      description: "Exact cache key to invalidate",
    }),
  ),
  namespace: Type.Optional(
    Type.String({
      description: "Invalidate all entries in this namespace",
    }),
  ),
  tag: Type.Optional(
    Type.String({
      description: "Invalidate all entries with this tag",
    }),
  ),
  pattern: Type.Optional(
    Type.String({
      description: "Glob pattern to match keys (e.g. 'user:*')",
    }),
  ),
  expiredOnly: Type.Optional(
    Type.Boolean({
      description:
        "Only invalidate entries whose TTL has expired (sweep mode)",
      default: false,
    }),
  ),
  now: Type.Optional(
    Type.Number({
      description: "Override current time in ms (for testing)",
    }),
  ),
  persistencePath: Type.Optional(
    Type.String({
      description: "Path to JSON persistence file",
    }),
  ),
});
export type CacheInvalidateParamsType = Static<typeof CacheInvalidateParams>;
