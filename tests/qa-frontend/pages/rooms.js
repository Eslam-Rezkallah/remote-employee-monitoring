/**
 * Rooms page — covers Channels, Direct Messages, and Group chats.
 * Everything you need to set up the entities the Messages + Sockets
 * pages then act on.
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
  // ── 1. List my rooms ──────────────────────────────────────
  const out1 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "1. My chat rooms (GET /chat/rooms)",
      [
        button("Refresh list", async () =>
          runWithPanel(out1, { method: "GET", url: "/chat/rooms" }, () =>
            api("/chat/rooms"),
          ),
        ),
        button("Unread counts", async () =>
          runWithPanel(
            out1,
            { method: "GET", url: "/chat/rooms/unread-counts" },
            () => api("/chat/rooms/unread-counts"),
          ),
        ),
      ],
      out1,
    ),
  );

  // ── 2. Get / update a room ────────────────────────────────
  const out2 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "2. Get room / update branding",
      [
        input("rrId", "roomId"),
        button("GET room", async () => {
          const r = document.getElementById("rrId").value.trim();
          await runWithPanel(
            out2,
            { method: "GET", url: `/chat/rooms/${r}` },
            () => api(`/chat/rooms/${r}`),
          );
        }),
        input("rrName", "new name"),
        input("rrDesc", "new description"),
        input("rrColor", "branding color #RRGGBB"),
        input("rrTopic", "branding topic"),
        button("PATCH update", async () => {
          const r = document.getElementById("rrId").value.trim();
          const payload = {
            name: document.getElementById("rrName").value || undefined,
            description: document.getElementById("rrDesc").value || undefined,
            branding: {
              color: document.getElementById("rrColor").value || undefined,
              topic: document.getElementById("rrTopic").value || undefined,
            },
          };
          await runWithPanel(
            out2,
            { method: "PATCH", url: `/chat/rooms/${r}`, payload },
            () => api(`/chat/rooms/${r}`, { method: "PATCH", body: payload }),
          );
        }, "success"),
      ],
      out2,
    ),
  );

  // ── 3. Direct message ─────────────────────────────────────
  const out3 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "3. Direct message (POST /chat/rooms/direct)",
      [
        input("dmTarget", "targetUserId"),
        button("Create / find DM", async () => {
          const payload = {
            targetUserId: document.getElementById("dmTarget").value.trim(),
          };
          await runWithPanel(
            out3,
            { method: "POST", url: "/chat/rooms/direct", payload },
            () => api("/chat/rooms/direct", { method: "POST", body: payload }),
          );
        }, "success"),
      ],
      out3,
    ),
  );

  // ── 4. Group chat ─────────────────────────────────────────
  const out4 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "4. Group chat (POST /chat/rooms/group)",
      [
        input("gName", "name"),
        input("gOrg", "organizationId"),
        input("gMembers", "memberIds (comma-separated)"),
        button("Create group", async () => {
          const payload = {
            name: document.getElementById("gName").value.trim(),
            organizationId: document.getElementById("gOrg").value.trim(),
            memberIds: document
              .getElementById("gMembers")
              .value.split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          };
          await runWithPanel(
            out4,
            { method: "POST", url: "/chat/rooms/group", payload },
            () => api("/chat/rooms/group", { method: "POST", body: payload }),
          );
        }, "success"),
      ],
      out4,
    ),
  );

  // ── 5. Channel ────────────────────────────────────────────
  const out5 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "5. Channel (POST /chat/rooms/channel)",
      [
        input("cName", "channel name"),
        input("cOrg", "organizationId"),
        input("cTeam", "teamId (optional)"),
        button("Create channel", async () => {
          const payload = {
            name: document.getElementById("cName").value.trim(),
            organizationId: document.getElementById("cOrg").value.trim() || undefined,
            teamId: document.getElementById("cTeam").value.trim() || undefined,
            isPrivate: false,
          };
          await runWithPanel(
            out5,
            { method: "POST", url: "/chat/rooms/channel", payload },
            () => api("/chat/rooms/channel", { method: "POST", body: payload }),
          );
        }, "success"),
      ],
      out5,
    ),
  );

  // ── 6. Membership ────────────────────────────────────────
  const out6 = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  host.appendChild(
    featureRow(
      "6. Membership (join / leave / add / remove)",
      [
        input("mmRoom", "roomId"),
        input("mmMember", "memberId (for add/remove)"),
        button("Join", async () => {
          const r = document.getElementById("mmRoom").value.trim();
          await runWithPanel(
            out6,
            { method: "POST", url: `/chat/rooms/${r}/join` },
            () => api(`/chat/rooms/${r}/join`, { method: "POST" }),
          );
        }, "success"),
        button("Leave", async () => {
          const r = document.getElementById("mmRoom").value.trim();
          await runWithPanel(
            out6,
            { method: "DELETE", url: `/chat/rooms/${r}/leave` },
            () => api(`/chat/rooms/${r}/leave`, { method: "DELETE" }),
          );
        }, "danger"),
        button("Add member", async () => {
          const r = document.getElementById("mmRoom").value.trim();
          const m = document.getElementById("mmMember").value.trim();
          await runWithPanel(
            out6,
            { method: "POST", url: `/chat/rooms/${r}/members/${m}` },
            () =>
              api(`/chat/rooms/${r}/members/${m}`, { method: "POST" }),
          );
        }),
        button("Remove member", async () => {
          const r = document.getElementById("mmRoom").value.trim();
          const m = document.getElementById("mmMember").value.trim();
          await runWithPanel(
            out6,
            { method: "DELETE", url: `/chat/rooms/${r}/members/${m}` },
            () =>
              api(`/chat/rooms/${r}/members/${m}`, { method: "DELETE" }),
          );
        }, "danger"),
      ],
      out6,
    ),
  );
}
