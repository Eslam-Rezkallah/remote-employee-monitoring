/* ============================================================
   CONFIG
============================================================ */
const BASE_URL = "http://localhost:3000";

/* ============================================================
   AUTH GUARD
============================================================ */
const token = localStorage.getItem("token");
if (!token) {
  window.location.href = "login.html";
}

const MY_ID = localStorage.getItem("userId") || "";
const MY_USERNAME = localStorage.getItem("username") || "Me";

/* ============================================================
   AXIOS INSTANCE
============================================================ */
const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
    authorization: token,
  },
});

/* ============================================================
   SOCKET.IO — connect to /chat namespace
============================================================ */
const socket = io(`${BASE_URL}/chat`, {
  auth: { authorization: token },
  reconnection: true,
  reconnectionAttempts: 5,
});

/* ============================================================
   STATE
============================================================ */
let allRooms = []; // all rooms fetched from API
let currentRoomId = null; // active room _id
let currentRoom = null; // active room object
let replyToMsg = null; // message being replied to
let typingTimer = null; // debounce timer for typing
let allOrgMembers = []; // for DM search

/* ============================================================
   INIT
============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  loadRooms();
  loadOrgMembers();
  setupInputHandlers();
  document.getElementById("logoutBtn").onclick = logout;
});

/* ============================================================
   LOGOUT
============================================================ */
function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

/* ============================================================
   LOAD ROOMS
============================================================ */
async function loadRooms() {
  try {
    const res = await api.get("/chat/rooms?limit=50");
    allRooms = res.data.data.rooms || [];
    renderRoomList(allRooms);
  } catch (err) {
    console.error("loadRooms error:", err.response?.data || err.message);
    document.getElementById("roomList").innerHTML =
      `<div style="color:#c0392b; text-align:center; padding:20px; font-size:13px;">Failed to load rooms</div>`;
  }
}

/* ============================================================
   RENDER ROOM LIST
============================================================ */
function renderRoomList(rooms) {
  const container = document.getElementById("roomList");
  if (!rooms.length) {
    container.innerHTML = `<div style="text-align:center; color:#718096; padding:20px; font-size:13px;">No rooms yet.<br/>Start a DM below 👇</div>`;
    return;
  }

  container.innerHTML = "";
  rooms.forEach((room) => {
    const div = document.createElement("div");
    div.className = `roomItem${room._id === currentRoomId ? " active" : ""}`;
    div.dataset.roomId = room._id;

    // Room display name
    const name = getRoomDisplayName(room);
    // Avatar letter
    const letter = name.replace("#", "").charAt(0).toUpperCase();
    // Last message preview
    const preview = room.lastMessage?.content
      ? room.lastMessage.content.length > 35
        ? room.lastMessage.content.slice(0, 35) + "..."
        : room.lastMessage.content
      : "No messages yet";

    div.innerHTML = `
      <div class="roomAvatar">${letter}</div>
      <div class="roomInfo">
        <div class="roomName">${name}</div>
        <div class="roomPreview">${preview}</div>
      </div>
    `;
    div.onclick = () => openRoom(room);
    container.appendChild(div);
  });
}

/* ============================================================
   GET DISPLAY NAME FOR ROOM
============================================================ */
function getRoomDisplayName(room) {
  if (room.type === "direct") {
    // Show the other person's name
    const other = room.members?.find((m) => m._id !== MY_ID);
    return other?.username || "Direct Message";
  }
  return room.name || `${room.type} room`;
}

/* ============================================================
   FILTER ROOMS (search)
============================================================ */
function filterRooms(query) {
  const q = query.toLowerCase();
  const filtered = allRooms.filter((r) =>
    getRoomDisplayName(r).toLowerCase().includes(q),
  );
  renderRoomList(filtered);
}

