/**
 * tests/qa-frontend/api/client.js
 *
 * Reusable REST client used by every QA page.
 *
 *   - Reads baseUrl + accessToken from localStorage so every page
 *     starts with the same session.
 *   - Returns BOTH the response body AND the raw Response so callers
 *     can show status codes / headers in the UI without re-parsing.
 *   - Surfaces network errors as a `network: true` field instead of
 *     throwing — QA pages render the error inline anyway.
 */

const LS = {
  baseUrl: "rem.qa.baseUrl",
  accessToken: "rem.qa.accessToken",
  refreshToken: "rem.qa.refreshToken",
  user: "rem.qa.user",
};

export function getBaseUrl() {
  return localStorage.getItem(LS.baseUrl) || window.location.origin;
}
export function setBaseUrl(v) {
  localStorage.setItem(LS.baseUrl, v.replace(/\/$/, ""));
}
export function getToken() {
  return localStorage.getItem(LS.accessToken);
}
export function setSession(accessToken, refreshToken, user) {
  localStorage.setItem(LS.accessToken, accessToken || "");
  localStorage.setItem(LS.refreshToken, refreshToken || "");
  localStorage.setItem(LS.user, JSON.stringify(user || null));
}
export function clearSession() {
  localStorage.removeItem(LS.accessToken);
  localStorage.removeItem(LS.refreshToken);
  localStorage.removeItem(LS.user);
}
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(LS.user));
  } catch {
    return null;
  }
}

/**
 * Send any HTTP request and return a normalized envelope:
 *   { ok, status, body, headers, network: false, error: null, ms }
 *
 * Or on network/CORS failure:
 *   { ok: false, status: 0, body: null, network: true, error: msg, ms }
 */
export async function api(
  path,
  { method = "GET", body, headers = {}, query } = {},
) {
  let url = getBaseUrl() + path;
  if (query) {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(query).filter(
          ([, v]) => v !== undefined && v !== null && v !== "",
        ),
      ),
    );
    if (qs.toString()) url += `?${qs.toString()}`;
  }

  const token = getToken();
  const reqHeaders = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers: reqHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return {
      ok: res.ok,
      status: res.status,
      body: json,
      headers: Object.fromEntries(res.headers.entries()),
      network: false,
      error: null,
      ms: Math.round(performance.now() - t0),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      headers: {},
      network: true,
      error: err.message,
      ms: Math.round(performance.now() - t0),
    };
  }
}
