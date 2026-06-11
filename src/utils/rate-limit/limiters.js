import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedis } from "../redis/client.js";
import { TooManyRequestsError } from "../errors/index.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("rate-limit");

// Suppress repeated "Redis unreachable" warnings — log at most once
// per minute per limiter to keep startup logs readable when Redis
// is intentionally offline (dev with no docker, CI, etc.).
const _lastWarnAt = new Map();
function warnOnce(prefix, message) {
  const now = Date.now();
  const last = _lastWarnAt.get(prefix) || 0;
  if (now - last > 60_000) {
    _lastWarnAt.set(prefix, now);
    log.warn({ limiter: prefix }, message);
  }
}

function buildStore(prefix) {
  const redis = getRedis();
  if (!redis) return undefined; // falls back to in-memory store
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    // Defensive wrapper: when Redis is dead the rate-limit-redis
    // library would otherwise let the rejection bubble up as an
    // `unhandledRejection`. We swallow the error (the request just
    // proceeds without rate limiting — strictly worse for ddos but
    // strictly better than crashing). The first failure per minute
    // gets logged so ops still sees the degradation.
    sendCommand: async (...args) => {
      try {
        return await redis.call(...args);
      } catch (err) {
        warnOnce(
          prefix,
          `rate limiter ${prefix} degraded: ${err.code || err.message}`,
        );
        return null;
      }
    },
  });
}

/** Per-user rate limiter (uses user._id when authenticated, IP otherwise) */
function userKey(req) {
  return req.user?._id ? `u:${req.user._id}` : `ip:${req.ip}`;
}

export const generalLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-8",
  store: buildStore("general"),
  keyGenerator: userKey,
  handler: (req, res, next) =>
    next(new TooManyRequestsError("Too many requests, please try again later")),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20, // tighter than general
  store: buildStore("auth"),
  keyGenerator: (req) => `ip:${req.ip}`, // pre-auth: must use IP
  handler: (req, res, next) =>
    next(
      new TooManyRequestsError(
        "Too many authentication attempts, please try again later",
      ),
    ),
});

export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  store: buildStore("sensitive"),
  keyGenerator: userKey,
  handler: (req, res, next) =>
    next(new TooManyRequestsError("Operation rate exceeded for this hour")),
});
