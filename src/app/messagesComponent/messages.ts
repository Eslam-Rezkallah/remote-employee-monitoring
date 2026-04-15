import {
  Component, signal, inject, OnInit, OnDestroy,
  ElementRef, ViewChild, AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService, BASE } from '../services/auth.service';
import {
  ChatService, Conversation, BackendMessage, MsgType,
} from '../services/chat.service';

const EMOJI_QUICK = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

@Component({
  selector: 'app-messages',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './messages.html',
  styleUrls: ['messages.css', '../../styles.css'],
})
export class MessagesComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('chatScroll') chatScroll!: ElementRef;

  private chatService = inject(ChatService);
  private auth = inject(AuthService);

  // ── State ──────────────────────────────────────────────
  rooms           = signal<Conversation[]>([]);
  selectedRoom    = signal<Conversation | null>(null);
  messages        = signal<BackendMessage[]>([]);
  messageText     = signal('');
  searchQuery     = signal('');
  loadingRooms    = signal(true);
  loadingMessages = signal(false);
  showMembers     = signal(false);
  typingUsers     = signal<string[]>([]);

  // Create channel/group
  showCreateChannel     = signal(false);
  showCreateGroup       = signal(false);
  showCreateDM          = signal(false);
  newChannelName        = signal('');
  newGroupName          = signal('');
  selectedGroupMembers  = signal<string[]>([]);

  // Org members (for DM/group pickers)
  orgMembers = signal<{ _id: string; username: string; email: string; image?: any }[]>([]);

  // Edit/delete
  editingMsgId  = signal<string | null>(null);
  editingText   = signal('');

  // Reactions
  reactionMenuMsgId = signal<string | null>(null);
  emojiOptions      = EMOJI_QUICK;

  private socket: any = null;
  private shouldScroll = false;
  private typingTimeout: any = null;

  get currentUser()  { return this.auth.currentUser(); }
  get orgId(): string { return this.currentUser?.orgId ?? ''; }

  // ── Filtered rooms ─────────────────────────────────────
  get channels() { return this.rooms().filter(r => r.type === 'channel'); }
  get groups()   { return this.rooms().filter(r => r.type === 'group');   }
  get dms()      { return this.rooms().filter(r => r.type === 'direct');  }

  get filteredRooms(): Conversation[] | null {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return null;
    return this.rooms().filter(r =>
      (r.name ?? '').toLowerCase().includes(q) ||
      r.members.some(m => m.username.toLowerCase().includes(q))
    );
  }

  // Members not in any existing DM with current user (for new DM picker)
  get availableDMMembers() {
    const myId = this.currentUser?._id;
    const existingDMUserIds = new Set(
      this.dms.flatMap(r => r.members.filter(m => m._id !== myId).map(m => m._id))
    );
    return this.orgMembers().filter(m =>
      m._id !== myId && !existingDMUserIds.has(m._id)
    );
  }

  getRoomDisplayName(room: Conversation): string {
    if (room.name) return room.name;
    if (room.type === 'direct') {
      const other = room.members.find(m => m._id !== this.currentUser?._id);
      return other?.username ?? 'Direct Message';
    }
    return 'Chat';
  }

  getRoomInitial(room: Conversation): string {
    return this.getRoomDisplayName(room).charAt(0).toUpperCase();
  }

  getUnread(room: Conversation): number {
    const uid = this.currentUser?._id;
    if (!uid || !room.unreadCounts) return 0;
    return room.unreadCounts[uid] ?? 0;
  }

  isMsgOwn(msg: BackendMessage): boolean {
    return msg.senderId?._id === this.currentUser?._id;
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Lifecycle ──────────────────────────────────────────
  ngOnInit() {
    this.loadRooms();
    this.loadOrgMembers();
    this.connectSocket();
  }

  ngOnDestroy() {
    this.disconnectSocket();
  }

  ngAfterViewChecked() {
    if (this.shouldScroll && this.chatScroll) {
      const el = this.chatScroll.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  // ── Load rooms ─────────────────────────────────────────
  async loadRooms() {
    this.loadingRooms.set(true);
    const rooms = await this.chatService.loadRooms();
    this.rooms.set(rooms);
    if (rooms.length > 0 && !this.selectedRoom()) {
      this.selectRoom(rooms[0]);
    }
    this.loadingRooms.set(false);
  }

  // ── Load org members (for DM/group pickers) ────────────
  async loadOrgMembers() {
    const members = await this.chatService.loadOrgMembers();
    this.orgMembers.set(members);
  }

  // ── Select room ────────────────────────────────────────
  async selectRoom(room: Conversation) {
    this.selectedRoom.set(room);
    this.showMembers.set(false);
    this.editingMsgId.set(null);
    this.reactionMenuMsgId.set(null);
    this.shouldScroll = true;

    await this.loadMessages(room._id);

    if (this.socket) {
      this.socket.emit('join_room', { roomId: room._id });
      this.socket.emit('read_messages', { roomId: room._id });
    }

    // Mark last message as seen via REST
    const msgs = this.messages();
    if (msgs.length > 0) {
      this.chatService.markSeen(room._id, msgs[msgs.length - 1]._id);
    }
  }

  // ── Load messages ──────────────────────────────────────
  async loadMessages(roomId: string) {
    this.loadingMessages.set(true);
    const msgs = await this.chatService.loadMessages(roomId);
    this.messages.set(msgs);
    this.shouldScroll = true;
    this.loadingMessages.set(false);
  }

  // ── Send message ───────────────────────────────────────
  async sendMessage() {
    const text = this.messageText().trim();
    const room = this.selectedRoom();
    if (!text || !room) return;

    this.messageText.set('');

    if (this.socket) {
      this.socket.emit('send_message', {
        roomId: room._id,
        content: text,
        messageType: 'text',
      });
    } else {
      // REST fallback
      const msg = await this.chatService.sendMessage(room._id, text);
      if (msg) {
        this.messages.update(msgs => [...msgs, msg]);
        this.shouldScroll = true;
      }
    }
  }

  handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    } else {
      this.emitTyping();
    }
  }

  // ── Edit message ───────────────────────────────────────
  startEdit(msg: BackendMessage) {
    this.editingMsgId.set(msg._id);
    this.editingText.set(msg.content);
  }

  cancelEdit() {
    this.editingMsgId.set(null);
    this.editingText.set('');
  }

  async saveEdit() {
    const msgId = this.editingMsgId();
    const room = this.selectedRoom();
    if (!msgId || !room) return;

    const text = this.editingText().trim();
    if (!text) return;

    if (this.socket) {
      this.socket.emit('edit_message', {
        roomId: room._id,
        messageId: msgId,
        content: text,
      });
    } else {
      const ok = await this.chatService.editMessage(room._id, msgId, text);
      if (ok) {
        this.messages.update(msgs =>
          msgs.map(m => m._id === msgId ? { ...m, content: text, edited: true } : m)
        );
      }
    }
    this.cancelEdit();
  }

  // ── Delete message ─────────────────────────────────────
  async deleteMessage(msgId: string) {
    const room = this.selectedRoom();
    if (!room) return;

    if (this.socket) {
      this.socket.emit('delete_message', {
        roomId: room._id,
        messageId: msgId,
        deleteType: 'everyone',
      });
    } else {
      const ok = await this.chatService.deleteMessage(room._id, msgId);
      if (ok) {
        this.messages.update(msgs => msgs.filter(m => m._id !== msgId));
      }
    }
  }

  // ── Reactions ──────────────────────────────────────────
  toggleReactionMenu(msgId: string) {
    this.reactionMenuMsgId.set(
      this.reactionMenuMsgId() === msgId ? null : msgId
    );
  }

  async addReaction(msgId: string, emoji: string) {
    const room = this.selectedRoom();
    if (!room) return;

    // Optimistic update
    this.messages.update(msgs =>
      msgs.map(m => {
        if (m._id !== msgId) return m;
        const existing = m.reactions ?? [];
        return {
          ...m,
          reactions: [...existing, { emoji, userId: this.currentUser?._id ?? '', username: this.currentUser?.username }]
        };
      })
    );

    this.reactionMenuMsgId.set(null);
    await this.chatService.addReaction(room._id, msgId, emoji);
  }

  // Group reactions for display: { emoji, count, hasMyReaction }
  getGroupedReactions(msg: BackendMessage): { emoji: string; count: number; mine: boolean }[] {
    if (!msg.reactions?.length) return [];
    const myId = this.currentUser?._id;
    const map = new Map<string, { count: number; mine: boolean }>();

    for (const r of msg.reactions) {
      const emoji = typeof r === 'string' ? r : r.emoji;
      const userId = typeof r === 'string' ? '' : r.userId;
      const existing = map.get(emoji) ?? { count: 0, mine: false };
      existing.count++;
      if (userId === myId) existing.mine = true;
      map.set(emoji, existing);
    }

    return [...map.entries()].map(([emoji, v]) => ({
      emoji, count: v.count, mine: v.mine,
    }));
  }

  // ── Typing indicator ───────────────────────────────────
  private emitTyping() {
    const room = this.selectedRoom();
    if (!room || !this.socket) return;
    this.socket.emit('typing', { roomId: room._id });
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.socket?.emit('stop_typing', { roomId: room._id });
    }, 2000);
  }

  // ── Create DM ──────────────────────────────────────────
  async createDM(targetUserId: string) {
    const room = await this.chatService.createDM(targetUserId);
    if (room) {
      // Add to list if not already there
      if (!this.rooms().find(r => r._id === room._id)) {
        this.rooms.update(r => [...r, room]);
      }
      this.selectRoom(room);
    }
    this.showCreateDM.set(false);
  }

  // ── Create channel ─────────────────────────────────────
  async createChannel() {
    const name = this.newChannelName().trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;

    const room = await this.chatService.createChannel(name);
    if (room) {
      this.rooms.update(r => [...r, room]);
      this.selectRoom(room);
    }
    this.newChannelName.set('');
    this.showCreateChannel.set(false);
  }

  // ── Create group ───────────────────────────────────────
  async createGroup() {
    const name = this.newGroupName().trim();
    const memberIds = this.selectedGroupMembers();
    if (!name || memberIds.length === 0) return;

    const room = await this.chatService.createGroup(name, memberIds);
    if (room) {
      this.rooms.update(r => [...r, room]);
      this.selectRoom(room);
    }
    this.newGroupName.set('');
    this.selectedGroupMembers.set([]);
    this.showCreateGroup.set(false);
  }

  toggleGroupMember(id: string) {
    this.selectedGroupMembers.update(ids =>
      ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
    );
  }

  // ── Socket.IO ──────────────────────────────────────────
  private connectSocket() {
    const token = this.auth.token();
    if (!token) return;

    try {
      import('socket.io-client').then(({ io }) => {
        this.socket = io(`${BASE}/chat`, {
          auth: { authorization: `Bearer ${token}` },
          transports: ['websocket', 'polling'],
        });

        this.socket.on('connect', () => {
          console.log('[Socket] Chat connected');
          const room = this.selectedRoom();
          if (room) this.socket.emit('join_room', { roomId: room._id });
        });

        this.socket.on('receive_message', ({ message }: { message: BackendMessage }) => {
          const room = this.selectedRoom();
          if (message.chatRoomId === room?._id) {
            this.messages.update(msgs => [...msgs, message]);
            this.shouldScroll = true;
            // Auto mark as seen
            this.chatService.markSeen(room._id, message._id);
          }
          // Update room's lastMessage
          this.rooms.update(rooms =>
            rooms.map(r =>
              r._id === message.chatRoomId
                ? { ...r, lastMessage: message, lastMessageAt: message.createdAt }
                : r
            )
          );
        });

        this.socket.on('message_sent', ({ message }: { message: BackendMessage }) => {
          const room = this.selectedRoom();
          if (message.chatRoomId === room?._id) {
            // Avoid duplicate — check if already in list
            if (!this.messages().find(m => m._id === message._id)) {
              this.messages.update(msgs => [...msgs, message]);
              this.shouldScroll = true;
            }
          }
        });

        this.socket.on('user_typing', ({ userId, username }: any) => {
          if (userId !== this.currentUser?._id) {
            this.typingUsers.update(u => u.includes(username) ? u : [...u, username]);
          }
        });

        this.socket.on('user_stopped_typing', ({ username }: any) => {
          this.typingUsers.update(u => u.filter(x => x !== username));
        });

        this.socket.on('room_created', ({ room }: { room: Conversation }) => {
          if (!this.rooms().find(r => r._id === room._id)) {
            this.rooms.update(r => [...r, room]);
          }
        });

        this.socket.on('message_edited', ({ messageId, content }: any) => {
          this.messages.update(msgs =>
            msgs.map(m => m._id === messageId ? { ...m, content, edited: true } : m)
          );
        });

        this.socket.on('message_deleted', ({ messageId, deleteType }: any) => {
          if (deleteType === 'everyone') {
            this.messages.update(msgs => msgs.filter(m => m._id !== messageId));
          }
        });

        this.socket.on('reaction_added', ({ messageId, reaction }: any) => {
          this.messages.update(msgs =>
            msgs.map(m => {
              if (m._id !== messageId) return m;
              const reactions = [...(m.reactions ?? []), reaction];
              return { ...m, reactions };
            })
          );
        });

        this.socket.on('reaction_removed', ({ messageId, userId }: any) => {
          this.messages.update(msgs =>
            msgs.map(m => {
              if (m._id !== messageId) return m;
              const reactions = (m.reactions ?? []).filter((r: any) =>
                (typeof r === 'string' ? false : r.userId !== userId)
              );
              return { ...m, reactions };
            })
          );
        });

        this.socket.on('disconnect', () => console.log('[Socket] Chat disconnected'));
        this.socket.on('socket_Error', (err: any) => console.error('[Socket] Error:', err));
      }).catch(() => {
        console.warn('[Messages] socket.io-client not installed — using REST only');
      });
    } catch { /* socket.io-client not available */ }
  }

  private disconnectSocket() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    clearTimeout(this.typingTimeout);
  }
}