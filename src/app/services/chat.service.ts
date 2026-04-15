import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from './auth.service';

export type ConvType = 'channel' | 'group' | 'direct' | 'organization' | 'team';
export type MsgType = 'text' | 'image' | 'voice' | 'file';

export interface BackendMessage {
  _id: string;
  chatRoomId: string;
  senderId: { _id: string; username: string; image?: any };
  content: string;
  messageType: MsgType;
  attachments?: { url: string; originalName: string; mimeType?: string }[];
  replyTo?: string | BackendMessage;
  createdAt: string;
  edited?: boolean;
  reactions?: { emoji: string; userId: string; username?: string }[];
  readBy?: string[];
  deliveredTo?: string[];
}

export interface Conversation {
  _id: string;
  name: string | null;
  type: ConvType;
  members: { _id: string; username: string; image?: any }[];
  lastMessage?: any;
  lastMessageAt?: string;
  unreadCounts?: Record<string, number>;
  isDeleted?: boolean;
  isPrivate?: boolean;
  organizationId?: string;
}

/**
 * Chat service — all REST endpoints for rooms, messages, reactions, read receipts.
 *
 * Backend endpoints:
 *   Rooms:
 *     GET    /org/:orgId/chat-rooms              → list rooms for org
 *     GET    /chat/rooms?page=1&limit=50         → list rooms (generic)
 *     GET    /chat/rooms/:roomId                 → single room details
 *     GET    /chat/rooms/unread-counts            → unread counts per room
 *     POST   /chat/rooms/direct                   → create DM
 *     POST   /chat/rooms/channel                  → create channel
 *     POST   /chat/rooms/group                    → create group
 *     PATCH  /chat/rooms/:roomId                  → update room
 *     DELETE /chat/rooms/:roomId                  → delete room
 *     POST   /chat/rooms/:roomId/join             → join channel
 *     DELETE /chat/rooms/:roomId/leave            → leave room
 *     POST   /chat/rooms/:roomId/members/:userId  → add member
 *     DELETE /chat/rooms/:roomId/members/:userId  → remove member
 *
 *   Messages:
 *     GET    /chat/rooms/:roomId/messages?limit=50    → load messages
 *     GET    /chat/rooms/:roomId/messages/search?q=…  → search messages
 *     POST   /chat/rooms/:roomId/messages             → send message
 *     PATCH  /chat/rooms/:roomId/messages/:msgId      → edit message
 *     DELETE /chat/rooms/:roomId/messages/:msgId      → delete message
 *
 *   Reactions:
 *     POST   /chat/rooms/:roomId/messages/:msgId/reactions    → add reaction
 *     GET    /chat/rooms/:roomId/messages/:msgId/reactions    → get reactions
 *     DELETE /chat/rooms/:roomId/messages/:msgId/reactions    → remove reaction
 *
 *   Read Receipts:
 *     PATCH  /chat/rooms/:roomId/messages/:msgId/seen         → mark seen
 *     PATCH  /chat/rooms/:roomId/messages/:msgId/delivered     → mark delivered
 *
 *   Calls:
 *     GET    /chat/rooms/:roomId/calls?page=1&limit=20  → call history
 *     GET    /chat/rooms/:roomId/calls/active             → active call
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  // ── Rooms ───────────────────────────────────────────────

  async loadRooms(): Promise<Conversation[]> {
    try {
      const url = this.orgId
        ? `${BASE}/org/${this.orgId}/chat-rooms`
        : `${BASE}/chat/rooms?limit=50`;
      const res = await firstValueFrom(this.http.get<{ data: any }>(url));
      const rooms: Conversation[] = res?.data?.rooms ?? res?.data ?? [];
      return rooms.filter((r) => !r.isDeleted);
    } catch (err) {
      console.error('[ChatService] loadRooms:', err);
      return [];
    }
  }

  async getRoom(roomId: string): Promise<Conversation | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(`${BASE}/chat/rooms/${roomId}`),
      );
      return res?.data?.room ?? res?.data ?? null;
    } catch {
      return null;
    }
  }

  async getUnreadCounts(): Promise<Record<string, number>> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(`${BASE}/chat/rooms/unread-counts`),
      );
      return res?.data ?? {};
    } catch {
      return {};
    }
  }

  async createDM(targetUserId: string): Promise<Conversation | null> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ data: any }>(`${BASE}/chat/rooms/direct`, {
          memberId: targetUserId,
          organizationId: this.orgId || undefined,
        }),
      );
      return res?.data?.room ?? res?.data ?? null;
    } catch (err: any) {
      console.error('[ChatService] createDM:', err?.error?.message);
      return null;
    }
  }

  async createChannel(name: string, isPrivate = false): Promise<Conversation | null> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ data: any }>(`${BASE}/chat/rooms/channel`, {
          name,
          organizationId: this.orgId,
          isPrivate,
        }),
      );
      return res?.data?.room ?? res?.data ?? null;
    } catch (err: any) {
      console.error('[ChatService] createChannel:', err?.error?.message);
      return null;
    }
  }

  async createGroup(name: string, memberIds: string[]): Promise<Conversation | null> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ data: any }>(`${BASE}/chat/rooms/group`, {
          name,
          organizationId: this.orgId,
          memberIds,
        }),
      );
      return res?.data?.room ?? res?.data ?? null;
    } catch (err: any) {
      console.error('[ChatService] createGroup:', err?.error?.message);
      return null;
    }
  }

  async leaveRoom(roomId: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.delete(`${BASE}/chat/rooms/${roomId}/leave`));
      return true;
    } catch {
      return false;
    }
  }

  // ── Messages ────────────────────────────────────────────

  async loadMessages(roomId: string, limit = 50, before?: string): Promise<BackendMessage[]> {
    try {
      let url = `${BASE}/chat/rooms/${roomId}/messages?limit=${limit}`;
      if (before) url += `&before=${before}`;
      const res = await firstValueFrom(this.http.get<{ data: any }>(url));
      return res?.data?.messages ?? res?.data ?? [];
    } catch (err) {
      console.error('[ChatService] loadMessages:', err);
      return [];
    }
  }

  async searchMessages(roomId: string, query: string): Promise<BackendMessage[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(`${BASE}/chat/rooms/${roomId}/messages/search`, {
          params: { q: query, page: '1', limit: '20' },
        }),
      );
      return res?.data?.messages ?? [];
    } catch {
      return [];
    }
  }

  async sendMessage(
    roomId: string,
    content: string,
    messageType: MsgType = 'text',
    replyTo?: string,
  ): Promise<BackendMessage | null> {
    try {
      const body: any = { content, messageType };
      if (replyTo) body.replyTo = replyTo;
      const res = await firstValueFrom(
        this.http.post<{ data: any }>(`${BASE}/chat/rooms/${roomId}/messages`, body),
      );
      return res?.data?.message ?? res?.data ?? null;
    } catch (err: any) {
      console.error('[ChatService] sendMessage:', err?.error?.message);
      return null;
    }
  }

  async editMessage(roomId: string, messageId: string, content: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.patch(`${BASE}/chat/rooms/${roomId}/messages/${messageId}`, { content }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async deleteMessage(roomId: string, messageId: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.delete(`${BASE}/chat/rooms/${roomId}/messages/${messageId}`));
      return true;
    } catch {
      return false;
    }
  }

  // ── Reactions ───────────────────────────────────────────

  async addReaction(roomId: string, messageId: string, emoji: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(`${BASE}/chat/rooms/${roomId}/messages/${messageId}/reactions`, { emoji }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async removeReaction(roomId: string, messageId: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.delete(`${BASE}/chat/rooms/${roomId}/messages/${messageId}/reactions`),
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Read Receipts ───────────────────────────────────────

  async markSeen(roomId: string, messageId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.patch(`${BASE}/chat/rooms/${roomId}/messages/${messageId}/seen`, {}),
      );
    } catch {
      /* silent */
    }
  }

  async markDelivered(roomId: string, messageId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.patch(`${BASE}/chat/rooms/${roomId}/messages/${messageId}/delivered`, {}),
      );
    } catch {
      /* silent */
    }
  }

  // ── Org Members (for DM/Group pickers) ──────────────────

  async loadOrgMembers(): Promise<{ _id: string; username: string; email: string; image?: any }[]> {
    if (!this.orgId) return [];
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(`${BASE}/org/${this.orgId}/members?page=1&limit=100`),
      );
      const members = res?.data?.members ?? [];
      return members
        .filter((m: any) => m.userId)
        .map((m: any) => ({
          _id: m.userId._id ?? m.userId,
          username: m.userId.username ?? m.userId.email?.split('@')[0] ?? 'Unknown',
          email: m.userId.email ?? '',
          image: m.userId.image ?? null,
        }));
    } catch {
      return [];
    }
  }
}
