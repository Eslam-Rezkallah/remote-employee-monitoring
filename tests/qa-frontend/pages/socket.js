/**
 * Socket testing page — the heart of the QA harness.
 *
 * Two namespaces:
 *   /chat   — messages, typing, presence, mentions, room join/leave
 *   /call   — ringing, accept/reject, raise-hand, in-call chat, mention
 *
 * For each namespace:
 *   • Connect / Disconnect buttons
 *   • Join / Leave room
 *   • Emit any event by name + JSON payload
 *   • Live feed of every incoming event (newest first)
 *
 * Notifications get their own column because they fire on the /chat
 * namespace as `notification` events and are how users see comments,
 * mentions, task assignments, meeting pings, etc.
 */

import {
  connect,
  disconnect,
  emit,
  onAny,
  isConnected,
} from "../api/socket-client.js";
import { card, row, input, button, el } from "../components/ui.js";

const STATE = {
  chatLogEl: null,
  callLogEl: null,
  notifLogEl: null,
  unsubs: [],
};

function pushLog(host, eventName, payload, color = "text-slate-200") {
  const line = el(
    "div",
    {
      class: `border-b border-slate-700 py-1 px-2 ${color}`,
    },
    [
      el("div", { class: "text-xs text-slate-400" }, new Date().toLocaleTimeString()),
      el("div", { class: "font-mono text-xs font-bold" }, eventName),
      el(
        "pre",
        { class: "text-xs whitespace-pre-wrap text-slate-300 mt-1" },
        typeof payload === "object"
          ? JSON.stringify(payload, null, 2)
          : String(payload),
      ),
    ],
  );
  host.prepend(line);
  // Cap log size so the page doesn't grow forever during long tests.
  while (host.children.length > 200) host.removeChild(host.lastChild);
}

function clearLog(host) {
  host.innerHTML = "";
}

function namespacePanel({
  title,
  ns,
  presetEvents,
  presetPayload,
  logHost,
  notifLog,
}) {
  const statusBadge = el(
    "span",
    {
      class: "ml-2 text-xs px-2 py-0.5 rounded bg-rose-100 text-rose-800",
    },
    "DISCONNECTED",
  );
  const updateStatus = () => {
    if (isConnected(ns)) {
      statusBadge.className =
        "ml-2 text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800";
      statusBadge.textContent = "CONNECTED";
    } else {
      statusBadge.className =
        "ml-2 text-xs px-2 py-0.5 rounded bg-rose-100 text-rose-800";
      statusBadge.textContent = "DISCONNECTED";
    }
  };

  // Inputs
  const roomInp = input(`${ns.replace("/", "")}-room`, "roomId");
  const eventInp = input(`${ns.replace("/", "")}-evt`, "event name");
  const payloadInp = input(
    `${ns.replace("/", "")}-payload`,
    'JSON payload (e.g. {"roomId":"...","content":"hi"})',
    "",
    { class: "flex-[2]" },
  );

  const presetSel = el("select", {
    id: `${ns.replace("/", "")}-preset`,
    class: "border rounded px-2 py-1 text-sm",
    onchange: (e) => {
      const v = e.target.value;
      if (!v) return;
      const cfg = presetEvents[v];
      if (cfg) {
        eventInp.value = cfg.event;
        payloadInp.value = JSON.stringify(cfg.payload(roomInp.value), null, 0);
      }
    },
  });
  presetSel.appendChild(el("option", { value: "" }, "— preset —"));
  Object.keys(presetEvents).forEach((k) => {
    presetSel.appendChild(el("option", { value: k }, k));
  });

  return card(
    el("span", {}, [`${title} (${ns})`, statusBadge]),
    el("div", {}, [
      row(
        button(
          "Connect",
          () => {
            try {
              connect(ns);
              const off = onAny(ns, (eventName, payload) => {
                const color =
                  eventName === "connect_error"
                    ? "text-rose-300"
                    : eventName === "disconnect"
                      ? "text-amber-300"
                      : "text-sky-300";
                pushLog(logHost, eventName, payload, color);
                if (eventName === "notification") {
                  pushLog(notifLog, "[from " + ns + "]", payload, "text-fuchsia-300");
                }
                updateStatus();
              });
              STATE.unsubs.push(off);
              setTimeout(updateStatus, 100);
            } catch (err) {
              pushLog(logHost, "ERROR", err.message, "text-rose-300");
            }
          },
          "success",
        ),
        button(
          "Disconnect",
          () => {
            disconnect(ns);
            updateStatus();
          },
          "danger",
        ),
        button("Clear log", () => clearLog(logHost), "ghost"),
      ),
      row(
        roomInp,
        button(
          "Join room",
          () => {
            const r = roomInp.value.trim();
            if (!r) return;
            try {
              emit(ns, "join_room", { roomId: r });
              pushLog(logHost, "→ join_room", { roomId: r }, "text-emerald-300");
            } catch (err) {
              pushLog(logHost, "ERROR", err.message, "text-rose-300");
            }
          },
          "ghost",
        ),
        button(
          "Leave room",
          () => {
            const r = roomInp.value.trim();
            if (!r) return;
            try {
              emit(ns, "leave_room", { roomId: r });
              pushLog(logHost, "→ leave_room", { roomId: r }, "text-amber-300");
            } catch (err) {
              pushLog(logHost, "ERROR", err.message, "text-rose-300");
            }
          },
          "ghost",
        ),
      ),
      row(presetSel, eventInp, payloadInp),
      row(
        button(
          "Emit",
          () => {
            const name = eventInp.value.trim();
            if (!name) return;
            let payload = {};
            try {
              payload = payloadInp.value.trim()
                ? JSON.parse(payloadInp.value)
                : {};
            } catch (err) {
              pushLog(
                logHost,
                "ERROR",
                "Invalid JSON payload: " + err.message,
                "text-rose-300",
              );
              return;
            }
            try {
              emit(ns, name, payload);
              pushLog(logHost, "→ " + name, payload, "text-emerald-300");
            } catch (err) {
              pushLog(logHost, "ERROR", err.message, "text-rose-300");
            }
          },
          "success",
        ),
      ),
      el(
        "div",
        { class: "mt-3 bg-slate-900 rounded max-h-[400px] overflow-auto" },
        [logHost],
      ),
    ]),
  );
}

