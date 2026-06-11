/**
 * utils/observability/sentry.js
 *
 * Optional Sentry error tracking. Activated only when `SENTRY_DSN` is
 * set in the environment — otherwise initializes a no-op shim that
 * matches the same API so callers don't need conditionals.
 *
 * Why lazy:
 *   • @sentry/node is heavy at import time (instruments async-hooks,
 *     spawns the transport worker, etc.). Skipping it in dev/CI keeps
 *     boot fast.
 *   • A missing optional dep should never crash the app — this file
 *     wraps the import in try/catch so the project keeps booting if
 *     somebody forgot to install @sentry/node but set the DSN.
 *
 * Usage:
 *   import { initSentry, captureException } from "./utils/observability/sentry.js";
 *   await initSentry();                       // call once, before bootstrap
 *   captureException(err, { user, route });   // anywhere
 */

import { childLogger } from "../logger/logger.js";

const log = childLogger("sentry");

let _sentry = null; // The real module if init succeeded
let _initialised = false;

export async function initSentry() {
  if (_initialised) return _sentry;
  _initialised = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.info("SENTRY_DSN not set — error tracking disabled");
    return null;
  }

  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.MOOD || "DEV",
      release: process.env.APP_VERSION || undefined,
      // Sample rates kept conservative — 10% trace sample is enough
      // to spot regressions without flooding the dashboard.
      tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE || 0.1),
      // Don't ship PII (request bodies / headers) by default. The
      // logger already redacts auth headers but Sentry has its own
      // pipeline.
      sendDefaultPii: false,
    });
    _sentry = Sentry;
    log.info({ env: process.env.MOOD }, "Sentry initialised");
    return Sentry;
  } catch (err) {
    log.warn(
      { err: err.message },
      "@sentry/node not installed; install it to enable error tracking",
    );
    return null;
  }
}

/**
 * Forward an exception to Sentry. Always returns an `eventId` (or null)
 * synchronously so the caller can log it alongside their own message.
 */
export function captureException(err, context = {}) {
  if (!_sentry) return null;
  try {
    return _sentry.captureException(err, {
      extra: context,
    });
  } catch (e) {
    log.warn({ e: e.message }, "Sentry captureException threw");
    return null;
  }
}

/** Useful in graceful shutdown so in-flight events ship before exit. */
export async function flushSentry(timeoutMs = 2000) {
  if (!_sentry) return;
  try {
    await _sentry.flush(timeoutMs);
  } catch (e) {
    log.warn({ e: e.message }, "Sentry flush threw");
  }
}
