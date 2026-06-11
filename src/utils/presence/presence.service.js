/**
 * Distributed presence tracker.
 *
 * Backing:
 *   - Redis when REDIS_URL is set (production / multi-instance)
 *   - In-memory Map fallback (single-instance dev)
 *
 * Redis schema:
 *   user:online:<userId> → Set of socketIds
 *   TTL: 30 minutes (renewed on activity; stale entries auto-evict)
 */

import { getRedis } from "../redis/client.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("presence");

const PRESENCE_TTL_SECONDS = 30 * 60;
const inMemory = new Map(); // userId → Set<socketId>

const key = (userId) => `user:online:${userId}`;

/**
 * Mark a socket as online for a user.
 * Multiple sockets per user (tabs/devices) are supported.
 */
export async function markOnline(userId, socketId) {
  const uid = String(userId);
  const sid = String(socketId);
  const redis = getRedis();

  if (redis) {
    try {
      await redis.sadd(key(uid), sid);
      await redis.expire(key(uid), PRESENCE_TTL_SECONDS);
      return;
    } catch (err) {
      log.warn({ err }, "redis markOnline failed; using memory fallback");
    }
  }

  let set = inMemory.get(uid);
  if (!set) {
    set = new Set();
    inMemory.set(uid, set);
  }
  set.add(sid);
}

/**
 * Mark a socket as offline. Returns true if the user has NO remaining
 * sockets (so caller can broadcast "user_offline").
 */
export async function markOffline(userId, socketId) {
  const uid = String(userId);
  const sid = String(socketId);
  const redis = getRedis();

  if (redis) {
    try {
      await redis.srem(key(uid), sid);
      const remaining = await redis.scard(key(uid));
      if (remaining === 0) {
        await redis.del(key(uid));
        return true;
      }
      return false;
    } catch (err) {
      log.warn({ err }, "redis markOffline failed; using memory fallback");
    }
  }

  const set = inMemory.get(uid);
  if (!set) return true;
  set.delete(sid);
  if (set.size === 0) {
    inMemory.delete(uid);
    return true;
  }
  return false;
}

/** Is the user online on ANY socket? */
export async function isOnline(userId) {
  const uid = String(userId);
  const redis = getRedis();

  if (redis) {
    try {
      return (await redis.scard(key(uid))) > 0;
    } catch (err) {
      log.warn({ err }, "redis isOnline failed; using memory fallback");
    }
  }

  const set = inMemory.get(uid);
  return !!set && set.size > 0;
}

/** Bulk check — used by chat room online indicators */
export async function whichAreOnline(userIds = []) {
  if (!userIds.length) return [];
  const redis = getRedis();

  if (redis) {
    try {
      const pipe = redis.pipeline();
      for (const id of userIds) pipe.scard(key(String(id)));
      const results = await pipe.exec();
      return userIds.filter((_, i) => (results[i][1] || 0) > 0);
    } catch (err) {
      log.warn({ err }, "redis whichAreOnline failed");
    }
  }

  return userIds.filter((id) => {
    const set = inMemory.get(String(id));
    return !!set && set.size > 0;
  });
}

/** For graceful shutdown — clear this instance's tracked users */
export async function clearAll() {
  inMemory.clear();
}