/* ============================================================
   SWITCH SIDEBAR TAB
============================================================ */
function switchTab(type) {
  document
    .querySelectorAll(".sideTab")
    .forEach((t) => t.classList.remove("active"));
  event.target.classList.add("active");

  const filtered =
    type === "all" ? allRooms : allRooms.filter((r) => r.type === type);
  renderRoomList(filtered);
}

/* ============================================================
   OPEN ROOM
============================================================ */
async function openRoom(room) {
  currentRoomId = room._id;
  currentRoom = room;

  // Update sidebar active state
  document.querySelectorAll(".roomItem").forEach((el) => {
    el.classList.toggle("active", el.dataset.roomId === room._id);
  });

  // Update header
  document.getElementById("chatHeaderName").textContent =
    getRoomDisplayName(room);
  document.getElementById("chatHeaderAvatar").textContent = getRoomDisplayName(
    room,
  )
    .replace("#", "")
    .charAt(0)
    .toUpperCase();
  document.getElementById("chatHeaderSub").textContent =
    `${room.members?.length || 0} members · ${room.type}`;
  document.getElementById("currentRoomName").textContent =
    getRoomDisplayName(room);

  // Show chat area
  document.getElementById("chatArea").style.display = "flex";
  document.getElementById("noRoom").style.display = "none";

  // Join socket room
  socket.emit("join_room", { roomId: room._id });

  // Load messages
  await loadMessages(room._id);
}

/* ============================================================
   LOAD MESSAGES
============================================================ */
async function loadMessages(roomId, before = null) {
  try {
    const params = `?limit=50${before ? `&before=${before}` : ""}`;
    const res = await api.get(`/chat/rooms/${roomId}/messages${params}`);
    const msgs = res.data.data.messages || [];

    const list = document.getElementById("messageList");
    list.innerHTML = "";

    if (!msgs.length) {
      list.innerHTML = `<div style="text-align:center;color:#4a5568;padding:40px;font-size:14px;">No messages yet. Say hello! 👋</div>`;
      return;
    }

    msgs.forEach((msg) => appendMessage(msg, false));
    scrollToBottom();

    // Mark all as seen
    if (msgs.length) {
      const lastId = msgs[msgs.length - 1]._id;
      socket.emit("message_seen", { roomId, messageId: lastId });
    }
  } catch (err) {
    console.error("loadMessages error:", err.response?.data || err.message);
  }
}

