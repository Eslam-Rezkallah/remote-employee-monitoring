import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from './auth.service';

export type ConvType = 'channel' | 'group' | 'direct' | 'organization' | 'team';
export type MsgType  = 'text' | 'image' | 'voice' | 'file';

export interface BackendMessage {
  _id:         string;
  chatRoomId:  string;
  senderId:    { _id: string; username: string; image?: any };
  content:     string;
  messageType: MsgType;
  attachments?: { url: string; originalName: string; mimeType?: string }[];
  replyTo?:    string | BackendMessage;
  createdAt:   string;
  edited?:     boolean;
  reactions?:  { emoji: string; userId: string; username?: string }[];
  readBy?:     string[];
  deliveredTo?: string[];
}

export interface Conversation {
  _id:           string;
  name:          string | null;
  type:          ConvType;
  members:       { _id: string; username: string; image?: any }[];
  admins?:       { _id: string; username: string }[];
  lastMessage?:  any;
  lastMessageAt?: string;
  unreadCounts?: Record<string, number>;
  unreadCount?:  number;
  isDeleted?:    boolean;
  isPrivate?:    boolean;
  organizationId?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  // ── Rooms ─────────────────────────────────────────────────

  async loadRooms(): Promise<Conversation[]> {
    try {
      // ✅ استخدم /org/:orgId/chat-rooms لو في orgId
      // ده بيرجع الـ rooms مجمعة حسب النوع + unread
      if (this.orgId) {
        const res = await firstValueFrom(
          this.http.get<{ data: any }>(`${BASE}/org/${this.orgId}/chat-rooms`)
        );
        // Response: { data: { rooms: [...], grouped: {...}, total } }
        const rooms: Conversation[] = res?.data?.rooms ?? [];
        return rooms.filter(r => !r.isDeleted);
      }

      // Fallback: /chat/rooms
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(`${BASE}/chat/rooms?limit=50`)
      );
      const rooms: Conversation[] = res?.data?.rooms ?? res?.data ?? [];
      return rooms.filter(r => !r.isDeleted);

    } catch (err) {
      console.error('[ChatService] loadRooms:', err);
      return [];
    }
  }

  async getRoom(roomId: string): Promise<Conversation | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(`${BASE}/chat/rooms/${roomId}`)
      );
      return res?.data?.room ?? null;
    } catch {
      return null;
    }
  }

  async getUnreadCounts(): Promise<Record<string, number>> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(`${BASE}/chat/rooms/unread-counts`)
      );
      // Response: { data: { counts: { roomId: number }, totalUnread } }
      return res?.data?.counts ?? {};
    } catch {
      return {};
    }
  }

  // ✅ FIX: الباك بياخد { targetUserId }
  async createDM(targetUserId: string): Promise<Conversation | null> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ data: any }>(`${BASE}/chat/rooms/direct`, {
          targetUserId, // ✅ الاسم الصح
        })
      );
      return res?.data?.room ?? null;
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
        })
      );
      return res?.data?.room ?? null;
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
        })
      );
      return res?.data?.room ?? null;
    } catch (err: any) {
      console.error('[ChatService] createGroup:', err?.error?.message);
      return null;
    }
  }

  async leaveRoom(roomId: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.delete(`${BASE}/chat/rooms/${roomId}/leave`)
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Messages ───────────────────────────────────────────────

  async loadMessages(
    roomId: string,
    limit = 50,
    before?: string
  ): Promise<BackendMessage[]> {
    try {
      const params: any = { limit: String(limit) };
      if (before) params.before = before;

      const res = await firstValueFrom(
        this.http.get<{ data: any }>(
          `${BASE}/chat/rooms/${roomId}/messages`,
          { params }
        )
      );
      // Response: { data: { messages: [...], total, hasMore } }
      return res?.data?.messages ?? [];
    } catch (err) {
      console.error('[ChatService] loadMessages:', err);
      return [];
    }
  }

  async searchMessages(roomId: string, query: string): Promise<BackendMessage[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(
          `${BASE}/chat/rooms/${roomId}/messages/search`,
          { params: { q: query, page: '1', limit: '20' } }
        )
      );
      return res?.data?.messages ?? [];
    } catch {
      return [];
    }
  }

  async sendMessage(
    roomId:      string,
    content:     string,
    messageType: MsgType = 'text',
    replyTo?:    string,
  ): Promise<BackendMessage | null> {
    try {
      const body: any = { content, messageType };
      if (replyTo) body.replyTo = replyTo;

      const res = await firstValueFrom(
        this.http.post<{ data: any }>(
          `${BASE}/chat/rooms/${roomId}/messages`,
          body
        )
      );
      // Response: { data: { message: {...} } }
      return res?.data?.message ?? null;
    } catch (err: any) {
      console.error('[ChatService] sendMessage:', err?.error?.message);
      return null;
    }
  }

  async editMessage(
    roomId:    string,
    messageId: string,
    content:   string
  ): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.patch(
          `${BASE}/chat/rooms/${roomId}/messages/${messageId}`,
          { content }
        )
      );
      return true;
    } catch {
      return false;
    }
  }

  async deleteMessage(
    roomId:    string,
    messageId: string,
    deleteType: 'me' | 'everyone' = 'everyone'
  ): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.delete(
          `${BASE}/chat/rooms/${roomId}/messages/${messageId}`,
          { body: { deleteType } }
        )
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Reactions ──────────────────────────────────────────────

  // ✅ FIX: الباك بياخد { reaction } مش { emoji }
  async addReaction(
    roomId:    string,
    messageId: string,
    reaction:  string
  ): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(
          `${BASE}/chat/rooms/${roomId}/messages/${messageId}/reactions`,
          { reaction } // ✅ الاسم الصح
        )
      );
      return true;
    } catch {
      return false;
    }
  }

  async removeReaction(roomId: string, messageId: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.delete(
          `${BASE}/chat/rooms/${roomId}/messages/${messageId}/reactions`
        )
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Read Receipts ──────────────────────────────────────────

  async markSeen(roomId: string, messageId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.patch(
          `${BASE}/chat/rooms/${roomId}/messages/${messageId}/seen`,
          {}
        )
      );
    } catch { /* silent */ }
  }

  async markDelivered(roomId: string, messageId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.patch(
          `${BASE}/chat/rooms/${roomId}/messages/${messageId}/delivered`,
          {}
        )
      );
    } catch { /* silent */ }
  }

  // ── Org Members (for DM/Group pickers) ────────────────────

  async loadOrgMembers(): Promise<
    { _id: string; username: string; email: string; image?: any }[]
  > {
    if (!this.orgId) return [];
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(
          `${BASE}/org/${this.orgId}/members?page=1&limit=100`
        )
      );
      // Response: { data: { members: [{ userId: { _id, username, email }, role }] } }
      const members = res?.data?.members ?? [];
      return members
        .filter((m: any) => m.userId)
        .map((m: any) => ({
          _id:      m.userId._id ?? m.userId,
          username: m.userId.username ?? m.userId.email?.split('@')[0] ?? 'Unknown',
          email:    m.userId.email ?? '',
          image:    m.userId.image ?? null,
        }));
    } catch {
      return [];
    }
  }
}