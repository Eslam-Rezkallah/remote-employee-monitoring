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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      alert("Session expired. Please login again.");
      logout();
    }
    return Promise.reject(error);
  },
);

/* ============================================================
   SOCKET.IO
============================================================ */
const socket = io(`${BASE_URL}/chat`, {
  auth: { authorization: token },
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

/* ============================================================
   STATE
============================================================ */
let allRooms = [];
let currentRoomId = null;
let currentRoom = null;
let replyToMsg = null;
let typingTimer = null;
let allOrgMembers = [];

// ✅ Feature 3: Infinite scroll state
let isLoadingMore = false;
let hasMoreMessages = true;
let oldestMessageDate = null;

// ✅ Feature 4: Unread counts
let unreadCounts = {};

/* ============================================================
   INIT
============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  loadRooms();
  loadOrgMembers();
  loadUnreadCounts(); // ✅ Feature 4
  setupInputHandlers();
  setupMessageSearch(); // ✅ Feature 1
  setupInfiniteScroll(); // ✅ Feature 3
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
   ✅ Feature 4: LOAD UNREAD COUNTS
============================================================ */
async function loadUnreadCounts() {
  try {
    const res = await api.get("/chat/rooms/unread-counts");
    unreadCounts = res.data.data.counts || {};
    updateUnreadBadges();
    updateTotalUnreadTitle(res.data.data.totalUnread || 0);
  } catch (err) {
    console.error("loadUnreadCounts error:", err.message);
  }
}

function updateUnreadBadges() {
  document.querySelectorAll(".roomItem").forEach((el) => {
    const roomId = el.dataset.roomId;
    const badge = el.querySelector(".roomBadge");
    const count = unreadCounts[roomId] || 0;

    if (count > 0) {
      if (badge) {
        badge.textContent = count > 99 ? "99+" : count;
        badge.style.display = "block";
      } else {
        const newBadge = document.createElement("div");
        newBadge.className = "roomBadge";
        newBadge.textContent = count > 99 ? "99+" : count;
        el.appendChild(newBadge);
      }
    } else if (badge) {
      badge.style.display = "none";
    }
  });
}

function updateTotalUnreadTitle(total) {
  document.title = total > 0 ? `(${total}) Chat App` : "Chat App";
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

    const name = getRoomDisplayName(room);
    const letter = name.replace("#", "").charAt(0).toUpperCase();
    const preview = room.lastMessage?.content
      ? room.lastMessage.content.length > 35
        ? room.lastMessage.content.slice(0, 35) + "..."
        : room.lastMessage.content
      : "No messages yet";

    // ✅ Feature 4: Unread badge
    const count = unreadCounts[room._id] || 0;
    const badgeHTML =
      count > 0
        ? `<div class="roomBadge">${count > 99 ? "99+" : count}</div>`
        : "";

    div.innerHTML = `
      <div class="roomAvatar">${letter}</div>
      <div class="roomInfo">
        <div class="roomName">${escapeHTML(name)}</div>
        <div class="roomPreview">${escapeHTML(preview)}</div>
      </div>
      ${badgeHTML}
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
    const other = room.members?.find((m) => {
      const memberId = typeof m === "object" ? m._id || m : m;
      return String(memberId) !== MY_ID;
    });
    if (typeof other === "object") return other?.username || "Direct Message";
    return "Direct Message";
  }
  return room.name || `${room.type} room`;
}

/* ============================================================
   FILTER / SWITCH
============================================================ */
function filterRooms(query) {
  const q = query.toLowerCase();
  const filtered = allRooms.filter((r) =>
    getRoomDisplayName(r).toLowerCase().includes(q),
  );
  renderRoomList(filtered);
}

function switchTab(type, evt) {
  document
    .querySelectorAll(".sideTab")
    .forEach((t) => t.classList.remove("active"));
  if (evt && evt.target) evt.target.classList.add("active");

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

  // ✅ Feature 3: Reset scroll state
  hasMoreMessages = true;
  oldestMessageDate = null;
  isLoadingMore = false;

  document.querySelectorAll(".roomItem").forEach((el) => {
    el.classList.toggle("active", el.dataset.roomId === room._id);
  });

  const displayName = getRoomDisplayName(room);
  document.getElementById("chatHeaderName").textContent = displayName;
  document.getElementById("chatHeaderAvatar").textContent = displayName
    .replace("#", "")
    .charAt(0)
    .toUpperCase();
  document.getElementById("chatHeaderSub").textContent =
    `${room.members?.length || 0} members · ${room.type}`;
  document.getElementById("currentRoomName").textContent = displayName;

  document.getElementById("chatArea").style.display = "flex";
  document.getElementById("noRoom").style.display = "none";

  // ✅ Feature 1: Show search bar
  document.getElementById("msgSearchContainer").style.display = "flex";

  socket.emit("join_room", { roomId: room._id });

  await loadMessages(room._id);

  // ✅ Feature 4: Clear unread count for this room
  if (unreadCounts[room._id]) {
    const oldCount = unreadCounts[room._id];
    delete unreadCounts[room._id];
    updateUnreadBadges();
    const total = Object.values(unreadCounts).reduce((s, c) => s + c, 0);
    updateTotalUnreadTitle(total);
  }
}

/* ============================================================
   LOAD MESSAGES
============================================================ */
async function loadMessages(roomId, before = null) {
  try {
    const params = `?limit=50${before ? `&before=${before}` : ""}`;
    const res = await api.get(`/chat/rooms/${roomId}/messages${params}`);
    const msgs = res.data.data.messages || [];

    // ✅ Feature 3: Track if there are more messages
    hasMoreMessages = res.data.data.hasMore ?? msgs.length >= 50;

    const list = document.getElementById("messageList");

    if (!before) {
      // Initial load
      list.innerHTML = "";
      if (!msgs.length) {
        list.innerHTML = `<div style="text-align:center;color:#4a5568;padding:40px;font-size:14px;">No messages yet. Say hello! 👋</div>`;
        return;
      }
    }

    if (before && !msgs.length) {
      hasMoreMessages = false;
      return;
    }

    // ✅ Feature 3: For "load more", prepend at top
    if (before) {
      const scrollHeightBefore = list.scrollHeight;
      msgs.forEach((msg) => prependMessage(msg));
      // Maintain scroll position
      list.scrollTop = list.scrollHeight - scrollHeightBefore;
    } else {
      msgs.forEach((msg) => appendMessage(msg, false));
      scrollToBottom();
    }

    // Track oldest message date for next "load more"
    if (msgs.length) {
      oldestMessageDate = msgs[0].createdAt;
    }

    // Mark as seen
    if (msgs.length && !before) {
      const lastId = msgs[msgs.length - 1]._id;
      socket.emit("message_seen", { roomId, messageId: lastId });
    }
  } catch (err) {
    console.error("loadMessages error:", err.response?.data || err.message);
  }
}

/* ============================================================
   ✅ Feature 3: INFINITE SCROLL — Load more messages
============================================================ */
function setupInfiniteScroll() {
  const list = document.getElementById("messageList");
  list.addEventListener("scroll", async () => {
    if (
      list.scrollTop <= 100 &&
      !isLoadingMore &&
      hasMoreMessages &&
      currentRoomId
    ) {
      isLoadingMore = true;
      showLoadMoreIndicator(true);
      await loadMessages(currentRoomId, oldestMessageDate);
      showLoadMoreIndicator(false);
      isLoadingMore = false;
    }
  });
}

function showLoadMoreIndicator(show) {
  let indicator = document.getElementById("loadMoreIndicator");
  if (show) {
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "loadMoreIndicator";
      indicator.style.cssText =
        "text-align:center;color:#7c6af7;padding:10px;font-size:12px;";
      indicator.textContent = "Loading older messages...";
      const list = document.getElementById("messageList");
      list.prepend(indicator);
    }
  } else if (indicator) {
    indicator.remove();
  }
}

/* ============================================================
   RENDER A SINGLE MESSAGE
============================================================ */
function createMessageElement(msg) {
  const senderId = msg.senderId?._id
    ? String(msg.senderId._id)
    : String(msg.senderId || "");
  const isMine = senderId === MY_ID;

  const wrapper = document.createElement("div");
  wrapper.className = `msgRow ${isMine ? "mine" : "theirs"}`;
  wrapper.dataset.msgId = msg._id;

  const senderName = msg.senderId?.username || (isMine ? MY_USERNAME : "User");
  const avatarLetter = senderName.charAt(0).toUpperCase();
  const avatarSrc = msg.senderId?.image?.secure_url;

  let contentHTML = "";

  if (msg.replyTo) {
    const replyContent = msg.replyTo?.content || "Original message";
    contentHTML += `<div class="replyBubble">↩ ${escapeHTML(replyContent)}</div>`;
  }

  if (msg.deletedForEveryone) {
    contentHTML += `<span class="deletedMsg">🚫 This message was deleted</span>`;
  } else if (msg.messageType === "image" && msg.attachments?.length) {
    msg.attachments.forEach((att) => {
      contentHTML += `<img src="${escapeHTML(att.url)}" style="max-width:200px; border-radius:10px; display:block; margin-bottom:4px;" />`;
    });
    if (msg.content) contentHTML += `<div>${escapeHTML(msg.content)}</div>`;
  } else if (msg.messageType === "voice" && msg.attachments?.length) {
    msg.attachments.forEach((att) => {
      contentHTML += `<audio controls src="${escapeHTML(att.url)}" style="max-width:200px;"></audio>`;
    });
  } else if (msg.messageType === "file" && msg.attachments?.length) {
    msg.attachments.forEach((att) => {
      contentHTML += `<a href="${escapeHTML(att.url)}" target="_blank" style="color:#7c6af7;">📎 ${escapeHTML(att.originalName || "File")}</a>`;
    });
    if (msg.content) contentHTML += `<div>${escapeHTML(msg.content)}</div>`;
  } else {
    contentHTML += escapeHTML(msg.content || "");
  }

  if (msg.edited && !msg.deletedForEveryone) {
    contentHTML += `<span class="editedTag">(edited)</span>`;
  }

  // ✅ Feature 7: Checkmarks for own messages
  let checkmarkHTML = "";
  if (isMine && !msg.deletedForEveryone) {
    const status = msg.deliveryStatus || getCheckmarkStatus(msg);
    checkmarkHTML = `<span class="checkmark" data-msg-id="${msg._id}">${getCheckmarkIcon(status)}</span>`;
  }

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

  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const safeContent = escapeHTML(msg.content || "").replace(/'/g, "\\'");

  wrapper.innerHTML = `
    <div class="msgAvatar">${avatarSrc ? `<img src="${escapeHTML(avatarSrc)}" />` : avatarLetter}</div>
    <div>
      ${!isMine ? `<div class="msgSender">${escapeHTML(senderName)}</div>` : ""}
      <div class="msgBubble" ondblclick="setReply('${msg._id}', '${safeContent}')">
        ${contentHTML}
      </div>
      ${reactionsHTML}
      <div class="msgMeta">${time} ${checkmarkHTML}</div>
    </div>
  `;

  return wrapper;
}

function appendMessage(msg, scroll = true) {
  const list = document.getElementById("messageList");
  list.appendChild(createMessageElement(msg));
  if (scroll) scrollToBottom();
}

// ✅ Feature 3: Prepend message at top (for infinite scroll)
function prependMessage(msg) {
  const list = document.getElementById("messageList");
  const firstChild = list.firstChild;
  list.insertBefore(createMessageElement(msg), firstChild);
}

/* ============================================================
   ✅ Feature 7: CHECKMARK HELPERS
============================================================ */
function getCheckmarkStatus(msg) {
  const seenCount = msg.seenBy?.length || 0;
  const deliveredCount = msg.deliveredTo?.length || 0;
  if (seenCount > 0) return "seen";
  if (deliveredCount > 0) return "delivered";
  return "sent";
}

function getCheckmarkIcon(status) {
  switch (status) {
    case "seen":
      return '<span style="color:#7c6af7;">✓✓</span>';
    case "delivered":
      return '<span style="color:#718096;">✓✓</span>';
    case "sent":
      return '<span style="color:#718096;">✓</span>';
    default:
      return '<span style="color:#718096;">✓</span>';
  }
}

/* ============================================================
   ✅ Feature 1: MESSAGE SEARCH
============================================================ */
function setupMessageSearch() {
  const searchInput = document.getElementById("msgSearchInput");
  const searchResults = document.getElementById("searchResults");
  let searchTimer = null;

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();

    if (!q || q.length < 2) {
      searchResults.style.display = "none";
      searchResults.innerHTML = "";
      return;
    }

    searchTimer = setTimeout(() => searchMessagesInRoom(q), 400);
  });

  // Close search results when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#msgSearchContainer")) {
      searchResults.style.display = "none";
    }
  });
}

async function searchMessagesInRoom(query) {
  if (!currentRoomId) return;

  const searchResults = document.getElementById("searchResults");
  searchResults.style.display = "block";
  searchResults.innerHTML =
    '<div style="padding:10px;color:#718096;font-size:13px;">Searching...</div>';

  try {
    const res = await api.get(
      `/chat/rooms/${currentRoomId}/messages/search?q=${encodeURIComponent(query)}&limit=10`,
    );
    const msgs = res.data.data.messages || [];

    if (!msgs.length) {
      searchResults.innerHTML =
        '<div style="padding:10px;color:#718096;font-size:13px;">No messages found</div>';
      return;
    }

    searchResults.innerHTML = msgs
      .map((msg) => {
        const sender = msg.senderId?.username || "Unknown";
        const time = new Date(msg.createdAt).toLocaleDateString();
        const content =
          msg.content.length > 80
            ? msg.content.slice(0, 80) + "..."
            : msg.content;
        // Highlight search term
        const highlighted = content.replace(
          new RegExp(`(${escapeRegex(query)})`, "gi"),
          '<mark style="background:#7c6af7;color:#fff;border-radius:2px;padding:0 2px;">$1</mark>',
        );
        return `
        <div class="searchResultItem" onclick="scrollToMessage('${msg._id}')">
          <div style="font-weight:600;font-size:12px;color:#7c6af7;">${escapeHTML(sender)} · ${time}</div>
          <div style="font-size:13px;color:#e2e8f0;margin-top:2px;">${highlighted}</div>
        </div>
      `;
      })
      .join("");
  } catch (err) {
    searchResults.innerHTML =
      '<div style="padding:10px;color:#c0392b;font-size:13px;">Search failed</div>';
  }
}

function scrollToMessage(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "background 0.3s";
    el.style.background = "rgba(124, 106, 247, 0.15)";
    setTimeout(() => {
      el.style.background = "";
    }, 2000);
  }
  document.getElementById("searchResults").style.display = "none";
  document.getElementById("msgSearchInput").value = "";
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ============================================================
   ✅ Feature 2: FILE UPLOAD WITH PROGRESS
============================================================ */
async function uploadFileWithProgress(file) {
  if (!currentRoomId) return;

  const formData = new FormData();
  formData.append("attachments", file);
  formData.append("content", "");
  formData.append(
    "messageType",
    file.type.startsWith("image/") ? "image" : "file",
  );

  const progressBar = document.getElementById("uploadProgress");
  const progressFill = document.getElementById("uploadProgressFill");
  const progressText = document.getElementById("uploadProgressText");

  progressBar.style.display = "block";
  progressFill.style.width = "0%";
  progressText.textContent = "Uploading...";

  try {
    await axios.post(
      `${BASE_URL}/chat/rooms/${currentRoomId}/messages`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
          authorization: token,
        },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round(
            (progressEvent.loaded / progressEvent.total) * 100,
          );
          progressFill.style.width = `${percent}%`;
          progressText.textContent = `Uploading... ${percent}%`;
        },
      },
    );
    progressText.textContent = "Upload complete!";
    setTimeout(() => {
      progressBar.style.display = "none";
    }, 1500);
  } catch (err) {
    progressText.textContent = "Upload failed!";
    progressFill.style.background = "#c0392b";
    setTimeout(() => {
      progressBar.style.display = "none";
      progressFill.style.background = "#7c6af7";
    }, 2000);
  }
}

/* ============================================================
   SEND MESSAGE + INPUT HANDLERS
============================================================ */
function setupInputHandlers() {
  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    handleTyping();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.onclick = sendMessage;

  // ✅ Feature 2: File upload button
  const fileBtn = document.getElementById("fileUploadBtn");
  const fileInput = document.getElementById("fileInput");
  if (fileBtn && fileInput) {
    fileBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        uploadFileWithProgress(file);
        fileInput.value = "";
      }
    };
  }
}

function sendMessage() {
  if (!currentRoomId) return;

  const input = document.getElementById("msgInput");
  const content = input.value.trim();
  if (!content) return;

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
  replyToMsg = { _id: msgId, content };
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
  document.querySelectorAll(".emojiBar").forEach((el) => el.remove());
  const wrapper = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!wrapper) return;

  const bar = document.createElement("div");
  bar.className = "emojiBar";
  EMOJIS.forEach((emoji) => {
    const span = document.createElement("span");
    span.textContent = emoji;
    span.onclick = (e) => {
      e.stopPropagation();
      addReaction(msgId, emoji);
      bar.remove();
    };
    bar.appendChild(span);
  });

  wrapper.style.position = "relative";
  wrapper.appendChild(bar);
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
  } catch (err) {
    console.error("addReaction error:", err.response?.data || err.message);
  }
}

/* ============================================================
   NEW DM MODAL
============================================================ */
let dmModal = null;

function openNewDMModal() {
  if (!dmModal)
    dmModal = new bootstrap.Modal(document.getElementById("newDMModal"));
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
    if (user._id === MY_ID) return;
    const div = document.createElement("div");
    div.className = "userItem";
    const letter = user.username?.charAt(0).toUpperCase() || "?";
    const imgSrc = user.image?.secure_url;
    div.innerHTML = `
      <div class="roomAvatar" style="width:36px;height:36px;font-size:14px;">
        ${imgSrc ? `<img src="${escapeHTML(imgSrc)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" />` : letter}
      </div>
      <div>
        <div style="font-weight:600; font-size:14px;">${escapeHTML(user.username)}</div>
        <div style="font-size:12px; color:#718096;">${escapeHTML(user.email)}</div>
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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ============================================================
   SOCKET EVENT LISTENERS
============================================================ */

// ✅ Feature 6: Connection status
socket.on("connect", () => {
  console.log("[Socket] Connected:", socket.id);
  updateConnectionStatus(true);

  // Re-join current room on reconnect
  if (currentRoomId) {
    socket.emit("join_room", { roomId: currentRoomId });
  }
});

socket.on("disconnect", () => {
  updateConnectionStatus(false);
});

socket.on("reconnecting", () => {
  updateConnectionStatus(false, "Reconnecting...");
});

socket.on("connect_error", (err) => {
  console.error("[Socket] Connection error:", err.message);
  updateConnectionStatus(false, "Connection error");
});

// ✅ Feature 6: Update connection status indicator
function updateConnectionStatus(connected, customText) {
  const indicator = document.getElementById("connectionStatus");
  if (!indicator) return;

  if (connected) {
    indicator.innerHTML = '<span style="color:#48bb78;">● Connected</span>';
    // Auto-hide after 3 seconds
    setTimeout(() => {
      indicator.innerHTML = "";
    }, 3000);
  } else {
    const text = customText || "Disconnected";
    indicator.innerHTML = `<span style="color:#f56565;">● ${text}</span>`;
  }
}

// ── Receive message ───────────────────────────────────────────
socket.on("receive_message", ({ message, roomId }) => {
  const room = allRooms.find((r) => r._id === roomId);
  if (room) {
    room.lastMessage = message;
    room.lastMessageAt = message.createdAt;
    renderRoomList(allRooms);
  }

  if (roomId === currentRoomId) {
    appendMessage(message);
    socket.emit("message_seen", { roomId, messageId: message._id });
  } else {
    // ✅ Feature 4: Increment unread count
    unreadCounts[roomId] = (unreadCounts[roomId] || 0) + 1;
    updateUnreadBadges();
    const total = Object.values(unreadCounts).reduce((s, c) => s + c, 0);
    updateTotalUnreadTitle(total);
  }
});

// ── My message sent ───────────────────────────────────────────
socket.on("message_sent", ({ message }) => {
  const room = allRooms.find((r) => r._id === message.chatRoomId);
  if (room) {
    room.lastMessage = message;
    room.lastMessageAt = message.createdAt;
    renderRoomList(allRooms);
  }
  appendMessage(message);
});

// ── Typing ────────────────────────────────────────────────────
socket.on("user_typing", ({ roomId, username }) => {
  if (roomId !== currentRoomId) return;
  document.getElementById("typingIndicator").textContent =
    `${username} is typing...`;
});

socket.on("user_stopped_typing", ({ roomId }) => {
  if (roomId !== currentRoomId) return;
  document.getElementById("typingIndicator").textContent = "";
});

// ── Seen receipts ─────────────────────────────────────────────
socket.on("messages_seen", ({ roomId, messageId, seenBy }) => {
  if (roomId !== currentRoomId) return;
  // ✅ Feature 7: Update checkmarks for all messages up to messageId
  document.querySelectorAll(`.msgRow.mine .checkmark`).forEach((el) => {
    el.innerHTML = getCheckmarkIcon("seen");
  });
});

// ── ✅ Feature 7: Delivery status updates ─────────────────────
socket.on("message_delivery_status", ({ roomId, messageId, status }) => {
  if (roomId !== currentRoomId) return;
  const checkmark = document.querySelector(
    `[data-msg-id="${messageId}"] .checkmark`,
  );
  if (checkmark) {
    checkmark.innerHTML = getCheckmarkIcon(status);
  }
});

socket.on("message_delivered", ({ roomId, userId: deliveredUserId }) => {
  if (roomId !== currentRoomId) return;
  // ✅ Feature 7: Update checkmarks to delivered
  document.querySelectorAll(`.msgRow.mine .checkmark`).forEach((el) => {
    if (el.innerHTML.includes("✓</span>") && !el.innerHTML.includes("✓✓")) {
      el.innerHTML = getCheckmarkIcon("delivered");
    }
  });
});

// ── Reactions ─────────────────────────────────────────────────
socket.on("reaction_added", ({ roomId, messageId, summary }) => {
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

// ── Edit / Delete ─────────────────────────────────────────────
socket.on("message_edited", ({ roomId, messageId, content }) => {
  if (roomId !== currentRoomId) return;
  const wrapper = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (!wrapper) return;
  const bubble = wrapper.querySelector(".msgBubble");
  if (bubble)
    bubble.innerHTML = `${escapeHTML(content)} <span class="editedTag">(edited)</span>`;
});

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

// ── ✅ Feature 5: Room created (sidebar updates in real-time) ──
socket.on("room_created", ({ room }) => {
  if (!room) return;
  // Don't add duplicate
  if (allRooms.find((r) => r._id === room._id)) return;
  allRooms.unshift(room);
  renderRoomList(allRooms);
});

// ── Presence ──────────────────────────────────────────────────
socket.on("user_online", ({ userId, username }) => {
  console.log(`[Online] ${username}`);
});

socket.on("user_offline", ({ userId, username }) => {
  console.log(`[Offline] ${username}`);
});

// ── Errors ────────────────────────────────────────────────────
socket.on("socket_Error", ({ event, message, code }) => {
  console.error(`[Socket Error] ${event} → ${message} (${code})`);
  if (code === 401) {
    alert("Session expired. Please login again.");
    logout();
  }
});

socket.on("room_joined", ({ roomId }) => {
  console.log(`[Socket] Joined room: ${roomId}`);
});
