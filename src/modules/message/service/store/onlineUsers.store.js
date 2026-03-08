/**
 * In-memory store for online users
 * Maps userId (string) => Set of socketIds (user can have multiple connections)
 */
export const onlineUsers = new Map(); // userId -> Set<socketId>

export const addOnlineUser = (userId, socketId) => {
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socketId);
};

export const removeOnlineUser = (userId, socketId) => {
  if (onlineUsers.has(userId)) {
    onlineUsers.get(userId).delete(socketId);
    if (onlineUsers.get(userId).size === 0) {
      onlineUsers.delete(userId);
    }
  }
};

export const isUserOnline = (userId) => {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
};

export const getUserSocketIds = (userId) => {
  return onlineUsers.has(userId) ? [...onlineUsers.get(userId)] : [];
};

export const getOnlineUserIds = () => {
  return [...onlineUsers.keys()];
};
