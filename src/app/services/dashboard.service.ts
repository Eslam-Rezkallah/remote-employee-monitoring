import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService, BASE } from './auth.service';
import { firstValueFrom } from 'rxjs';

/**
 * Dashboard service — connects to real backend endpoints.
 *
 * Backend endpoints used:
 *   GET /me/tasks/assigned?orgId=…         → my tasks
 *   GET /stars?orgId=…                     → starred items
 *   GET /notifications?limit=…             → notifications
 *   GET /org/:orgId/spaces/:spaceId/…      → metrics (per-space)
 *
 * NOTE: There is NO global /metrics endpoint. KPIs on the dashboard
 *       home page are computed client-side from task data.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  // ── My Tasks ────────────────────────────────────────────
  // Backend: GET /me/tasks/assigned?orgId=…
  // Returns { message, data: [ task, … ] }
  async getMyTasks(): Promise<{ message: string; data: any[] }> {
    const raw = await firstValueFrom(
      this.http.get<{ message: string; data: any }>(`${BASE}/me/tasks/assigned`, {
        params: { orgId: this.orgId },
      }),
    );

    // 🔥 حل المشكلة
    const tasks = Array.isArray(raw.data) ? raw.data : raw.data?.tasks || raw.data?.data || [];

    const mapped = tasks.map((t: any) => this.mapTask(t));

    return { message: raw.message, data: mapped };
  }

  // ── Starred ─────────────────────────────────────────────
  // Backend: GET /stars?orgId=…
  async getStarred(): Promise<{ message: string; data: any[] }> {
    return await firstValueFrom(
      this.http.get<{ message: string; data: any[] }>(`${BASE}/stars`, {
        params: { orgId: this.orgId },
      }),
    );
  }

  // ── Notifications ───────────────────────────────────────
  // Backend: GET /notifications?limit=…
  async getNotifications(): Promise<{ message: string; data: any }> {
    return await firstValueFrom(
      this.http.get<{ message: string; data: any }>(`${BASE}/notifications`, {
        params: { limit: '50' },
      }),
    );
  }

  // ── Metrics (no global endpoint — returns null) ─────────
  // KPIs are computed from tasks in the dashboard-home component.
  // This method exists only for backward compatibility.
  async getMetrics(): Promise<{ message: string; data: any }> {
    // No global /metrics endpoint exists.
    // Return empty shell so callers don't crash.
    return { message: 'ok', data: null };
  }

  // ── Reports (kept for backward compat — use ReportsService instead)
  async getReports(): Promise<{ message: string; data: any }> {
    return { message: 'ok', data: null };
  }

  // ── Task mapping: backend → frontend ────────────────────
  private mapTask(t: any): any {
    // Backend type → frontend workType
    const typeMap: Record<string, string> = {
      Task: 'task',
      Bug: 'bug',
      Story: 'feature',
      Epic: 'epic',
    };
    // Backend status → frontend status
    const statusMap: Record<string, string> = {
      Todo: 'todo',
      InProgress: 'inprogress',
      Done: 'done',
    };
    // Backend priority → frontend priority
    const prioMap: Record<string, string> = {
      Urgent: 'highest',
      High: 'high',
      Medium: 'medium',
      Low: 'low',
    };

    const assigneeName = t.assigneeId?.username ?? t.assigneeId?.fullName ?? t.assignee ?? '';

    const sprintName = t.sprintId?.name ?? t.sprint ?? '';

    return {
      id: t._id ?? t.id,
      title: t.title ?? '',
      description: t.description ?? '',
      workType: typeMap[t.type] ?? t.workType ?? 'task',
      status: statusMap[t.status] ?? t.status?.toLowerCase() ?? 'todo',
      priority: prioMap[t.priority] ?? t.priority?.toLowerCase() ?? 'medium',
      assignee: assigneeName,
      assigneeInitial: (assigneeName || '?').charAt(0).toUpperCase(),
      assigneeColor: '#6366f1',
      reporter: t.reporterId?.username ?? t.reporter ?? '',
      sprint: sprintName,
      spaceId: t.spaceId?._id ?? t.spaceId ?? '',
      dueDate: t.dueDate
        ? new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '',
      startDate: t.startDate ?? '',
      estimated: t.estimatedTime ?? t.estimated ?? 0,
      logged: t.loggedTime ?? t.logged ?? 0,
      progress: t.progress ?? 0,
      labels: t.labels ?? [],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}
