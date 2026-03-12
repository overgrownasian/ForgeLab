import type { RecipeResult } from "@/lib/types";

type CachedRecipe = RecipeResult & {
  cachedAt: number;
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_ITEMS = 2000;

const globalCache = globalThis as typeof globalThis & {
  __alchemyCombinationCache?: Map<string, CachedRecipe>;
};

const cache = globalCache.__alchemyCombinationCache ?? new Map<string, CachedRecipe>();
globalCache.__alchemyCombinationCache = cache;

function pruneCache() {
  const now = Date.now();

  for (const [key, value] of cache.entries()) {
    if (now - value.cachedAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }

  while (cache.size > MAX_ITEMS) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}

export function getCachedCombination(pairKey: string) {
  const entry = cache.get(pairKey);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(pairKey);
    return null;
  }

  return {
    element: entry.element,
    emoji: entry.emoji,
    flavorText: entry.flavorText,
    source: entry.source
  } satisfies RecipeResult;
}

export function setCachedCombination(pairKey: string, result: RecipeResult) {
  pruneCache();
  cache.set(pairKey, {
    ...result,
    cachedAt: Date.now()
  });
}
