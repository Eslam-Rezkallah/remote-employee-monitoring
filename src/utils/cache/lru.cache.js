import { LRUCache } from "lru-cache";

export const cache = new LRUCache({
  max: 500,
  ttl: 60 * 1000, // 60 seconds
});

export function cacheKey(parts = []) {
  return parts.map(String).join("|");
}
