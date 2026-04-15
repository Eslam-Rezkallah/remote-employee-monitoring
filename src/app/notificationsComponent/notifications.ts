import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NotificationService } from '../services/notification.service';

export interface Notification {
  _id: string;
  type: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
  triggeredBy?: { username: string; image?: any };
  entityType: string;
  entityId: string;
}

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './notifications.html',
  styleUrls: ['../dark-theme.css', '../../styles.css'],
})
export class NotificationsComponent implements OnInit {

  private notificationService = inject(NotificationService);

  notifications = signal<Notification[]>([]);
  loading = signal(true);
  unreadCount = signal(0);
  error = signal('');

  ngOnInit() {
    this.load();
  }

  async load() {
    this.loading.set(true);

    try {
      const res = await this.notificationService.getNotifications();

      const notifications = res?.data?.notifications ?? [];

      this.notifications.set(notifications);
      this.unreadCount.set(notifications.filter(n => !n.isRead).length);

    } catch (err: any) {
      this.error.set(err?.error?.message || 'Failed to load notifications');
    } finally {
      this.loading.set(false);
    }
  }

  async markAllRead() {
    try {
      await this.notificationService.markAllRead();

      this.notifications.update(list =>
        list.map(n => ({ ...n, isRead: true }))
      );

      this.unreadCount.set(0);

    } catch (err: any) {
      this.error.set(err?.error?.message || 'Failed to mark all as read');
    }
  }

  async markRead(id: string) {
    const wasUnread = this.notifications().some(n => n._id === id && !n.isRead);

    try {
      await this.notificationService.markRead(id);

      this.notifications.update(list =>
        list.map(n => n._id === id ? { ...n, isRead: true } : n)
      );

      if (wasUnread) {
        this.unreadCount.update(c => Math.max(0, c - 1));
      }

    } catch (err: any) {
      this.error.set(err?.error?.message || 'Failed to mark as read');
    }
  }

  async deleteNotification(id: string) {
    try {
      await this.notificationService.deleteNotification(id);

      this.notifications.update(list =>
        list.filter(n => n._id !== id)
      );

    } catch (err: any) {
      this.error.set(err?.error?.message || 'Failed to delete notification');
    }
  }

  // ── Helpers ─────────────────────────────────────────────

  timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';

    return `${days} days ago`;
  }

  getIcon(type: string): string {
    if (type.includes('comment')) return 'comment';
    if (type.includes('task')) return 'task';
    if (type.includes('sprint')) return 'sprint';
    if (type.includes('project')) return 'project';
    if (type.includes('team')) return 'team';
    return 'default';
  }
}