import { api, setSession, clearSession, getUser } from "../api/client.js";
import {
  card,
  row,
  input,
  button,
  el,
  runWithPanel,
} from "../components/ui.js";

export async function render(host) {
  const user = getUser();

  // ── Login card ─────────────────────────────────────────────
  const loginOut = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  const loginCard = card(
    "Login",
    el("div", {}, [
      row(
        input("loginEmail", "email", user?.email || ""),
        input("loginPassword", "password", "", { type: "password" }),
        button("Login", async () => {
          const payload = {
            email: document.getElementById("loginEmail").value.trim(),
            password: document.getElementById("loginPassword").value,
          };
          const r = await runWithPanel(
            loginOut,
            { method: "POST", url: "/auth/login", payload },
            () => api("/auth/login", { method: "POST", body: payload }),
          );
          if (r?.ok && r.body?.data?.accessToken) {
            setSession(
              r.body.data.accessToken,
              r.body.data.refreshToken,
              r.body.data.user,
            );
            window.dispatchEvent(new Event("storage"));
          }
        }, "success"),
        button("Logout", async () => {
          clearSession();
          window.dispatchEvent(new Event("storage"));
        }, "danger"),
      ),
      loginOut,
    ]),
  );

  // ── Signup card ────────────────────────────────────────────
  const signupOut = el("div", {
    class: "border rounded p-2 min-h-[60px] mt-2",
  });
  const signupCard = card(
    "Signup",
    el("div", {}, [
      row(
        input("suUsername", "username"),
        input("suEmail", "email"),
        input("suPassword", "password", "", { type: "password" }),
        input("suConfirm", "confirm", "", { type: "password" }),
        button("Signup", async () => {
          const payload = {
            username: document.getElementById("suUsername").value.trim(),
            email: document.getElementById("suEmail").value.trim(),
            password: document.getElementById("suPassword").value,
            confirmPassword: document.getElementById("suConfirm").value,
          };
          await runWithPanel(
            signupOut,
            { method: "POST", url: "/auth/signup", payload },
            () => api("/auth/signup", { method: "POST", body: payload }),
          );
        }),
      ),
      signupOut,
    ]),
  );

  // ── Confirm email card ─────────────────────────────────────
  const confirmOut = el("div", {
    class: "border rounded p-2 min-h-[60px] mt-2",
  });
  const confirmCard = card(
    "Confirm email (OTP from inbox)",
    el("div", {}, [
      row(
        input("ceEmail", "email"),
        input("ceCode", "OTP code"),
        button("Confirm", async () => {
          const payload = {
            email: document.getElementById("ceEmail").value.trim(),
            otp: document.getElementById("ceCode").value.trim(),
          };
          await runWithPanel(
            confirmOut,
            { method: "PATCH", url: "/auth/confirm-email", payload },
            () =>
              api("/auth/confirm-email", { method: "PATCH", body: payload }),
          );
        }),
      ),
      confirmOut,
    ]),
  );

  // ── Forgot / reset password ────────────────────────────────
  const fpOut = el("div", { class: "border rounded p-2 min-h-[60px] mt-2" });
  const fpCard = card(
    "Forgot / reset password",
    el("div", {}, [
      row(
        input("fpEmail", "email"),
        button("Request OTP", async () => {
          const payload = {
            email: document.getElementById("fpEmail").value.trim(),
          };
          await runWithPanel(
            fpOut,
            { method: "PATCH", url: "/auth/forget-password", payload },
            () =>
              api("/auth/forget-password", { method: "PATCH", body: payload }),
          );
        }),
        input("fpCode", "OTP"),
        button("Validate OTP", async () => {
          const payload = {
            email: document.getElementById("fpEmail").value.trim(),
            code: document.getElementById("fpCode").value.trim(),
          };
          await runWithPanel(
            fpOut,
            { method: "PATCH", url: "/auth/validate-forget-password", payload },
            () =>
              api("/auth/validate-forget-password", {
                method: "PATCH",
                body: payload,
              }),
          );
        }),
        input("fpNew", "new password", "", { type: "password" }),
        button("Reset", async () => {
          const payload = {
            email: document.getElementById("fpEmail").value.trim(),
            password: document.getElementById("fpNew").value,
          };
          await runWithPanel(
            fpOut,
            { method: "PATCH", url: "/auth/reset-password", payload },
            () =>
              api("/auth/reset-password", { method: "PATCH", body: payload }),
          );
        }),
      ),
      fpOut,
    ]),
  );

  // ── Health checks ──────────────────────────────────────────
  const healthOut = el("div", {
    class: "border rounded p-2 min-h-[60px] mt-2",
  });
  const healthCard = card(
    "Health",
    el("div", {}, [
      row(
        button(
          "GET /healthz",
          async () => {
            await runWithPanel(
              healthOut,
              { method: "GET", url: "/healthz" },
              () => api("/healthz"),
            );
          },
          "ghost",
        ),
        button(
          "GET /readyz",
          async () => {
            await runWithPanel(
              healthOut,
              { method: "GET", url: "/readyz" },
              () => api("/readyz"),
            );
          },
          "ghost",
        ),
        button(
          "GET /metrics",
          async () => {
            await runWithPanel(
              healthOut,
              { method: "GET", url: "/metrics" },
              () => api("/metrics"),
            );
          },
          "ghost",
        ),
      ),
      healthOut,
    ]),
  );

  host.appendChild(loginCard);
  host.appendChild(signupCard);
  host.appendChild(confirmCard);
  host.appendChild(fpCard);
  host.appendChild(healthCard);
}
