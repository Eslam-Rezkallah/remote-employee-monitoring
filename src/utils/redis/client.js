import Redis from "ioredis";
import { config } from "../../config/index.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("redis");

let mainClient = null;
let pubClient = null;
let subClient = null;

const MAX_RECONNECT_ATTEMPTS = Number(process.env.REDIS_MAX_RECONNECT_ATTEMPTS || 10);

function buildClient(name) {
  if (!config.redis.enabled) {
    log.info(`${name}: Redis disabled — using in-memory fallback`);
    return null;
  }

  let givenUp = false;
  let lastErrorMessage = null;
  // Track which lifecycle events we've already logged in this
  // disconnected streak. Without these gates we'd print "closed" +
  // "reconnecting" twice per second during ioredis's exponential
  // backoff — useless noise.
  let everConnected = false;
  let closedLogged = false;
  let reconnectingLogged = false;

  const client = new Redis(config.redis.url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times) {
      if (times > MAX_RECONNECT_ATTEMPTS) {
        if (!givenUp) {
          givenUp = true;
          log.error(
            { attempts: times },
            `${name} gave up reconnecting; falling back to in-memory paths`
          );
        }
        return null; // stop retrying
      }
      return Math.min(times * 200, 5000);
    },
    reconnectOnError(err) {
      return err.message.includes("READONLY");
    },
  });

  client.on("connect", () => {
    // Only log "connecting" once per session — suppress chatter.
    if (!everConnected) log.info(`${name} connecting`);
  });
  client.on("ready", () => {
    givenUp = false;
    lastErrorMessage = null;
    closedLogged = false;
    reconnectingLogged = false;
    everConnected = true;
    log.info(`${name} ready`);
  });
  client.on("error", (err) => {
    // De-dup identical error messages AND skip pure connection-refused
    // noise — the lifecycle (close/reconnecting/gave-up) already tells
    // operators the story.
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") return;
    if (err.message !== lastErrorMessage) {
      lastErrorMessage = err.message;
      log.error({ err }, `${name} error`);
    }
  });
  client.on("close", () => {
    if (givenUp || closedLogged) return;
    closedLogged = true;
    log.warn(`${name} closed`);
  });
  client.on("reconnecting", () => {
    if (givenUp || reconnectingLogged) return;
    reconnectingLogged = true;
    log.warn(`${name} reconnecting`);
  });
  client.on("end", () => {
    // Final state — log once even if we already logged "closed".
    if (!givenUp) log.warn(`${name} connection ended`);
  });

  return client;
}

/**
 * A client whose status is "end" has permanently given up reconnecting
 * (retryStrategy returned null) or was explicitly quit/disconnected. Issuing
 * commands against it only throws "Connection is closed." on every call, so we
 * treat it as absent and let callers fall back to their in-memory paths.
 */
const usable = (client) => (client && client.status !== "end" ? client : null);

/**
 * Lazy singletons. Three separate clients because Socket.IO Redis adapter
 * requires dedicated pub/sub clients that can't be used for regular commands.
 */
export const getRedis = () => {
  if (!mainClient) mainClient = buildClient("redis-main");
  return usable(mainClient);
};

export const getPubClient = () => {
  if (!pubClient) pubClient = buildClient("redis-pub");
  return usable(pubClient);
};

export const getSubClient = () => {
  if (!subClient) subClient = buildClient("redis-sub");
  return usable(subClient);
};

/** Liveness probe used by /readyz */
export const pingRedis = async () => {
  const client = getRedis();
  if (!client) return { ok: false, reason: "redis-disabled" };
  try {
    const pong = await client.ping();
    return { ok: pong === "PONG" };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
};

export const closeRedis = async () => {
  const clients = [mainClient, pubClient, subClient].filter(Boolean);
  await Promise.allSettled(clients.map((c) => c.quit()));
  mainClient = pubClient = subClient = null;
};
