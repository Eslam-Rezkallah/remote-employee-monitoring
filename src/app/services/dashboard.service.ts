import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService, BASE } from './auth.service';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  // ── My Assigned Tasks ────────────────────────────────────
  // Backend: GET /me/tasks/assigned?orgId=…
  // Response: { data: { items: [...], total, page, limit } }
  async getMyTasks(): Promise<{ message: string; data: any[] }> {
    if (!this.orgId) return { message: 'no org', data: [] };

    try {
      const raw = await firstValueFrom(
        this.http.get<{ message: string; data: any }>(
          `${BASE}/me/tasks/assigned`,
          { params: { orgId: this.orgId, limit: '100' } }
        ),
      );

      // ✅ الباك بيرجع { data: { items: [...], total } }
      const items = raw.data?.items ?? raw.data ?? [];
      const tasks = Array.isArray(items) ? items : [];

      return {
        message: raw.message,
        data: tasks.map((t: any) => this.mapTask(t)),
      };
    } catch (err: any) {
      console.error('[DashboardService] getMyTasks error:', err?.error ?? err);
      return { message: 'error', data: [] };
    }
  }

  // ── Worked On Tasks ──────────────────────────────────────
  // Backend: GET /me/tasks/worked-on?orgId=…
  // Response: { data: { items: [...], since, meta } }
  async getWorkedOnTasks(): Promise<{ message: string; data: any[] }> {
    if (!this.orgId) return { message: 'no org', data: [] };

    try {
      const raw = await firstValueFrom(
        this.http.get<{ message: string; data: any }>(
          `${BASE}/me/tasks/worked-on`,
          { params: { orgId: this.orgId, limit: '50' } }
        ),
      );

      const items = raw.data?.items ?? raw.data ?? [];
      const tasks = Array.isArray(items) ? items : [];

      return {
        message: raw.message,
        data: tasks.map((t: any) => this.mapTask(t)),
      };
    } catch (err: any) {
      console.error('[DashboardService] getWorkedOnTasks error:', err?.error ?? err);
      return { message: 'error', data: [] };
    }
  }

  // ── Team Tasks ───────────────────────────────────────────
  // Backend: GET /me/tasks/team?orgId=…
  async getTeamTasks(): Promise<{ message: string; data: any[] }> {
    if (!this.orgId) return { message: 'no org', data: [] };

    try {
      const raw = await firstValueFrom(
        this.http.get<{ message: string; data: any }>(
          `${BASE}/me/tasks/team`,
          { params: { orgId: this.orgId, limit: '100' } }
        ),
      );

      const items = raw.data?.items ?? raw.data ?? [];
      const tasks = Array.isArray(items) ? items : [];

      return {
        message: raw.message,
        data: tasks.map((t: any) => this.mapTask(t)),
      };
    } catch (err: any) {
      console.error('[DashboardService] getTeamTasks error:', err?.error ?? err);
      return { message: 'error', data: [] };
    }
  }

  // ── Starred ──────────────────────────────────────────────
  async getStarred(): Promise<{ message: string; data: any[] }> {
    if (!this.orgId) return { message: 'no org', data: [] };
    try {
      return await firstValueFrom(
        this.http.get<{ message: string; data: any[] }>(
          `${BASE}/stars`,
          { params: { orgId: this.orgId } }
        ),
      );
    } catch {
      return { message: 'error', data: [] };
    }
  }

  // ── Notifications ────────────────────────────────────────
  async getNotifications(): Promise<{ message: string; data: any }> {
    try {
      return await firstValueFrom(
        this.http.get<{ message: string; data: any }>(
          `${BASE}/notifications`,
          { params: { limit: '50' } }
        ),
      );
    } catch {
      return { message: 'error', data: null };
    }
  }

  // ── Task mapping: backend → frontend ────────────────────
  // ✅ الباك بيرجع:
  // { _id, title, type, status, priority, assigneeId: {_id, username}, sprintId, dueDate }
  mapTask(t: any): any {
    const typeMap: Record<string, string> = {
      Task: 'task', Bug: 'bug', Story: 'feature', Epic: 'epic',
    };
    const statusMap: Record<string, string> = {
      Todo: 'todo', InProgress: 'inprogress', Done: 'done',
    };
    const prioMap: Record<string, string> = {
      Urgent: 'highest', High: 'high', Medium: 'medium', Low: 'low',
    };

    // assigneeId قد يكون object أو string
    const assigneeObj = t.assigneeId;
    const assigneeName =
      typeof assigneeObj === 'object' && assigneeObj !== null
        ? (assigneeObj.username ?? assigneeObj.fullName ?? '')
        : '';
    const assigneeId =
      typeof assigneeObj === 'object' && assigneeObj !== null
        ? assigneeObj._id
        : assigneeObj ?? null;

    const sprintName =
      typeof t.sprintId === 'object' && t.sprintId !== null
        ? t.sprintId.name ?? ''
        : '';

    return {
      id:              t._id ?? t.id,
      _id:             t._id ?? t.id,
      title:           t.title ?? '',
      description:     t.description ?? '',
      workType:        typeMap[t.type] ?? 'task',
      status:          statusMap[t.status] ?? t.status?.toLowerCase() ?? 'todo',
      priority:        prioMap[t.priority] ?? t.priority?.toLowerCase() ?? 'medium',
      assigneeId:      assigneeId,
      assignee:        assigneeName,
      assigneeInitial: (assigneeName || '?').charAt(0).toUpperCase(),
      assigneeColor:   '#6366f1',
      reporterId:      t.reporterId?._id ?? t.reporterId ?? null,
      sprint:          sprintName,
      spaceId:         t.spaceId?._id ?? t.spaceId ?? '',
      dueDate:         t.dueDate
        ? new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '',
      startDate:       t.startDate ?? '',
      logged:          0, // الباك مش بيرجع logged time في assigned tasks
      progress:        0,
      labels:          t.labels ?? [],
      points:          t.points ?? 0,
      createdAt:       t.createdAt,
      updatedAt:       t.updatedAt,
    };
  }
}