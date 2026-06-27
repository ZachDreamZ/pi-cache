# @realvendex/pi-cache

> Pi-native runtime cache and memoization toolkit for pi.dev extension tools.

## Installation

```bash
pi install npm:@realvendex/pi-cache
```

## What It Does

`pi-cache` provides deterministic cache keys, TTL/stale-while-revalidate policies, tag-based invalidation, namespace isolation, and optional JSON file persistence for pi.dev extension tools. It's designed for caching expensive tool/provider results without any LLM or network calls.

**Key features:**
- Deterministic cache key generation from namespace + input hash (SHA-256)
- TTL with stale-while-revalidate (SWR) support
- Tag-based and namespace-based group invalidation
- Glob pattern matching for key invalidation
- Expired-TTL sweep mode
- Optional LRU eviction with configurable max entries and size limits
- Optional JSON file persistence (atomic writes)
- Fully deterministic — no LLM calls, no network calls

## Tools

### `cache_get`

Look up a cached value by namespace + key or input hash.

**Parameters:**
- `namespace` (string, default: `"default"`) — Cache namespace for isolation
- `key` (string, optional) — Explicit cache key
- `input` (object, optional) — Object to hash for deterministic key generation (mutually exclusive with key)
- `allowStale` (boolean, default: `false`) — Return stale entries within SWR window
- `now` (number, optional) — Override current time in ms (for testing)
- `persistencePath` (string, optional) — Load cache from JSON file before lookup

**Example:**
```
Use the cache_get tool with namespace="api", input={"userId": "123"}, allowStale=true
```

### `cache_set`

Store a JSON-serializable value with TTL, tags, and namespace isolation.

**Parameters:**
- `namespace` (string, default: `"default"`) — Cache namespace
- `key` (string, optional) — Explicit cache key
- `input` (object, optional) — Object to hash for deterministic key
- `value` (any, required) — JSON-serializable value to cache
- `ttlMs` (number, default: `60000`) — Time-to-live in milliseconds
- `staleWhileRevalidateMs` (number, default: `0`) — SWR window after TTL expires
- `tags` (string[], default: `[]`) — Tags for group invalidation
- `maxEntries` (number, optional) — Max entries in namespace (LRU eviction)
- `maxSizeBytes` (number, optional) — Max approximate size in bytes
- `persistencePath` (string, optional) — Persist cache to JSON file after write

**Example:**
```
Use the cache_set tool with namespace="api", input={"userId": "123"}, value={...}, ttlMs=30000, tags=["user", "profile"]
```

### `cache_invalidate`

Remove cache entries by key, namespace, tag, glob pattern, or expired-TTL sweep.

**Parameters:**
- `key` (string, optional) — Exact cache key to invalidate
- `namespace` (string, optional) — Invalidate all entries in namespace
- `tag` (string, optional) — Invalidate all entries with this tag
- `pattern` (string, optional) — Glob pattern to match keys (e.g. `"user:*"`)
- `expiredOnly` (boolean, default: `false`) — Only invalidate expired entries (sweep mode)
- `now` (number, optional) — Override current time in ms (for testing)
- `persistencePath` (string, optional) — Persist updated cache to file

**Example:**
```
Use the cache_invalidate tool with tag="user", persistencePath="./cache.json"
```

## Persistence

When `persistencePath` is provided to any tool, the cache is loaded from / saved to a JSON file. Writes are atomic (temp file + rename). Corrupt or missing files are tolerated gracefully.

```typescript
// Cache persists across tool calls when using the same path
cache_set → persistencePath="./cache.json"  // writes to disk
cache_get → persistencePath="./cache.json"  // reads from disk
```

## TTL & Stale-While-Revalidate

- **TTL**: Entries expire after `ttlMs` milliseconds
- **SWR**: After TTL expires, entries remain accessible for `staleWhileRevalidateMs` if `allowStale=true`
- **Sweep**: Use `cache_invalidate` with `expiredOnly=true` to clean up fully expired entries

## Integrations

- **pi-rate-limit**: Cache before rate-limited provider/tool calls
- **pi-log**: Emit cache hit/miss/eviction events in consuming apps
- **pi-config**: Load cache policies (TTL, max entries, persistence path)
- **pi-perf**: Measure hit-rate and latency savings
- **pi-token-router**: Cache provider responses where safe
- **pi-ci**: Validate cache tests in generated workflows

## Resources

- [npm](https://www.npmjs.com/package/@realvendex/pi-cache)
- [GitHub](https://github.com/ZachDreamZ/pi-cache)
- [pi.dev](https://pi.dev/packages/@realvendex/pi-cache)

## License

MIT