/* ============================================================
   RENDER A SINGLE MESSAGE
============================================================ */
function appendMessage(msg, scroll = true) {
  const list = document.getElementById("messageList");
  const isMine = msg.senderId?._id === MY_ID || msg.senderId === MY_ID;

  const wrapper = document.createElement("div");
  wrapper.className = `msgRow ${isMine ? "mine" : "theirs"}`;
  wrapper.dataset.msgId = msg._id;

  // Avatar
  const senderName = msg.senderId?.username || MY_USERNAME;
  const avatarLetter = senderName.charAt(0).toUpperCase();
  const avatarSrc = msg.senderId?.image?.secure_url;

  // Content
  let contentHTML = "";

  // Reply preview
  if (msg.replyTo) {
    const replyContent = msg.replyTo?.content || "Original message";
    contentHTML += `<div class="replyBubble">↩ ${replyContent}</div>`;
  }

  // Deleted?
  if (msg.deletedForEveryone) {
    contentHTML += `<span class="deletedMsg">🚫 This message was deleted</span>`;
  } else if (msg.messageType === "image" && msg.attachments?.length) {
    msg.attachments.forEach((att) => {
      contentHTML += `<img src="${att.url}" style="max-width:200px; border-radius:10px; display:block; margin-bottom:4px;" />`;
    });
    if (msg.content) contentHTML += `<div>${escapeHTML(msg.content)}</div>`;
  } else if (msg.messageType === "voice" && msg.attachments?.length) {
    msg.attachments.forEach((att) => {
      contentHTML += `<audio controls src="${att.url}" style="max-width:200px;"></audio>`;
    });
  } else if (msg.messageType === "file" && msg.attachments?.length) {
    msg.attachments.forEach((att) => {
      contentHTML += `<a href="${att.url}" target="_blank" style="color:#7c6af7;">📎 ${att.originalName || "File"}</a>`;
    });
    if (msg.content) contentHTML += `<div>${escapeHTML(msg.content)}</div>`;
  } else {
    contentHTML += escapeHTML(msg.content || "");
  }

  if (msg.edited && !msg.deletedForEveryone) {
    contentHTML += `<span class="editedTag">(edited)</span>`;
  }

  // Reactions
  let reactionsHTML = "";
  if (msg.reactions?.length) {
    const grouped = {};
    msg.reactions.forEach((r) => {
      const emoji = r.reaction || r;
      grouped[emoji] = (grouped[emoji] || 0) + 1;
    });
    reactionsHTML = `<div class="msgReactions">
      ${Object.entries(grouped)
        .map(
          ([emoji, count]) =>
            `<span class="reactionChip" onclick="addReaction('${msg._id}', '${emoji}')">${emoji} ${count}</span>`,
        )
        .join("")}
      <span class="reactionChip" onclick="showEmojiPicker('${msg._id}')">+</span>
    </div>`;
  } else {
    reactionsHTML = `<div class="msgReactions"><span class="reactionChip" onclick="showEmojiPicker('${msg._id}')">+</span></div>`;
  }

  // Timestamp
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  wrapper.innerHTML = `
    <div class="msgAvatar">${avatarSrc ? `<img src="${avatarSrc}" />` : avatarLetter}</div>
    <div>
      ${!isMine ? `<div class="msgSender">${senderName}</div>` : ""}
      <div class="msgBubble" ondblclick="setReply('${msg._id}', '${escapeHTML(msg.content || "").replace(/'/g, "\\'")}')">
        ${contentHTML}
      </div>
      ${reactionsHTML}
      <div class="msgMeta">${time}</div>
    </div>
  `;

  list.appendChild(wrapper);
  if (scroll) scrollToBottom();
}

/* ============================================================
   SEND MESSAGE
============================================================ */
function setupInputHandlers() {
  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    handleTyping();
  });

  // Enter to send (Shift+Enter = new line)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.onclick = sendMessage;
}

function sendMessage() {
  if (!currentRoomId) return;

  const input = document.getElementById("msgInput");
  const content = input.value.trim();
  if (!content) return;

  // Emit via socket
  socket.emit("send_message", {
    roomId: currentRoomId,
    content,
    messageType: "text",
    replyTo: replyToMsg?._id || null,
  });

  input.value = "";
  input.style.height = "auto";
  clearReply();
  stopTyping();
}

/* ============================================================
   TYPING INDICATOR
============================================================ */
function handleTyping() {
  if (!currentRoomId) return;
  socket.emit("typing", { roomId: currentRoomId });

  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  if (!currentRoomId) return;
  socket.emit("stop_typing", { roomId: currentRoomId });
}

/* ============================================================
   REPLY
============================================================ */
function setReply(msgId, content) {
  const msg = { _id: msgId, content };
  replyToMsg = msg;

  const preview = document.getElementById("replyPreview");
  document.getElementById("replyText").textContent =
    `↩ Replying to: "${content.slice(0, 60)}${content.length > 60 ? "..." : ""}"`;
  preview.classList.remove("hidden");

  document.getElementById("msgInput").focus();
}

function clearReply() {
  replyToMsg = null;
  document.getElementById("replyPreview").classList.add("hidden");
}

/* ============================================================
   REACTIONS
============================================================ */
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "😡"];

function showEmojiPicker(msgId) {
  // Remove existing picker
  document.querySelectorAll(".emojiBar").forEach((el) => el.remove());

  const wrapper = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!wrapper) return;

  const bar = document.createElement("div");
  bar.className = "emojiBar";
  EMOJIS.forEach((emoji) => {
    const span = document.createElement("span");
    span.textContent = emoji;
    span.onclick = () => {
      addReaction(msgId, emoji);
      bar.remove();
    };
    bar.appendChild(span);
  });

  wrapper.style.position = "relative";
  wrapper.appendChild(bar);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener("click", () => bar.remove(), { once: true });
  }, 100);
}

