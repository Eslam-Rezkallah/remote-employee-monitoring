/**
 * tests/qa-frontend/components/ui.js
 *
 * Tiny render helpers shared across QA pages. Function over form —
 * every page reuses these so the layout is consistent and we don't
 * re-implement loading/error/response panels in 8 files.
 */

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

/**
 * Card with title + body. Pages compose pages from these.
 */
export function card(title, body) {
  return el("section", { class: "bg-white rounded shadow p-4 mb-4" }, [
    el("h2", { class: "font-semibold text-slate-800 mb-3" }, title),
    body,
  ]);
}

export function row(...children) {
  return el(
    "div",
    { class: "flex flex-wrap gap-2 mb-2 items-end" },
    children,
  );
}

export function input(id, placeholder = "", value = "", attrs = {}) {
  return el("input", {
    id,
    placeholder,
    value: value || "",
    class:
      "border rounded px-2 py-1 text-sm flex-1 min-w-[160px] " +
      (attrs.class || ""),
    ...attrs,
  });
}

export function button(label, onclick, kind = "primary") {
  const colors = {
    primary: "bg-slate-800 text-white hover:bg-slate-900",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    ghost: "bg-slate-200 text-slate-700 hover:bg-slate-300",
  };
  return el(
    "button",
    {
      onclick,
      class:
        "px-3 py-1.5 rounded text-sm font-medium " +
        (colors[kind] || colors.primary),
    },
    label,
  );
}

/**
 * Result panel — renders { ok, status, body, ms, error } from api()
 * in a consistent way: status badge + payload + headers.
 *
 *   const out = el("div");
 *   renderResult(out, "idle");
 *   ...
 *   renderResult(out, "loading", { method, url });
 *   ...
 *   renderResult(out, "result", apiResponse, requestPayload);
 */
export function renderResult(host, state, data, request) {
  host.innerHTML = "";
  if (state === "idle") {
    host.appendChild(
      el("div", { class: "text-slate-400 text-sm italic" }, "No request yet."),
    );
    return;
  }
  if (state === "loading") {
    host.appendChild(
      el(
        "div",
        { class: "text-amber-600 text-sm" },
        `⏳ Sending ${data?.method || "request"} ${data?.url || ""}…`,
      ),
    );
    return;
  }
  // state = "result"
  const { ok, status, body, headers, ms, network, error } = data;
  const badgeColor = network
    ? "bg-rose-100 text-rose-800"
    : ok
      ? "bg-emerald-100 text-emerald-800"
      : status >= 500
        ? "bg-rose-100 text-rose-800"
        : "bg-amber-100 text-amber-800";

  host.appendChild(
    el("div", { class: "flex items-center gap-2 mb-2" }, [
      el(
        "span",
        { class: `text-xs font-semibold px-2 py-0.5 rounded ${badgeColor}` },
        network ? "NETWORK ERROR" : `${status}`,
      ),
      el("span", { class: "text-xs text-slate-500" }, `${ms}ms`),
    ]),
  );

  if (request) {
    host.appendChild(
      el("details", { class: "mb-2" }, [
        el(
          "summary",
          { class: "text-xs text-slate-500 cursor-pointer" },
          "Request payload",
        ),
        el(
          "pre",
          { class: "bg-slate-50 text-xs p-2 rounded mt-1 border" },
          JSON.stringify(request, null, 2),
        ),
      ]),
    );
  }

  host.appendChild(
    el("div", { class: "text-xs text-slate-500 mb-1" }, "Response body"),
  );
  host.appendChild(
    el(
      "pre",
      { class: "bg-slate-50 text-xs p-2 rounded border" },
      network ? error : JSON.stringify(body, null, 2),
    ),
  );

  if (headers && Object.keys(headers).length) {
    host.appendChild(
      el("details", { class: "mt-2" }, [
        el(
          "summary",
          { class: "text-xs text-slate-500 cursor-pointer" },
          "Headers",
        ),
        el(
          "pre",
          { class: "bg-slate-50 text-xs p-2 rounded mt-1 border" },
          JSON.stringify(headers, null, 2),
        ),
      ]),
    );
  }
}

/**
 * Wrap an async fn so it shows loading + result in the same panel.
 * Used by every "Run" button on every page.
 */
export async function runWithPanel(panel, requestDescriptor, fn) {
  renderResult(panel, "loading", requestDescriptor);
  try {
    const response = await fn();
    renderResult(panel, "result", response, requestDescriptor.payload);
    return response;
  } catch (err) {
    renderResult(
      panel,
      "result",
      {
        ok: false,
        status: 0,
        network: true,
        error: err.message,
        ms: 0,
        headers: {},
      },
      requestDescriptor.payload,
    );
    return null;
  }
}
