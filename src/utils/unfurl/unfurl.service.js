/**
 * utils/unfurl/unfurl.service.js
 *
 * Slack-style link previews: extract URLs from message content,
 * fetch their Open Graph / Twitter / oEmbed metadata, return a
 * structured preview the FE can render as a card.
 *
 * Design choices:
 *   • Cache aggressively (Redis 24h TTL) — the same shared link is
 *     fetched once for the whole org, not per message.
 *   • Strict timeout + size cap — never let a slow / huge upstream
 *     page block the message send path.
 *   • SSRF guard: refuse private IP ranges, localhost, file://, etc.
 *     A naive fetch would let any user trigger HTTP requests from
 *     our backend to internal services. We block that.
 *   • Best-effort: failures return null, the message ships unwrapped.
 *
 * Producer pattern: extractUrls() + unfurlOne() are exposed so the
 * message create path can call them async (don't block the send).
 */

import { childLogger } from "../logger/logger.js";
import { getRedis } from "../redis/client.js";

const log = childLogger("unfurl");

// First http(s) URL in the content. Slack only unfurls the first link;
// we follow that convention — bulk unfurling is noisy in chat.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;

// Cap how much HTML we read — 256 KB is enough for OG tags in the
// <head>, and protects against drive-by huge-response attacks.
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5_000;
const CACHE_TTL_SECONDS = 24 * 60 * 60;

const PRIVATE_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 are matched by the
  // isPrivateHost() function below — listing exact strings here is
  // for the easy cases.
];

function isPrivateHost(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  if (PRIVATE_HOSTS.includes(lower)) return true;
  // IPv4 octet check — block RFC1918 + link-local + loopback
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // .local hostnames (mDNS) and internal-only TLDs
  if (lower.endsWith(".local") || lower.endsWith(".internal")) return true;
  return false;
}

export function extractFirstUrl(text) {
  if (!text) return null;
  const m = URL_RE.exec(text);
  return m ? m[0] : null;
}

// Minimal OG/Twitter meta scraper — regex-based on purpose so we
// don't pull in a full HTML parser dependency. Misses edge cases
// like inline scripts that close meta tags weirdly, which is fine:
// preview cards are aesthetic, not load-bearing.
function scrapeMeta(html) {
  const meta = {};
  const tagRe = /<meta\s+([^>]+)\/?>/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[1];
    const propMatch =
      /property\s*=\s*["']([^"']+)["']/i.exec(attrs) ||
      /name\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const contentMatch = /content\s*=\s*["']([^"']*)["']/i.exec(attrs);
    if (propMatch && contentMatch) {
      meta[propMatch[1].toLowerCase()] = contentMatch[1];
    }
  }
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  if (titleMatch && !meta["og:title"]) meta["og:title"] = titleMatch[1].trim();
  return meta;
}

function buildPreview(url, meta) {
  return {
    url,
    title: meta["og:title"] || meta["twitter:title"] || null,
    description:
      meta["og:description"] || meta["twitter:description"] || meta["description"] || null,
    image: meta["og:image"] || meta["twitter:image"] || null,
    siteName: meta["og:site_name"] || null,
    type: meta["og:type"] || "website",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchWithCap(url, signal) {
  const res = await fetch(url, {
    signal,
    redirect: "follow",
    headers: {
      // Some servers refuse the default Node UA. Mimic a real browser
      // header but identify ourselves so well-behaved sites can throttle us.
      "User-Agent": "Mozilla/5.0 (compatible; REM-Unfurler/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;

  // Stream-read with byte cap. Otherwise a server could feed us GBs.
  const reader = res.body.getReader();
  let received = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return buf.toString("utf8");
}

/**
 * Fetch one URL's preview. Returns null on any failure path.
 * Memoizes via Redis for 24h so repeat shares hit cache.
 */
export async function unfurlOne(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (isPrivateHost(parsed.hostname)) {
    log.debug({ host: parsed.hostname }, "unfurl refused private host");
    return null;
  }

  const redis = getRedis();
  const cacheKey = `unfurl:${url}`;
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      log.debug({ err }, "unfurl cache read failed");
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const html = await fetchWithCap(url, controller.signal);
    if (!html) return null;
    const meta = scrapeMeta(html);
    const preview = buildPreview(url, meta);

    if (redis) {
      // Cache even minimal previews — they're better than re-hitting
      // the upstream every time. 24h is long enough that one viral
      // link doesn't hammer the source.
      try {
        await redis.set(cacheKey, JSON.stringify(preview), "EX", CACHE_TTL_SECONDS);
      } catch (err) {
        log.debug({ err }, "unfurl cache write failed");
      }
    }
    return preview;
  } catch (err) {
    log.debug({ err: err.message, url }, "unfurl fetch failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