async function addReaction(msgId, reaction) {
  if (!currentRoomId) return;
  try {
    await api.post(`/chat/rooms/${currentRoomId}/messages/${msgId}/reactions`, {
      reaction,
    });
    // Socket will broadcast the update
  } catch (err) {
    console.error("addReaction error:", err.response?.data || err.message);
  }
}

/* ============================================================
   NEW DM MODAL
============================================================ */
let dmModal = null;

function openNewDMModal() {
  if (!dmModal) {
    dmModal = new bootstrap.Modal(document.getElementById("newDMModal"));
  }
  document.getElementById("userSearchInput").value = "";
  document.getElementById("userSearchResults").innerHTML = "";
  showUserList(allOrgMembers);
  dmModal.show();
}

async function loadOrgMembers() {
  try {
    const res = await api.get("/user/members");
    allOrgMembers = res.data.data?.members || [];
  } catch (err) {
    console.error("loadOrgMembers error:", err.response?.data || err.message);
  }
}

function searchUsers(query) {
  const q = query.toLowerCase();
  const filtered = allOrgMembers.filter(
    (u) =>
      u.username?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q),
  );
  showUserList(filtered);
}

function showUserList(users) {
  const container = document.getElementById("userSearchResults");
  container.innerHTML = "";

  if (!users.length) {
    container.innerHTML = `<div style="color:#718096; text-align:center; padding:16px; font-size:13px;">No users found</div>`;
    return;
  }

  users.forEach((user) => {
    if (user._id === MY_ID) return; // skip self

    const div = document.createElement("div");
    div.className = "userItem";
    const letter = user.username?.charAt(0).toUpperCase() || "?";
    const imgSrc = user.image?.secure_url;

    div.innerHTML = `
      <div class="roomAvatar" style="width:36px;height:36px;font-size:14px;">
        ${imgSrc ? `<img src="${imgSrc}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" />` : letter}
      </div>
      <div>
        <div style="font-weight:600; font-size:14px;">${user.username}</div>
        <div style="font-size:12px; color:#718096;">${user.email}</div>
      </div>
    `;
    div.onclick = () => startDM(user);
    container.appendChild(div);
  });
}

async function startDM(user) {
  try {
    const res = await api.post("/chat/rooms/direct", {
      targetUserId: user._id,
    });
    const room = res.data.data.room;

    // Add to list if not already there
    if (!allRooms.find((r) => r._id === room._id)) {
      allRooms.unshift(room);
      renderRoomList(allRooms);
    }

    dmModal?.hide();
    openRoom(room);
  } catch (err) {
    console.error("startDM error:", err.response?.data || err.message);
    alert(err.response?.data?.message || "Could not create DM");
  }
}

