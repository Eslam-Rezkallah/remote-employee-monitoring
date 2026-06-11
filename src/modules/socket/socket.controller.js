import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { logoutSocketId, registerSocket } from "./service/auth.service.js";
import { registerChatSocket } from "./service/chat.socket.js";
import { registerCallSocket } from "./service/call.socket.js";
import { getPubClient, getSubClient } from "../../utils/redis/client.js";
import { config } from "../../config/index.js";
import { childLogger } from "../../utils/logger/logger.js";
import { setNotificationTransport } from "../../utils/events/notification.event.js";

const log = childLogger("socket");

let io = undefined;
let chatNs = undefined;
let callNs = undefined;

export const runIo = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: config.app.frontendUrl,
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 10e6,
  });

  // ── Redis adapter (multi-instance support) ────────────────
  if (config.redis.enabled) {
    const pub = getPubClient();
    const sub = getSubClient();
    if (pub && sub) {
      io.adapter(createAdapter(pub, sub));
      log.info("Socket.IO Redis adapter enabled");
    }
  } else {
    log.warn("Socket.IO running without Redis adapter — single-instance only");
  }

  chatNs = io.of("/chat");
  registerChatSocket(chatNs);

  callNs = io.of("/call");
  registerCallSocket(callNs);

  // ── /admin namespace: real-time activity stream for managers ─
  // Admins join `org:<orgId>` rooms. The activity-event upload
  // endpoint broadcasts batch summaries here so manager dashboards
  // update without polling.
  const adminNs = io.of("/admin");
  adminNs.use(async (socket, next) => {
    // Reuse the same socket auth as the other namespaces.
    const { authentication } = await import(
      "../../middleware/socket/auth.middleware.js"
    );
    const { data, valid } = await authentication({ socket });
    if (!valid) return next(new Error(data?.message || "Unauthorized"));
    socket.user = data.user;
    return next();
  });
  adminNs.on("connection", (socket) => {
    // Client tells the server which orgs to subscribe to. The server
    // verifies admin/owner membership before joining the room — a
    // regular member can't eavesdrop on monitoring even if they fake
    // the event payload.
    socket.on("admin:subscribe", async ({ orgId }) => {
      try {
        const memberModel = (
          await import("../../DB/Model/member.model.js")
        ).default;
        const m = await memberModel.findOne({
          organizationId: orgId,
          userId: socket.user._id,
          isActive: true,
        });
        if (!m || !["owner", "admin"].includes(m.role)) {
          socket.emit("admin:error", {
            message: "Not an org admin",
            code: 403,
          });
          return;
        }
        socket.join(`org:${orgId}`);
        socket.emit("admin:subscribed", { orgId });
      } catch (err) {
        socket.emit("admin:error", { message: err.message, code: 500 });
      }
    });
  });

  // Inverted dependency: register THIS module as the realtime transport
  // for the notification utility. The utility layer must not import from
  // modules/, so we push the binding the other way.
  setNotificationTransport((room, event, payload) => {
    chatNs.to(room).emit(event, payload);
  });
  log.info("notification transport bound to /chat namespace");

  io.on("connection", async (socket) => {
    await registerSocket(socket);
    await logoutSocketId(socket);
  });
};

export const getIo = () => io;
export const getChatNamespace = () => chatNs;
export const getCallNamespace = () => callNs;