export async function render(host) {
  // Log containers — passed by reference into each namespace panel.
  STATE.chatLogEl = el("div", { class: "p-1" });
  STATE.callLogEl = el("div", { class: "p-1" });
  STATE.notifLogEl = el("div", {
    class: "p-1 bg-slate-900 rounded max-h-[600px] overflow-auto",
  });

  // ── Presets ──────────────────────────────────────────────
  // Pre-fill common payloads so QA doesn't have to remember the
  // socket protocol every time. The `payload(roomId)` callback lets
  // the preset pick up whatever's in the room input at click time.
  const chatPresets = {
    typing: { event: "typing", payload: (r) => ({ roomId: r }) },
    stop_typing: { event: "stop_typing", payload: (r) => ({ roomId: r }) },
    send_message: {
      event: "send_message",
      payload: (r) => ({ roomId: r, content: "Hello from QA", messageType: "text" }),
    },
    message_seen: {
      event: "message_seen",
      payload: (r) => ({ roomId: r, messageId: "<paste-msg-id>" }),
    },
    add_reaction: {
      event: "add_reaction",
      payload: (r) => ({
        roomId: r,
        messageId: "<paste-msg-id>",
        reaction: "👍",
      }),
    },
    edit_message: {
      event: "edit_message",
      payload: (r) => ({
        roomId: r,
        messageId: "<paste-msg-id>",
        content: "edited",
      }),
    },
    get_online_users: {
      event: "get_online_users",
      payload: (r) => ({ roomId: r }),
    },
  };

  const callPresets = {
    "call:initiate (video)": {
      event: "call:initiate",
      payload: (r) => ({ roomId: r, type: "video" }),
    },
    "call:initiate (voice)": {
      event: "call:initiate",
      payload: (r) => ({ roomId: r, type: "voice" }),
    },
    "call:accept": {
      event: "call:accept",
      payload: () => ({ callId: "<paste-call-id>" }),
    },
    "call:reject": {
      event: "call:reject",
      payload: () => ({ callId: "<paste-call-id>" }),
    },
    "call:end": {
      event: "call:end",
      payload: () => ({ callId: "<paste-call-id>" }),
    },
    "call:toggle-audio": {
      event: "call:toggle-audio",
      payload: () => ({ callId: "<paste-call-id>", isMuted: true }),
    },
    "call:toggle-video": {
      event: "call:toggle-video",
      payload: () => ({ callId: "<paste-call-id>", isCameraOff: true }),
    },
    "call:raise-hand": {
      event: "call:raise-hand",
      payload: () => ({ callId: "<paste-call-id>" }),
    },
    "call:lower-hand (self)": {
      event: "call:lower-hand",
      payload: () => ({ callId: "<paste-call-id>" }),
    },
    "call:chat:send": {
      event: "call:chat:send",
      payload: () => ({ callId: "<paste-call-id>", text: "in-call chat msg" }),
    },
    "call:mention": {
      event: "call:mention",
      payload: () => ({
        callId: "<paste-call-id>",
        targetUserId: "<paste-user-id>",
        text: "Can you elaborate?",
      }),
    },
  };

  // ── Layout: 2-col grid ───────────────────────────────────
  const grid = el("div", { class: "grid grid-cols-1 lg:grid-cols-2 gap-4" }, [
    namespacePanel({
      title: "Chat sockets",
      ns: "/chat",
      presetEvents: chatPresets,
      presetPayload: "",
      logHost: STATE.chatLogEl,
      notifLog: STATE.notifLogEl,
    }),
    namespacePanel({
      title: "Call sockets",
      ns: "/call",
      presetEvents: callPresets,
      presetPayload: "",
      logHost: STATE.callLogEl,
      notifLog: STATE.notifLogEl,
    }),
  ]);
  host.appendChild(grid);

  // ── Notifications column ─────────────────────────────────
  host.appendChild(
    card(
      el("span", {}, [
        "Notifications inbox",
        el(
          "span",
          { class: "ml-2 text-xs text-slate-500" },
          "live — every `notification` event from any namespace",
        ),
      ]),
      el("div", {}, [
        row(
          button("Clear", () => clearLog(STATE.notifLogEl), "ghost"),
          button(
            "GET /notifications (REST)",
            async () => {
              const { api } = await import("../api/client.js");
              const r = await api("/notifications");
              pushLog(STATE.notifLogEl, "GET /notifications", r.body);
            },
            "ghost",
          ),
        ),
        STATE.notifLogEl,
      ]),
    ),
  );
}
