import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from '../services/auth.service';
import { mapTask, TaskService, Task } from '../services/task.service';

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './task-detail.html',
  styleUrls: ['../dark-theme.css', '../../styles.css'],
})
export class TaskDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private taskService = inject(TaskService);

  task = signal<Task | null>(null);
  loading = signal(true);
  errorMsg = signal<string | null>(null);

  // Comments
  comments = signal<any[]>([]);
  newComment = signal('');
  sendingComment = signal(false);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/dashboard/tasks']);
      return;
    }

    // Try local cache first
    const cached = this.taskService.getById(id);
    if (cached) {
      this.task.set(cached);
      this.loading.set(false);
      this.loadComments(id);
      return;
    }

    this.loadTaskFromBackend(id);
  }

  // ── Load from backend ─────────────────────────────────────
  private async loadTaskFromBackend(taskId: string) {
    if (!this.orgId) {
      this.loading.set(false);
      return;
    }
    try {
      // Need spaceId — scan spaces
      const spacesRes = await firstValueFrom(
        this.http.get<{ data: { items: any[] } }>(`${BASE}/org/${this.orgId}/spaces?limit=100`),
      );

      for (const space of spacesRes?.data?.items ?? []) {
        try {
          const res = await firstValueFrom(
            this.http.get<{ data: any }>(
              `${BASE}/org/${this.orgId}/spaces/${space._id}/tasks/${taskId}`,
            ),
          );
          const payload = res?.data?.task ?? res?.data;
          if (payload) {
            const task = mapTask(payload);
            task.spaceId = space._id;
            this.task.set(task);
            this.loadComments(taskId);
            break;
          }
        } catch {
          /* try next space */
        }
      }
    } catch {
      this.errorMsg.set('Failed to load task.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Comments ──────────────────────────────────────────────
  // Backend: GET /tasks/:taskId/comments
  async loadComments(taskId: string) {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: { comments: any[] } }>(`${BASE}/tasks/${taskId}/comments?limit=50`),
      );
      this.comments.set(res?.data?.comments ?? []);
    } catch {
      /* comments optional */
    }
  }

  // Backend: POST /tasks/:taskId/comments
  async sendComment() {
    if (!this.newComment().trim() || !this.task()) return;
    this.sendingComment.set(true);
    try {
      await firstValueFrom(
        this.http.post(`${BASE}/tasks/${this.task()!.id}/comments`, {
          content: this.newComment().trim(),
        }),
      );
      this.newComment.set('');
      await this.loadComments(this.task()!.id);
    } catch (err: any) {
      console.error('Comment failed:', err?.error?.message);
    } finally {
      this.sendingComment.set(false);
    }
  }

  priorityColor(p: string): string {
    const map: Record<string, string> = {
      highest: '#ef4444',
      high: '#f97316',
      medium: '#f59e0b',
      low: '#10b981',
      lowest: '#06b6d4',
    };
    return map[p] ?? '#6b7280';
  }
  statusColor(s: string): string {
    const map: Record<string, string> = {
      todo: '#9ca3af',
      inprogress: '#6366f1',
      inreview: '#f59e0b',
      done: '#10b981',
    };
    return map[s] ?? '#9ca3af';
  }
  statusLabel(s: string): string {
    const map: Record<string, string> = {
      todo: 'To Do',
      inprogress: 'In Progress',
      inreview: 'In Review',
      done: 'Done',
    };
    return map[s] ?? s;
  }
  workTypeIcon(w: string): string {
    const map: Record<string, string> = { task: '✓', feature: '★', bug: '🐛', epic: '⚡' };
    return map[w] ?? '•';
  }
}
