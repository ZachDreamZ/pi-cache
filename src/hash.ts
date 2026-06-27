import { createHash } from "node:crypto";

/**
 * Canonical JSON stringify with sorted object keys.
 * Produces deterministic output regardless of key insertion order.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const sorted = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = (value as Record<string, unknown>)[key];
          return acc;
        },
        {} as Record<string, unknown>,
      );
    return JSON.stringify(sorted, (_key, val) => {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        return Object.keys(val)
          .sort()
          .reduce(
            (acc, k) => {
              acc[k] = val[k];
              return acc;
            },
            {} as Record<string, unknown>,
          );
      }
      return val;
    });
  }
  return JSON.stringify(value);
}

/**
 * Generate a deterministic SHA-256 hash from a namespace + input pair.
 */
export function computeKeyHash(namespace: string, input: unknown): string {
  const canonical = `${namespace}:${canonicalStringify(input)}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
