/**
 * Hot-state store for ACTIVE work sessions.
 *
 * Backing:
 *   - Redis (multi-instance safe) when available
 *   - In-memory Map fallback
 *
 * Redis schema:
 *   ws:session:<sessionId>  → Hash { sessionId, userId, lastActivityAt, ... }
 *   ws:active:user:<userId> → Set of sessionIds for fast lookup-by-user
 *   ws:active:all           → Set of all active sessionIds (for cron)
 *   TTL: 6 hours on each session hash (renewed by heartbeat)
 */

import { getRedis } from "../redis/client.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("session-store");

const TTL_SECONDS = 6 * 60 * 60;
const memory = new Map();

const sessionKey = (id) => `ws:session:${id}`;
const userKey = (uid) => `ws:active:user:${uid}`;
const ALL_KEY = "ws:active:all";

function serialize(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

function deserialize(hash) {
  if (!hash || !Object.keys(hash).length) return null;
  return {
    sessionId: hash.sessionId,
    userId: hash.userId,
    lastActivityAt: Number(hash.lastActivityAt) || Date.now(),
    lastHeartbeat: Number(hash.lastHeartbeat) || Date.now(),
    isIdle: hash.isIdle === "true",
    idleSince: hash.idleSince ? Number(hash.idleSince) : null,
    accruedIdle: Number(hash.accruedIdle) || 0,
    dirty: hash.dirty === "true",
  };
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API (same shape as before)
// ─────────────────────────────────────────────────────────────

export async function setSession(sessionId, data) {
  const sid = String(sessionId);
  const uid = String(data.userId);
  const redis = getRedis();

  if (redis) {
    try {
      const pipe = redis.pipeline();
      pipe.hset(sessionKey(sid), serialize({ ...data, sessionId: sid }));
      pipe.expire(sessionKey(sid), TTL_SECONDS);
      pipe.sadd(userKey(uid), sid);
      pipe.expire(userKey(uid), TTL_SECONDS);
      pipe.sadd(ALL_KEY, sid);
      await pipe.exec();
      return;
    } catch (err) {
      log.warn({ err }, "setSession redis failed; using memory");
    }
  }

  memory.set(sid, { ...data, sessionId: sid });
}

export async function updateSession(sessionId, patch) {
  const sid = String(sessionId);
  const redis = getRedis();

  if (redis) {
    try {
      const existing = await redis.hgetall(sessionKey(sid));
      if (!existing || !existing.sessionId) return false;
      const merged = { ...deserialize(existing), ...patch };
      await redis.hset(sessionKey(sid), serialize(merged));
      await redis.expire(sessionKey(sid), TTL_SECONDS);
      return true;
    } catch (err) {
      log.warn({ err }, "updateSession redis failed; using memory");
    }
  }

  const existing = memory.get(sid);
  if (!existing) return false;
  memory.set(sid, { ...existing, ...patch });
  return true;
}

export async function removeSession(sessionId) {
  const sid = String(sessionId);
  const redis = getRedis();

  if (redis) {
    try {
      const data = await redis.hgetall(sessionKey(sid));
      const uid = data?.userId;
      const pipe = redis.pipeline();
      pipe.del(sessionKey(sid));
      pipe.srem(ALL_KEY, sid);
      if (uid) pipe.srem(userKey(uid), sid);
      await pipe.exec();
      return;
    } catch (err) {
      log.warn({ err }, "removeSession redis failed; using memory");
    }
  }

  memory.delete(sid);
}

export async function getSession(sessionId) {
  const sid = String(sessionId);
  const redis = getRedis();

  if (redis) {
    try {
      const data = await redis.hgetall(sessionKey(sid));
      return deserialize(data);
    } catch (err) {
      log.warn({ err }, "getSession redis failed; using memory");
    }
  }

  return memory.get(sid) || null;
}

export async function getByUserId(userId) {
  const uid = String(userId);
  const redis = getRedis();

  if (redis) {
    try {
      const ids = await redis.smembers(userKey(uid));
      if (!ids.length) return null;
      // Return first active session (only one per user is allowed by schema)
      return await getSession(ids[0]);
    } catch (err) {
      log.warn({ err }, "getByUserId redis failed; using memory");
    }
  }

  for (const entry of memory.values()) {
    if (entry.userId === uid) return entry;
  }
  return null;
}

export async function getAllActive() {
  const redis = getRedis();

  if (redis) {
    try {
      const ids = await redis.smembers(ALL_KEY);
      if (!ids.length) return [];
      const pipe = redis.pipeline();
      for (const id of ids) pipe.hgetall(sessionKey(id));
      const results = await pipe.exec();
      return results
        .map(([err, hash]) => (err ? null : deserialize(hash)))
        .filter(Boolean);
    } catch (err) {
      log.warn({ err }, "getAllActive redis failed; using memory");
    }
  }

  return [...memory.values()];
}

export async function size() {
  const redis = getRedis();
  if (redis) {
    try {
      return await redis.scard(ALL_KEY);
    } catch (_) {}
  }
  return memory.size;
}
