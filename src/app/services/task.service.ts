import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from './auth.service';

// ══════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ══════════════════════════════════════════════════════════

// Frontend statuses (UI-friendly)
export type TaskStatus = 'todo' | 'inprogress' | 'inreview' | 'done';
// Frontend priorities
export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';
// Frontend work types
// NOTE: Backend uses "Story" not "Feature" — mapped in conversion functions
export type WorkType = 'task' | 'feature' | 'bug' | 'epic';

export interface Task {
  id: string;
  _id?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  workType: WorkType;
  assignee: string;
  assigneeId?: string;
  assigneeInitial: string;
  assigneeColor: string;
  reporter: string;
  spaceId: string;
  sprint: string;
  sprintId?: string;
  dueDate: string;
  startDate: string;
  estimated: number;
  logged: number;
  progress: number;
  labels: string[];
  parentId?: string;
  epicId?: string;
  component: string;
}

export type CreateTaskInput = Pick<Task, 'title'> & Partial<Omit<Task, 'id' | '_id' | 'title'>>;

// ══════════════════════════════════════════════════════════
// BACKEND ↔ FRONTEND MAPPING
//
// Backend statuses: "Todo" | "InProgress" | "Done"
// Backend priorities: "Low" | "Medium" | "High" | "Urgent"
// Backend types: "Task" | "Bug" | "Story" | "Epic"
// ══════════════════════════════════════════════════════════

function mapStatus(s: string): TaskStatus {
  const map: Record<string, TaskStatus> = {
    Todo: 'todo',
    ToDo: 'todo',
    InProgress: 'inprogress',
    Done: 'done',
  };
  return map[s] ?? 'todo';
}

function toBackendStatus(s: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    todo: 'Todo',
    inprogress: 'InProgress',
    inreview: 'InProgress', // Backend has no "InReview" — maps to InProgress
    done: 'Done',
  };
  return map[s];
}

function mapPriority(p: string): TaskPriority {
  const map: Record<string, TaskPriority> = {
    Urgent: 'highest',
    High: 'high',
    Medium: 'medium',
    Low: 'low',
  };
  return map[p] ?? 'medium';
}

function toBackendPriority(p: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    highest: 'Urgent',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    lowest: 'Low', // Backend has no "Lowest" — maps to Low
  };
  return map[p];
}

// FIX: Backend uses "Story" not "Feature"
function mapWorkType(t: string): WorkType {
  const map: Record<string, WorkType> = {
    Task: 'task',
    Bug: 'bug',
    Story: 'feature', // Backend "Story" → frontend "feature"
    Epic: 'epic',
  };
  return map[t] ?? 'task';
}

function toBackendWorkType(w: WorkType): string {
  const map: Record<WorkType, string> = {
    task: 'Task',
    feature: 'Story', // Frontend "feature" → backend "Story"
    bug: 'Bug',
    epic: 'Epic',
  };
  return map[w];
}

function getTaskItems(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.tasks)) return data.tasks;
  return [];
}

function getTaskPayload(data: any): any {
  return data?.task ?? data;
}

function formatTaskDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function mapTask(t: any): Task {
  const assignee = t.assigneeId?.username ?? t.assigneeId ?? '';
  const assigneeName = typeof assignee === 'string' ? assignee : '';
  return {
    id:              t._id,
    _id:             t._id,
    title:           t.title ?? '',
    description:     t.description ?? '',
    status:          mapStatus(t.status),
    priority:        mapPriority(t.priority),
    workType:        mapWorkType(t.type),
    assignee:        assigneeName,
    assigneeId:      typeof t.assigneeId === 'object' ? t.assigneeId?._id : t.assigneeId,
    assigneeInitial: assigneeName.charAt(0).toUpperCase() || '?',
    assigneeColor:   '#6366f1',
    reporter:        typeof t.reporterId === 'object' ? (t.reporterId?.username ?? '') : '',
    spaceId:         typeof t.spaceId === 'object' ? t.spaceId?._id : (t.spaceId ?? ''),
    sprint:          typeof t.sprintId === 'object' ? (t.sprintId?.name ?? '') : (t.sprintId ?? ''),
    sprintId:        typeof t.sprintId === 'object' ? t.sprintId?._id : t.sprintId,
    // ✅ FIX: بنحفظ الـ raw ISO date عشان الـ calendar يشتغل
    dueDate:         t.dueDate ? t.dueDate : '', // raw ISO — للـ calendar
    startDate:       t.startDate ? t.startDate : '',
    estimated:       t.points ?? 0,
    logged:          0,
    progress:        t.status === 'Done' ? 100 : t.status === 'InProgress' ? 50 : 0,
    labels:          t.labels ?? [],
    parentId:        t.parentTaskId ?? undefined,
    component:       t.labels?.[0] ?? '',
  };
}