/* ============================================================
   UTILITY
============================================================ */
function scrollToBottom() {
  const list = document.getElementById("messageList");
  list.scrollTop = list.scrollHeight;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ============================================================
   SOCKET EVENT LISTENERS
============================================================ */

// ── Connected ──────────────────────────────────────────────
socket.on("connect", () => {
  console.log("[Socket] Connected:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("[Socket] Connection error:", err.message);
});

// ── Receive new message (from others) ──────────────────────
socket.on("receive_message", ({ message, roomId }) => {
  // Update last message preview in sidebar
  const room = allRooms.find((r) => r._id === roomId);
  if (room) {
    room.lastMessage = message;
    room.lastMessageAt = message.createdAt;
    renderRoomList(allRooms);
  }

  // If in the active room → display
  if (roomId === currentRoomId) {
    appendMessage(message);
    // Mark as seen
    socket.emit("message_seen", { roomId, messageId: message._id });
  }
});

// ── My message sent (ack from server) ──────────────────────
socket.on("message_sent", ({ message }) => {
  // Update sidebar preview
  const room = allRooms.find((r) => r._id === message.chatRoomId);
  if (room) {
    room.lastMessage = message;
    room.lastMessageAt = message.createdAt;
    renderRoomList(allRooms);
  }
  appendMessage(message);
});

// ── Typing indicators ──────────────────────────────────────
socket.on("user_typing", ({ roomId, username }) => {
  if (roomId !== currentRoomId) return;
  document.getElementById("typingIndicator").textContent =
    `${username} is typing...`;
});

socket.on("user_stopped_typing", ({ roomId }) => {
  if (roomId !== currentRoomId) return;
  document.getElementById("typingIndicator").textContent = "";
});

// ── Seen receipts ──────────────────────────────────────────
socket.on("messages_seen", ({ roomId, messageId, seenBy }) => {
  if (roomId !== currentRoomId) return;
  // Could update double-tick UI here
  console.log(`[Seen] ${seenBy.username} saw messages up to ${messageId}`);
});

// ── Message delivered ──────────────────────────────────────
socket.on("message_delivered", ({ roomId, userId }) => {
  console.log(`[Delivered] userId=${userId} in room=${roomId}`);
});

// ── Reaction added ─────────────────────────────────────────
socket.on("reaction_added", ({ roomId, messageId, reaction, summary }) => {
  if (roomId !== currentRoomId) return;
  updateMessageReactions(messageId, summary);
});

socket.on("reaction_removed", ({ roomId, messageId, summary }) => {
  if (roomId !== currentRoomId) return;
  updateMessageReactions(messageId, summary);
});

function updateMessageReactions(messageId, summary) {
  const wrapper = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (!wrapper) return;

  const reactionDiv = wrapper.querySelector(".msgReactions");
  if (!reactionDiv) return;

  reactionDiv.innerHTML =
    summary
      .map(
        ({ reaction, count }) =>
          `<span class="reactionChip" onclick="addReaction('${messageId}', '${reaction}')">${reaction} ${count}</span>`,
      )
      .join("") +
    `<span class="reactionChip" onclick="showEmojiPicker('${messageId}')">+</span>`;
}

// ── Message edited ─────────────────────────────────────────
socket.on("message_edited", ({ roomId, messageId, content }) => {
  if (roomId !== currentRoomId) return;

  const wrapper = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (!wrapper) return;

  const bubble = wrapper.querySelector(".msgBubble");
  if (bubble) {
    bubble.innerHTML = `${escapeHTML(content)} <span class="editedTag">(edited)</span>`;
  }
});

// ── Message deleted ────────────────────────────────────────
socket.on("message_deleted", ({ roomId, messageId, deleteType }) => {
  if (deleteType === "everyone" && roomId === currentRoomId) {
    const wrapper = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (wrapper) {
      const bubble = wrapper.querySelector(".msgBubble");
      if (bubble)
        bubble.innerHTML = `<span class="deletedMsg">🚫 This message was deleted</span>`;
    }
  } else if (deleteType === "me") {
    const wrapper = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (wrapper) wrapper.remove();
  }
});

// ── Presence ───────────────────────────────────────────────
socket.on("user_online", ({ userId, username }) => {
  console.log(`[Online] ${username}`);
});

socket.on("user_offline", ({ userId, username, lastSeen }) => {
  console.log(`[Offline] ${username}`);
});

// ── Errors ────────────────────────────────────────────────
socket.on("socket_Error", ({ event, message, code }) => {
  console.error(`[Socket Error] ${event} → ${message} (${code})`);
  if (code === 401) {
    alert("Session expired. Please login again.");
    logout();
  }
});

// ── Room joined (ack) ──────────────────────────────────────
socket.on("room_joined", ({ roomId }) => {
  console.log(`[Socket] Joined room: ${roomId}`);
});
