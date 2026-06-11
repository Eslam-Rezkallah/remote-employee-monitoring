/**
 * tests/qa-frontend/api/socket-client.js
 *
 * Reusable Socket.IO client with simple connect/disconnect/emit/listen
 * helpers. Wraps connection state + event log so the QA Socket page
 * can render everything without re-implementing the plumbing.
 */

import { getBaseUrl, getToken } from "./client.js";

const handlers = new Map(); // namespace → Set<(eventName, payload) => void>

const connections = new Map(); // namespace → socket instance

export function connect(namespace = "/chat") {
  if (connections.has(namespace)) return connections.get(namespace);
  const token = getToken();
  if (!token) throw new Error("No accessToken — log in first");

  // eslint-disable-next-line no-undef
  const sock = io(getBaseUrl() + namespace, {
    auth: { authorization: `Bearer ${token}` },
    transports: ["websocket", "polling"],
  });

  // Bubble EVERY incoming event to listeners — for the QA viewer.
  sock.onAny((eventName, ...args) => {
    const set = handlers.get(namespace);
    if (set) set.forEach((fn) => fn(eventName, args.length <= 1 ? args[0] : args));
  });

  ["connect", "disconnect", "connect_error"].forEach((e) => {
    sock.on(e, (...args) => {
      const set = handlers.get(namespace);
      if (set) set.forEach((fn) => fn(e, args[0]));
    });
  });

  connections.set(namespace, sock);
  return sock;
}

export function disconnect(namespace = "/chat") {
  const sock = connections.get(namespace);
  if (sock) {
    sock.disconnect();
    connections.delete(namespace);
  }
}

export function disconnectAll() {
  for (const sock of connections.values()) sock.disconnect();
  connections.clear();
}

export function isConnected(namespace = "/chat") {
  const sock = connections.get(namespace);
  return !!sock && sock.connected;
}

export function emit(namespace, event, payload) {
  const sock = connections.get(namespace);
  if (!sock) throw new Error(`Not connected to ${namespace}`);
  sock.emit(event, payload);
}

/**
 * Subscribe to ALL events on a namespace. The handler receives
 * (eventName, payload). Returns an unsubscribe fn.
 */
export function onAny(namespace, fn) {
  let set = handlers.get(namespace);
  if (!set) {
    set = new Set();
    handlers.set(namespace, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}