// ✅ فضلنا formatTaskDate بس للـ display في الـ UI مش للتخزين

// ══════════════════════════════════════════════════════════
// SERVICE
// ══════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class TaskService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  private _tasks = signal<Task[]>([]);
  private _extraSprints = signal<string[]>([]);
  private _loading = signal(false);
  private _currentSpaceId = signal<string>('');

  readonly tasks = this._tasks.asReadonly();
  readonly loading = this._loading.asReadonly();

  // ── Load tasks for a space ────────────────────────────────
  // Backend: GET /org/:orgId/spaces/:spaceId/tasks?limit=200
  async loadTasks(spaceId: string): Promise<void> {
    if (!this.orgId || !spaceId) return;
    this._loading.set(true);
    this._currentSpaceId.set(spaceId);
    try {
      const res = await firstValueFrom(
        this.http.get<{ message: string; data: any }>(
          `${BASE}/org/${this.orgId}/spaces/${spaceId}/tasks?limit=200`,
        ),
      );
      const mapped = getTaskItems(res?.data).map(mapTask);
      // Set spaceId on mapped tasks (backend returns it as ObjectId)
      mapped.forEach((t) => (t.spaceId = spaceId));

      this._tasks.update((existing) => {
        const otherSpaces = existing.filter((t) => t.spaceId !== spaceId);
        return [...otherSpaces, ...mapped];
      });
    } catch (err) {
      console.error('[TaskService] loadTasks error:', err);
    } finally {
      this._loading.set(false);
    }
  }

  // ── Create task ───────────────────────────────────────────
  // Backend: POST /org/:orgId/spaces/:spaceId/tasks
  async createTask(spaceId: string, data: CreateTaskInput): Promise<Task | null> {
    if (!this.orgId || !spaceId) return null;
    try {
      const labels = data.labels?.map((label) => label.trim()).filter(Boolean) ?? [];
      const points = Number(data.estimated ?? 0);
      const body: any = {
        title: data.title.trim(),
        type: toBackendWorkType(data.workType ?? 'task'),
        status: toBackendStatus(data.status ?? 'todo'),
        priority: toBackendPriority(data.priority ?? 'medium'),
      };

      if (data.description?.trim()) body.description = data.description.trim();
      if (labels.length) body.labels = labels;
      if (Number.isFinite(points) && points > 0) body.points = points;

      // Only include if set
      if (data.dueDate) body.dueDate = new Date(data.dueDate).toISOString();
      if (data.startDate) body.startDate = new Date(data.startDate).toISOString();
      if (data.parentId?.trim()) body.parentTaskId = data.parentId.trim();
      if (data.assigneeId) body.assigneeId = data.assigneeId;
      if (data.sprintId) body.sprintId = data.sprintId;

      const res = await firstValueFrom(
        this.http.post<{ message: string; data: any }>(
          `${BASE}/org/${this.orgId}/spaces/${spaceId}/tasks`,
          body,
        ),
      );
      const newTask = mapTask(getTaskPayload(res.data));
      newTask.spaceId = spaceId;
      newTask.assignee = data.assignee ?? newTask.assignee;
      newTask.assigneeInitial = data.assigneeInitial ?? newTask.assigneeInitial;
      newTask.assigneeColor = data.assigneeColor ?? newTask.assigneeColor;
      newTask.sprint = data.sprint ?? newTask.sprint;
      newTask.component = data.component ?? newTask.component;
      this._tasks.update((t) => [...t, newTask]);
      return newTask;
    } catch (err: any) {
      console.error('[TaskService] createTask error:', err?.error ?? err);
      return null;
    }
  }

  // ── Update status (optimistic local update) ───────────────
  // NOTE: Backend currently has NO PATCH endpoint for tasks.
  // This updates locally for immediate UI feedback.
  // When backend adds PATCH, uncomment the HTTP call below.
  updateStatus(id: string, status: TaskStatus) {
    const progress = status === 'done' ? 100 : status === 'inprogress' ? 50 : 0;
    this._tasks.update((t) => t.map((x) => (x.id === id ? { ...x, status, progress } : x)));

    // TODO: Uncomment when backend adds PATCH /org/:orgId/spaces/:spaceId/tasks/:taskId
    // const task = this._tasks().find(t => t.id === id);
    // if (this.orgId && task?.spaceId) {
    //   this.http.patch(
    //     `${BASE}/org/${this.orgId}/spaces/${task.spaceId}/tasks/${id}`,
    //     { status: toBackendStatus(status) }
    //   ).subscribe({ error: e => console.error('[TaskService] updateStatus:', e) });
    // }
  }

  // ── Update due date ───────────────────────────────────────
  async updateDueDate(id: string, dueDate: string) {
    const task = this._tasks().find((x) => x.id === id);
    const displayDate = dueDate ? formatTaskDate(dueDate) : '';
    this._tasks.update((t) => t.map((x) => (x.id === id ? { ...x, dueDate: displayDate } : x)));

    if (!this.orgId || !task?.spaceId) return;

    try {
      const bodyDate = dueDate ? new Date(dueDate).toISOString() : null;
      await firstValueFrom(
        this.http.patch(`${BASE}/org/${this.orgId}/spaces/${task.spaceId}/tasks/${id}/due-date`, {
          dueDate: bodyDate,
        }),
      );
    } catch (err: any) {
      console.error('[TaskService] updateDueDate error:', err?.error ?? err);
    }
  }

  // ── Local addTask fallback ────────────────────────────────
  addTask(task: Omit<Task, 'id'>): Task {
    const newTask: Task = { ...task, id: 't' + Date.now() };
    this._tasks.update((t) => [...t, newTask]);
    return newTask;
  }

  // ── Getters ───────────────────────────────────────────────
  getBySpaceId(spaceId: string) {
    return computed(() => this._tasks().filter((t) => t.spaceId === spaceId));
  }

  getByStatus(spaceId: string, status: TaskStatus) {
    return computed(() =>
      this._tasks().filter((t) => t.spaceId === spaceId && t.status === status),
    );
  }

  getById(id: string): Task | undefined {
    return this._tasks().find((t) => t.id === id);
  }

  getSprints(spaceId: string): string[] {
    const fromTasks = this._tasks()
      .filter((t) => t.spaceId === spaceId)
      .map((t) => t.sprint);
    return [...new Set([...fromTasks, ...this._extraSprints()])].filter(Boolean).sort();
  }

  addSprint(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = [...this._tasks().map((t) => t.sprint), ...this._extraSprints()];
    if (existing.includes(trimmed)) return;
    this._extraSprints.update((s) => [...s, trimmed]);
  }

  getAllSprints(): string[] {
    const fromTasks = this._tasks().map((t) => t.sprint);
    return [...new Set([...fromTasks, ...this._extraSprints()])].filter(Boolean).sort();
  }

  getComponents(spaceId: string): string[] {
    const all = this._tasks()
      .filter((t) => t.spaceId === spaceId)
      .map((t) => t.component);
    return [...new Set(all)];
  }
}
