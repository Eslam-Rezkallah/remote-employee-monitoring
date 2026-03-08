const baseURL = "http://localhost:5001";
const token = localStorage.getItem("token");
const socket = io(baseURL, { auth: { authorization: `Bearer ${token}` } });
let currentChatRoomId = null;

socket.on("newMessage", (data) => {
  displayMessage(data.message);
});

socket.on("userTyping", (data) => {
  // Show typing indicator
});

function loadChatRooms() {
  fetch(`${baseURL}/chat?orgId=YOUR_ORG_ID`, {
    headers: { authorization: `Bearer ${token}` },
  })
    .then((res) => res.json())
    .then((data) => {
      const list = document.getElementById("chatRooms");
      list.innerHTML = "";
      data.data.chatRooms.forEach((room) => {
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.textContent = room.name || "Private";
        li.onclick = () => openChat(room._id);
        list.appendChild(li);
      });
    });
}

function openChat(chatRoomId) {
  currentChatRoomId = chatRoomId;
  document.getElementById("chatArea").style.display = "block";
  loadMessages(chatRoomId);
  socket.emit("join", chatRoomId);
}

function loadMessages(chatRoomId) {
  fetch(`${baseURL}/chat/${chatRoomId}/messages`, {
    headers: { authorization: `Bearer ${token}` },
  })
    .then((res) => res.json())
    .then((data) => {
      const msgDiv = document.getElementById("messages");
      msgDiv.innerHTML = "";
      data.data.messages.forEach(displayMessage);
    });
}

function displayMessage(message) {
  const div = document.createElement("div");
  div.textContent = `${message.sender.username}: ${message.content}`;
  document.getElementById("messages").appendChild(div);
}

function sendMessage() {
  const content = document.getElementById("messageInput").value;
  fetch(`${baseURL}/chat/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ chatRoomId: currentChatRoomId, content }),
  });
  document.getElementById("messageInput").value = "";
}

function handleTyping() {
  socket.emit("typingStart", currentChatRoomId);
  setTimeout(() => socket.emit("typingStop", currentChatRoomId), 1000);
}

loadChatRooms();
