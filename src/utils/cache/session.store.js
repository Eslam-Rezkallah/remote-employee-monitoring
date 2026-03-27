/**
 * utils/cache/session.store.js
 *
 * In-memory map that holds lightweight "hot" state for every ACTIVE session.
 * This eliminates a DB write on every activity ping (which could be every
 * few seconds per user) while still letting the cron job and stop/pause
 * handlers flush accurate numbers to MongoDB.
 *
 * Shape of each entry:
 * {
 *   sessionId      : string   (Mongo _id)
 *   userId         : string
 *   lastActivityAt : number   (Date.now() ms)
 *   lastHeartbeat  : number   (Date.now() ms)
 *   isIdle         : boolean
 *   idleSince      : number|null  (Date.now() when idleness started)
 *   accruedIdle    : number   (seconds — flushed to DB periodically)
 *   dirty          : boolean  (needs a DB flush)
 * }
 *
 * IMPORTANT: This store lives in a single Node.js process.
 * For multi-process deployments use Redis instead (see NOTE below).
 */

const store = new Map();

/* ── write ────────────────────────────────────────────────── */

export function setSession(sessionId, data) {
  store.set(String(sessionId), { ...data, sessionId: String(sessionId) });
}

export function updateSession(sessionId, patch) {
  const key = String(sessionId);
  const existing = store.get(key);
  if (!existing) return false;
  store.set(key, { ...existing, ...patch });
  return true;
}

export function removeSession(sessionId) {
  store.delete(String(sessionId));
}

/* ── read ─────────────────────────────────────────────────── */

export function getSession(sessionId) {
  return store.get(String(sessionId)) || null;
}

/** Return all entries whose `isIdle` flag just changed (for cron). */
export function getAllActive() {
  return [...store.values()];
}

export function getByUserId(userId) {
  for (const entry of store.values()) {
    if (String(entry.userId) === String(userId)) return entry;
  }
  return null;
}

/** How many sessions are currently tracked */
export function size() {
  return store.size;
}

/*
 * NOTE — Redis upgrade path:
 * Replace this module with an ioredis client.
 * setSession  → redis.set(key, JSON.stringify(data), 'EX', 3600)
 * getSession  → JSON.parse(await redis.get(key))
 * removeSession → redis.del(key)
 * getAllActive → redis.keys + redis.mget (or use a Redis Set of active IDs)
 * The interface stays identical so no callers change.
 */