/**
 * Messages page — REST-side of chat:
 *   send, list, edit, delete, forward, search,
 *   reactions, threads, pin, save (bookmark),
 *   read receipts (mark seen / delivered),
 *   mentions inbox.
 *
 * Real-time push of these (typing, new message arriving, reaction added,
 * etc.) is on the Realtime tab — open both in parallel for end-to-end QA.
 */

import { api } from "../api/client.js";
import {
  card,
  row,
  input,
  button,
  el,
  runWithPanel,
} from "../components/ui.js";

const featureRow = (title, rowKids, panel) =>
  card(title, el("div", {}, [row(...rowKids), panel]));

export async function render(host) {
  // ── 1. Send + list + search ───────────────────────────────
  const out1 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "1. Send / list / search",
      [
        input("msgRoom", "roomId"),
        input(
          "msgContent",
          "content (try /shrug, /me dances, /remind in 1m text)",
          "",
          { class: "flex-[3]" },
        ),
        button("POST send", async () => {
          const r = document.getElementById("msgRoom").value.trim();
          const payload = {
            content: document.getElementById("msgContent").value,
            messageType: "text",
          };
          await runWithPanel(
            out1,
            { method: "POST", url: `/chat/rooms/${r}/messages`, payload },
            () =>
              api(`/chat/rooms/${r}/messages`, {
                method: "POST",
                body: payload,
              }),
          );
        }, "success"),
        button("GET list (last 30)", async () => {
          const r = document.getElementById("msgRoom").value.trim();
          await runWithPanel(
            out1,
            { method: "GET", url: `/chat/rooms/${r}/messages` },
            () => api(`/chat/rooms/${r}/messages`),
          );
        }),
        button("Search ?q=", async () => {
          const r = document.getElementById("msgRoom").value.trim();
          const q = prompt("Search query");
          if (!q) return;
          await runWithPanel(
            out1,
            {
              method: "GET",
              url: `/chat/rooms/${r}/messages/search`,
              payload: { q },
            },
            () => api(`/chat/rooms/${r}/messages/search`, { query: { q } }),
          );
        }),
      ],
      out1,
    ),
  );

  // ── 2. Edit / delete / forward ────────────────────────────
  const out2 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "2. Edit / delete / forward",
      [
        input("edRoom", "roomId"),
        input("edMsg", "messageId"),
        input("edText", "new content"),
        button("PATCH edit", async () => {
          const r = document.getElementById("edRoom").value.trim();
          const m = document.getElementById("edMsg").value.trim();
          const payload = { content: document.getElementById("edText").value };
          await runWithPanel(
            out2,
            { method: "PATCH", url: `/chat/rooms/${r}/messages/${m}`, payload },
            () =>
              api(`/chat/rooms/${r}/messages/${m}`, {
                method: "PATCH",
                body: payload,
              }),
          );
        }),
        button("DELETE for me", async () => {
          const r = document.getElementById("edRoom").value.trim();
          const m = document.getElementById("edMsg").value.trim();
          await runWithPanel(
            out2,
            { method: "DELETE", url: `/chat/rooms/${r}/messages/${m}?deleteType=me` },
            () =>
              api(`/chat/rooms/${r}/messages/${m}?deleteType=me`, {
                method: "DELETE",
              }),
          );
        }, "danger"),
        button("DELETE everyone", async () => {
          const r = document.getElementById("edRoom").value.trim();
          const m = document.getElementById("edMsg").value.trim();
          await runWithPanel(
            out2,
            { method: "DELETE", url: `/chat/rooms/${r}/messages/${m}?deleteType=everyone` },
            () =>
              api(`/chat/rooms/${r}/messages/${m}?deleteType=everyone`, {
                method: "DELETE",
              }),
          );
        }, "danger"),
        input("fwTargetRoom", "target roomId (forward)"),
        button("POST forward", async () => {
          const m = document.getElementById("edMsg").value.trim();
          const target = document.getElementById("fwTargetRoom").value.trim();
          const payload = { sourceMessageId: m };
          await runWithPanel(
            out2,
            {
              method: "POST",
              url: `/chat/rooms/${target}/messages/forward`,
              payload,
            },
            () =>
              api(`/chat/rooms/${target}/messages/forward`, {
                method: "POST",
                body: payload,
              }),
          );
        }),
      ],
      out2,
    ),
  );

  // ── 3. Read receipts ──────────────────────────────────────
  const out3 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "3. Read receipts (seen / delivered)",
      [
        input("rrRoom", "roomId"),
        input("rrMsg", "messageId"),
        button("Mark seen", async () => {
          const r = document.getElementById("rrRoom").value.trim();
          const m = document.getElementById("rrMsg").value.trim();
          await runWithPanel(
            out3,
            { method: "PATCH", url: `/chat/rooms/${r}/messages/${m}/seen` },
            () =>
              api(`/chat/rooms/${r}/messages/${m}/seen`, { method: "PATCH" }),
          );
        }, "success"),
        button("Mark delivered", async () => {
          const r = document.getElementById("rrRoom").value.trim();
          const m = document.getElementById("rrMsg").value.trim();
          await runWithPanel(
            out3,
            { method: "PATCH", url: `/chat/rooms/${r}/messages/${m}/delivered` },
            () =>
              api(`/chat/rooms/${r}/messages/${m}/delivered`, {
                method: "PATCH",
              }),
          );
        }),
      ],
      out3,
    ),
  );

  // ── 4. Reactions ──────────────────────────────────────────
  const out4 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "4. Reactions",
      [
        input("rxRoom", "roomId"),
        input("rxMsg", "messageId"),
        input("rxEmoji", "reaction (e.g. 👍)"),
        button("Add", async () => {
          const r = document.getElementById("rxRoom").value.trim();
          const m = document.getElementById("rxMsg").value.trim();
          const payload = { reaction: document.getElementById("rxEmoji").value };
          await runWithPanel(
            out4,
            {
              method: "POST",
              url: `/chat/rooms/${r}/messages/${m}/reactions`,
              payload,
            },
            () =>
              api(`/chat/rooms/${r}/messages/${m}/reactions`, {
                method: "POST",
                body: payload,
              }),
          );
        }, "success"),
        button("Remove", async () => {
          const r = document.getElementById("rxRoom").value.trim();
          const m = document.getElementById("rxMsg").value.trim();
          await runWithPanel(
            out4,
            {
              method: "DELETE",
              url: `/chat/rooms/${r}/messages/${m}/reactions`,
            },
            () =>
              api(`/chat/rooms/${r}/messages/${m}/reactions`, {
                method: "DELETE",
              }),
          );
        }, "danger"),
      ],
      out4,
    ),
  );

  // ── 5. Threads ────────────────────────────────────────────
  const out5 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "5. Threads (reply + list)",
      [
        input("thRoom", "roomId"),
        input("thMsg", "parent messageId"),
        input("thReply", "reply text"),
        button("Reply", async () => {
          const r = document.getElementById("thRoom").value.trim();
          const m = document.getElementById("thMsg").value.trim();
          const payload = {
            content: document.getElementById("thReply").value,
            replyTo: m,
          };
          await runWithPanel(
            out5,
            { method: "POST", url: `/chat/rooms/${r}/messages`, payload },
            () =>
              api(`/chat/rooms/${r}/messages`, {
                method: "POST",
                body: payload,
              }),
          );
        }, "success"),
        button("List thread", async () => {
          const r = document.getElementById("thRoom").value.trim();
          const m = document.getElementById("thMsg").value.trim();
          await runWithPanel(
            out5,
            { method: "GET", url: `/chat/rooms/${r}/messages/${m}/thread` },
            () => api(`/chat/rooms/${r}/messages/${m}/thread`),
          );
        }),
      ],
      out5,
    ),
  );

  // ── 6. Mentions inbox ─────────────────────────────────────
  const out6 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "6. Mentions inbox (GET /me/mentions)",
      [
        button("Refresh", async () =>
          runWithPanel(out6, { method: "GET", url: "/me/mentions" }, () =>
            api("/me/mentions"),
          ),
        ),
      ],
      out6,
    ),
  );

  // ── 7. Pin / Save ─────────────────────────────────────────
  const out7 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "7. Pin / unpin / save / unsave",
      [
        input("psRoom", "roomId"),
        input("psMsg", "messageId"),
        button("Pin", async () => {
          const r = document.getElementById("psRoom").value.trim();
          const m = document.getElementById("psMsg").value.trim();
          await runWithPanel(
            out7,
            { method: "POST", url: `/chat/rooms/${r}/messages/${m}/pin` },
            () =>
              api(`/chat/rooms/${r}/messages/${m}/pin`, { method: "POST" }),
          );
        }, "success"),
        button("Unpin", async () => {
          const r = document.getElementById("psRoom").value.trim();
          const m = document.getElementById("psMsg").value.trim();
          await runWithPanel(
            out7,
            { method: "DELETE", url: `/chat/rooms/${r}/messages/${m}/pin` },
            () =>
              api(`/chat/rooms/${r}/messages/${m}/pin`, { method: "DELETE" }),
          );
        }, "danger"),
        button("List pinned", async () => {
          const r = document.getElementById("psRoom").value.trim();
          await runWithPanel(
            out7,
            { method: "GET", url: `/chat/rooms/${r}/messages/pinned` },
            () => api(`/chat/rooms/${r}/messages/pinned`),
          );
        }),
        button("Save", async () => {
          const r = document.getElementById("psRoom").value.trim();
          const m = document.getElementById("psMsg").value.trim();
          await runWithPanel(
            out7,
            { method: "POST", url: `/chat/rooms/${r}/messages/${m}/save`, payload: {} },
            () =>
              api(`/chat/rooms/${r}/messages/${m}/save`, {
                method: "POST",
                body: {},
              }),
          );
        }, "success"),
        button("Unsave", async () => {
          const r = document.getElementById("psRoom").value.trim();
          const m = document.getElementById("psMsg").value.trim();
          await runWithPanel(
            out7,
            { method: "DELETE", url: `/chat/rooms/${r}/messages/${m}/save` },
            () =>
              api(`/chat/rooms/${r}/messages/${m}/save`, { method: "DELETE" }),
          );
        }, "danger"),
        button("My saved", async () =>
          runWithPanel(out7, { method: "GET", url: "/me/saved-messages" }, () =>
            api("/me/saved-messages"),
          ),
        ),
      ],
      out7,
    ),
  );

  // ── 8. Notifications inbox (REST) ─────────────────────────
  const out8 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "8. Notifications inbox (REST)",
      [
        button("GET /notifications", async () =>
          runWithPanel(out8, { method: "GET", url: "/notifications" }, () =>
            api("/notifications"),
          ),
        ),
      ],
      out8,
    ),
  );
}
