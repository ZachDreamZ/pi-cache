import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CacheEngine } from "./cache.js";
import {
  CacheGetParams,
  CacheSetParams,
  CacheInvalidateParams,
} from "./schemas.js";

function textResult(
  text: string,
  details: Record<string, unknown>,
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export function registerTools(pi: ExtensionAPI): void {
  // Shared engine instance (stateful per extension load)
  const engine = new CacheEngine();

  // ─── cache_get ───

  pi.registerTool({
    name: "cache_get",
    label: "Cache Get",
    description:
      "Look up a cached JSON-serializable value by namespace + key or input hash. Returns hit/miss status with value, age, TTL remaining, and stale-while-revalidate eligibility.",
    parameters: CacheGetParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const namespace = params.namespace ?? "default";
        const allowStale = params.allowStale ?? false;

        // Load from persistence if path provided
        if (params.persistencePath) {
          engine.loadFromFile(params.persistencePath);
        }

        const result = engine.get(
          namespace,
          params.key as string | undefined,
          params.input,
          allowStale,
          params.now,
        );

        if (result.hit) {
          return textResult(
            `Cache HIT in namespace "${namespace}" (key: ${result.key}). Age: ${result.ageMs}ms, TTL remaining: ${result.ttlRemainingMs}ms${result.stale ? " [STALE/SWR]" : ""}`,
            {
              hit: true,
              value: result.value,
              createdAt: result.createdAt,
              ageMs: result.ageMs,
              ttlRemainingMs: result.ttlRemainingMs,
              stale: result.stale ?? false,
              swrEligible: result.swrEligible ?? false,
              tags: result.tags,
              namespace: result.namespace,
              key: result.key,
            },
          );
        }

        const swrNote = result.swrEligible
          ? " Entry was SWR-eligible but allowStale was false."
          : "";
        return textResult(
          `Cache MISS in namespace "${namespace}" (key: ${result.key}).${swrNote}`,
          {
            hit: false,
            stale: result.stale ?? false,
            swrEligible: result.swrEligible ?? false,
            namespace,
            key: result.key,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`cache_get error: ${msg}`, {
          error: msg,
        });
      }
    },
  });

  // ─── cache_set ───

  pi.registerTool({
    name: "cache_set",
    label: "Cache Set",
    description:
      "Store a JSON-serializable value with TTL, stale-while-revalidate, tags, namespace isolation, and optional LRU/size limits. Supports optional JSON file persistence.",
    parameters: CacheSetParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const namespace = params.namespace ?? "default";

        const result = engine.set(namespace, params.value, {
          explicitKey: params.key as string | undefined,
          input: params.input,
          ttlMs: params.ttlMs ?? 60000,
          staleWhileRevalidateMs: params.staleWhileRevalidateMs ?? 0,
          tags: params.tags ?? [],
          maxEntries: params.maxEntries,
          maxSizeBytes: params.maxSizeBytes,
        });

        // Persist if path provided
        if (params.persistencePath) {
          engine.saveToFile(params.persistencePath);
        }

        const expiresStr = result.expiresAt
          ? new Date(result.expiresAt).toISOString()
          : "never";

        return textResult(
          `Cached in "${namespace}" (key: ${result.key}). Expires: ${expiresStr}, TTL: ${result.ttlMs}ms, Tags: [${result.tags.join(", ")}], Entries: ${result.entryCount}`,
          {
            key: result.key,
            namespace: result.namespace,
            expiresAt: result.expiresAt,
            ttlMs: result.ttlMs,
            tags: result.tags,
            entryCount: result.entryCount,
            approximateBytes: result.approximateBytes,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`cache_set error: ${msg}`, { error: msg });
      }
    },
  });

  // ─── cache_invalidate ───

  pi.registerTool({
    name: "cache_invalidate",
    label: "Cache Invalidate",
    description:
      "Remove cache entries by key, namespace, tag, glob pattern, or expired-TTL sweep. Returns count invalidated, freed bytes, and remaining entries.",
    parameters: CacheInvalidateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const result = engine.invalidate({
          key: params.key as string | undefined,
          namespace: params.namespace,
          tag: params.tag,
          pattern: params.pattern,
          expiredOnly: params.expiredOnly ?? false,
          now: params.now,
        });

        // Persist if path provided
        if (params.persistencePath) {
          engine.saveToFile(params.persistencePath);
        }

        return textResult(
          `Invalidated ${result.invalidatedCount} entries (~${result.freedBytesEstimate} bytes freed). ${result.remainingEntries} entries remaining.`,
          {
            invalidatedCount: result.invalidatedCount,
            freedBytesEstimate: result.freedBytesEstimate,
            remainingEntries: result.remainingEntries,
            matchedKeys: result.matchedKeys,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`cache_invalidate error: ${msg}`, { error: msg });
      }
    },
  });
}
