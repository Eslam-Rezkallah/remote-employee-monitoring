/**
 * Calls page — REST-side of voice/video calls:
 *   call history, active call lookup, LiveKit token,
 *   recording start/stop/download.
 *
 * The live signalling (initiate / accept / reject / raise-hand /
 * in-call chat / in-call mention) is on the Realtime tab — open both
 * to test the full ringing-through-recording flow.
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
  // ── 1. History + active ───────────────────────────────────
  const out1 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "1. Call history + active",
      [
        input("calRoom", "roomId"),
        button("GET /calls", async () => {
          const r = document.getElementById("calRoom").value.trim();
          await runWithPanel(
            out1,
            { method: "GET", url: `/chat/rooms/${r}/calls` },
            () => api(`/chat/rooms/${r}/calls`),
          );
        }),
        button("GET /calls/active", async () => {
          const r = document.getElementById("calRoom").value.trim();
          await runWithPanel(
            out1,
            { method: "GET", url: `/chat/rooms/${r}/calls/active` },
            () => api(`/chat/rooms/${r}/calls/active`),
          );
        }),
        input("calCallId", "callId (for detail)"),
        button("GET /calls/:id", async () => {
          const r = document.getElementById("calRoom").value.trim();
          const c = document.getElementById("calCallId").value.trim();
          await runWithPanel(
            out1,
            { method: "GET", url: `/chat/rooms/${r}/calls/${c}` },
            () => api(`/chat/rooms/${r}/calls/${c}`),
          );
        }),
      ],
      out1,
    ),
  );

  // ── 2. LiveKit token ──────────────────────────────────────
  const out2 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "2. LiveKit join token (POST /calls/:callId/livekit-token)",
      [
        input("lkRoom", "roomId"),
        input("lkCall", "callId"),
        input("lkDevice", "deviceId", "web-1"),
        button("POST token", async () => {
          const r = document.getElementById("lkRoom").value.trim();
          const c = document.getElementById("lkCall").value.trim();
          const payload = {
            deviceId: document.getElementById("lkDevice").value,
          };
          await runWithPanel(
            out2,
            {
              method: "POST",
              url: `/chat/rooms/${r}/calls/${c}/livekit-token`,
              payload,
            },
            () =>
              api(`/chat/rooms/${r}/calls/${c}/livekit-token`, {
                method: "POST",
                body: payload,
              }),
          );
        }, "success"),
      ],
      out2,
    ),
  );

  // ── 3. Recording ──────────────────────────────────────────
  const out3 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "3. Recording (start / stop / download URL)",
      [
        input("recRoom", "roomId"),
        input("recCall", "callId"),
        button("Start", async () => {
          const r = document.getElementById("recRoom").value.trim();
          const c = document.getElementById("recCall").value.trim();
          await runWithPanel(
            out3,
            { method: "POST", url: `/chat/rooms/${r}/calls/${c}/recording` },
            () =>
              api(`/chat/rooms/${r}/calls/${c}/recording`, { method: "POST" }),
          );
        }, "success"),
        button("Stop", async () => {
          const r = document.getElementById("recRoom").value.trim();
          const c = document.getElementById("recCall").value.trim();
          await runWithPanel(
            out3,
            { method: "DELETE", url: `/chat/rooms/${r}/calls/${c}/recording` },
            () =>
              api(`/chat/rooms/${r}/calls/${c}/recording`, {
                method: "DELETE",
              }),
          );
        }, "danger"),
        button("Download URL", async () => {
          const r = document.getElementById("recRoom").value.trim();
          const c = document.getElementById("recCall").value.trim();
          await runWithPanel(
            out3,
            {
              method: "GET",
              url: `/chat/rooms/${r}/calls/${c}/recording/download`,
            },
            () => api(`/chat/rooms/${r}/calls/${c}/recording/download`),
          );
        }),
      ],
      out3,
    ),
  );

  // Note about in-meeting features
  host.appendChild(
    card(
      "4. Raise hand / in-call chat / mention",
      el("div", { class: "text-sm text-slate-600 space-y-1" }, [
        el("div", {}, [
          el("strong", {}, "Where: "),
          "All four happen on the ",
          el("code", { class: "bg-slate-100 px-1" }, "/call"),
          " socket namespace — open the ",
          el("strong", {}, "Realtime"),
          " tab and use the call-namespace presets:",
        ]),
        el("ul", { class: "list-disc ml-6" }, [
          el("li", {}, [el("code", {}, "call:initiate"), " → ringing starts"]),
          el("li", {}, [el("code", {}, "call:accept / call:reject")]),
          el("li", {}, [el("code", {}, "call:raise-hand / call:lower-hand")]),
          el("li", {}, [el("code", {}, "call:chat:send"), " → ephemeral meeting chat"]),
          el("li", {}, [el("code", {}, "call:mention"), " → in-meeting @mention"]),
          el("li", {}, [el("code", {}, "call:toggle-audio / call:toggle-video")]),
          el("li", {}, [el("code", {}, "call:end")]),
        ]),
      ]),
    ),
  );
}
