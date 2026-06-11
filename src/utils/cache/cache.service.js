import { LRUCache } from "lru-cache";
import { getRedis } from "../redis/client.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("cache");

const lru = new LRUCache({ max: 1000, ttl: 60 * 1000 });

/**
 * Get-or-compute pattern.
 *
 *   const data = await cached(
 *     "unread:user:123",
 *     30, // ttl seconds
 *     async () => computeUnreadCounts(userId),
 *   );
 */
export async function cached(key, ttlSeconds, computeFn) {
  // 1. Local LRU first (fastest)
  const local = lru.get(key);
  if (local !== undefined) return local;

  // 2. Redis (cross-instance)
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw !== null) {
        const value = JSON.parse(raw);
        lru.set(key, value);
        return value;
      }
    } catch (err) {
      log.warn({ err, key }, "redis get failed");
    }
  }

  // 3. Compute
  const value = await computeFn();
  lru.set(key, value);

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      log.warn({ err, key }, "redis set failed");
    }
  }

  return value;
}

/** Invalidate a key everywhere */
export async function invalidate(key) {
  lru.delete(key);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(key);
    } catch (err) {
      log.warn({ err, key }, "redis del failed");
    }
  }
}

/** Invalidate all keys matching a prefix — use sparingly */
export async function invalidatePrefix(prefix) {
  for (const k of lru.keys()) {
    if (k.startsWith(prefix)) lru.delete(k);
  }
  const redis = getRedis();
  if (redis) {
    try {
      // SCAN-based deletion to avoid blocking
      const stream = redis.scanStream({ match: `${prefix}*`, count: 100 });
      const pipe = redis.pipeline();
      let count = 0;
      stream.on("data", (keys) => {
        for (const k of keys) {
          pipe.del(k);
          count++;
        }
      });
      stream.on("end", () => pipe.exec());
    } catch (err) {
      log.warn({ err, prefix }, "redis scan/del failed");
    }
  }
}

/** Build a cache key from parts (consistent ordering) */
export function ckey(...parts) {
  return parts.map(String).join(":");
}
