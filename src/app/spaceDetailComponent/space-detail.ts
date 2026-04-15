import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DecimalPipe, TitleCasePipe, SlicePipe } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TaskService, Task, TaskStatus } from '../services/task.service';
import { SpaceService } from '../services/space.service';
import { AuthService, BASE } from '../services/auth.service';
import { CreateTaskComponent } from '../createTaskComponent/create-task';
import { CreateSprintComponent } from '../createSprintComponent/create-sprint';

@Component({
  selector: 'app-space-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CreateTaskComponent,
    CreateSprintComponent,
    DecimalPipe,
    TitleCasePipe,
    SlicePipe,
  ],
  templateUrl: './space-detail.html',
  styleUrls: ['../dark-theme.css', '../../styles.css', './space-detail.css'],
})
export class SpaceDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private spaceService = inject(SpaceService);
  taskService = inject(TaskService);

  space = signal<any>(null);
  activeTab = signal<'summary' | 'timeline' | 'backlog' | 'board' | 'calendar'>('summary');
  createTaskOpen = signal(false);
  createSprintOpen = signal(false);

  // Backend summary data (loaded from summary endpoints)
  summaryStatus = signal<any>(null);
  summaryPriority = signal<any>(null);
  summaryWorkload = signal<any>(null);
  summaryWorkType = signal<any>(null);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  allTasks = computed(() => {
    const id = this.space()?.id;
    return id ? this.taskService.tasks().filter((t) => t.spaceId === id) : [];
  });

  todoTasks = computed(() => this.allTasks().filter((t) => t.status === 'todo'));
  inProgressTasks = computed(() => this.allTasks().filter((t) => t.status === 'inprogress'));
  inReviewTasks = computed(() => this.allTasks().filter((t) => t.status === 'inreview'));
  doneTasks = computed(() => this.allTasks().filter((t) => t.status === 'done'));

  backlogSearch = signal('');
  backlogSort = signal<'priority' | 'date' | 'title'>('priority');
  backlogFilter = signal<'all' | TaskStatus>('all');

  backlogItems = computed(() => {
    let items = this.allTasks();
    const q = this.backlogSearch().toLowerCase();
    if (q)
      items = items.filter(
        (t) => t.title.toLowerCase().includes(q) || t.labels.some((l) => l.includes(q)),
      );
    if (this.backlogFilter() !== 'all')
      items = items.filter((t) => t.status === this.backlogFilter());
    if (this.backlogSort() === 'priority') {
      const order: Record<string, number> = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 };
      items = [...items].sort((a, b) => (order[a.priority] ?? 5) - (order[b.priority] ?? 5));
    } else if (this.backlogSort() === 'title') {
      items = [...items].sort((a, b) => a.title.localeCompare(b.title));
    }
    return items;
  });

  sprints = computed(() => this.taskService.getSprints(this.space()?.id ?? ''));

  timelineAssignee = signal('all');
  assignees = computed(() => {
    const all = this.allTasks().map((t) => t.assignee);
    return ['all', ...new Set(all)];
  });
  timelineTasks = computed(() => {
    const a = this.timelineAssignee();
    return a === 'all' ? this.allTasks() : this.allTasks().filter((t) => t.assignee === a);
  });
  timelineSearch = signal('');
  filteredTimeline = computed(() => {
    const q = this.timelineSearch().toLowerCase();
    return q
      ? this.timelineTasks().filter((t) => t.title.toLowerCase().includes(q))
      : this.timelineTasks();
  });

  // Use backend summary data if available, fall back to client-side
  statusCounts = computed(() => {
    const s = this.summaryStatus();
    if (s) {
      return {
        todo: s.byStatus?.Todo ?? 0,
        inprogress: s.byStatus?.InProgress ?? 0,
        inreview: 0,
        done: s.byStatus?.Done ?? 0,
        total: s.totalTasks ?? 0,
      };
    }
    return {
      todo: this.todoTasks().length,
      inprogress: this.inProgressTasks().length,
      inreview: this.inReviewTasks().length,
      done: this.doneTasks().length,
      total: this.allTasks().length,
    };
  });

  priorityCounts = computed(() => {
    const p = this.summaryPriority();
    if (p) {
      return {
        highest: p.byPriority?.Urgent ?? 0,
        high: p.byPriority?.High ?? 0,
        medium: p.byPriority?.Medium ?? 0,
        low: p.byPriority?.Low ?? 0,
        lowest: 0,
      };
    }
    const tasks = this.allTasks();
    return {
      highest: tasks.filter((t) => t.priority === 'highest').length,
      high: tasks.filter((t) => t.priority === 'high').length,
      medium: tasks.filter((t) => t.priority === 'medium').length,
      low: tasks.filter((t) => t.priority === 'low').length,
      lowest: tasks.filter((t) => t.priority === 'lowest').length,
    };
  });

  workTypeCounts = computed(() => {
    const w = this.summaryWorkType();
    if (w) {
      return {
        task: w.byType?.Task ?? 0,
        feature: w.byType?.Story ?? 0,
        bug: w.byType?.Bug ?? 0,
        epic: w.byType?.Epic ?? 0,
      };
    }
    const tasks = this.allTasks();
    return {
      task: tasks.filter((t) => t.workType === 'task').length,
      feature: tasks.filter((t) => t.workType === 'feature').length,
      bug: tasks.filter((t) => t.workType === 'bug').length,
      epic: tasks.filter((t) => t.workType === 'epic').length,
    };
  });

  componentCounts = computed(() => {
    const map: Record<string, number> = {};
    this.allTasks().forEach((t) => {
      map[t.component] = (map[t.component] ?? 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  });

  recentActivity = computed(() =>
    [...this.allTasks()].sort((a, b) => b.logged - a.logged).slice(0, 5),
  );

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    const tryLoad = () => {
      const s = this.spaceService.getById(id);
      if (s) {
        this.space.set(s);
        this.spaceService.visitSpace(id);
        this.taskService.loadTasks(id);
        this.loadSummaries(id);
        return true;
      }
      return false;
    };

    if (!tryLoad()) {
      // Spaces not loaded yet — load them first, then retry
      this.spaceService.loadSpaces().then(() => {
        if (!tryLoad()) {
          this.router.navigate(['/dashboard/spaces']);
        }
      });
    }
  }

  // ── Load backend summaries for the Summary tab ────────────
  private async loadSummaries(spaceId: string) {
    if (!this.orgId) return;
    const base = `${BASE}/org/${this.orgId}/spaces/${spaceId}/summary`;

    try {
      const [statusRes, priorityRes, workTypeRes] = await Promise.all([
        firstValueFrom(this.http.get<{ data: any }>(`${base}/status`)).catch(() => null),
        firstValueFrom(this.http.get<{ data: any }>(`${base}/priority`)).catch(() => null),
        firstValueFrom(this.http.get<{ data: any }>(`${base}/work-type`)).catch(() => null),
      ]);

      if (statusRes?.data) this.summaryStatus.set(statusRes.data);
      if (priorityRes?.data) this.summaryPriority.set(priorityRes.data);
      if (workTypeRes?.data) this.summaryWorkType.set(workTypeRes.data);
    } catch {
      // Summaries are optional — fall back to client-side computation
    }
  }

  toggleStar() {
    if (!this.space()) return;
    this.spaceService.toggleStar(this.space()!.id);
    this.space.set(this.spaceService.getById(this.space()!.id) ?? null);
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
  statusLabel(s: string): string {
    const map: Record<string, string> = {
      todo: 'To Do',
      inprogress: 'In Progress',
      inreview: 'In Review',
      done: 'Done',
    };
    return map[s] ?? s;
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
  getPriorityCount(priority: string): number {
    return (this.priorityCounts() as any)[priority] ?? 0;
  }
  workTypeIcon(w: string): string {
    const map: Record<string, string> = { task: '✓', feature: '★', bug: '🐛', epic: '⚡' };
    return map[w] ?? '•';
  }
  getAssigneeTaskCount(a: string): number {
    return this.allTasks().filter((t) => t.assignee === a).length;
  }
  getAssigneeTaskPercent(a: string): string {
    return (this.getAssigneeTaskCount(a) / (this.statusCounts().total || 1)) * 100 + '%';
  }
  getTimelineBySprintCount(sprint: string): number {
    return this.filteredTimeline().filter((t) => t.sprint === sprint).length;
  }
  getTimelineBySprintTasks(sprint: string) {
    return this.filteredTimeline().filter((t) => t.sprint === sprint);
  }
  getSprintTasks(sprint: string) {
    return this.backlogItems().filter((t) => t.sprint === sprint);
  }

  // ── Board ──────────────────────────────────────────────────
  activeBoardSprint = signal('');
  boardDraggedId = signal<string | null>(null);
  boardDragOverCol = signal<TaskStatus | null>(null);

  currentBoardSprint = computed(
    () => this.activeBoardSprint() || (this.sprints()[this.sprints().length - 1] ?? ''),
  );
  boardTasks = computed(() =>
    this.allTasks().filter((t) => t.sprint === this.currentBoardSprint()),
  );

  getBoardColTasks(status: TaskStatus): Task[] {
    return this.boardTasks().filter((t) => t.status === status);
  }
  onBoardDragStart(id: string, e: DragEvent) {
    this.boardDraggedId.set(id);
    e.dataTransfer?.setData('text/plain', id);
  }
  onBoardDragEnd() {
    this.boardDraggedId.set(null);
    this.boardDragOverCol.set(null);
  }
  onBoardDragOver(status: TaskStatus, e: DragEvent) {
    e.preventDefault();
    this.boardDragOverCol.set(status);
  }
  onBoardDrop(status: TaskStatus, e: DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/plain') ?? this.boardDraggedId();
    if (id) this.taskService.updateStatus(id, status);
    this.boardDraggedId.set(null);
    this.boardDragOverCol.set(null);
  }

  // ── Calendar ───────────────────────────────────────────────
  calendarDate = signal(new Date());
  calendarFilter = signal<{ assignee: string; type: string; status: string }>({
    assignee: 'all',
    type: 'all',
    status: 'all',
  });
  selectedDay = signal<Date | null>(null);
  draggedCalTask = signal<string | null>(null);

  calendarYear = computed(() => this.calendarDate().getFullYear());
  calendarMonth = computed(() => this.calendarDate().getMonth());
  calendarMonthLabel = computed(() =>
    this.calendarDate().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  );
  calendarDays = computed(() => {
    const year = this.calendarYear(),
      month = this.calendarMonth();
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const days: (Date | null)[] = [];
    for (let i = 0; i < first; i++) days.push(null);
    for (let d = 1; d <= total; d++) days.push(new Date(year, month, d));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  });
  calendarTasks = computed(() => {
    let tasks = this.allTasks();
    const f = this.calendarFilter();
    if (f.assignee !== 'all') tasks = tasks.filter((t) => t.assignee === f.assignee);
    if (f.type !== 'all') tasks = tasks.filter((t) => t.workType === f.type);
    if (f.status !== 'all') tasks = tasks.filter((t) => t.status === f.status);
    return tasks;
  });
  unscheduledTasks = computed(() =>
    this.calendarTasks().filter((t) => !t.dueDate || t.dueDate.trim() === ''),
  );
  getTasksForDay(day: Date): Task[] {
    return this.calendarTasks().filter((t) => {
      if (!t.dueDate) return false;
      const parsed = new Date(t.dueDate + ', ' + this.calendarYear());
      return (
        !isNaN(parsed.getTime()) &&
        parsed.getFullYear() === day.getFullYear() &&
        parsed.getMonth() === day.getMonth() &&
        parsed.getDate() === day.getDate()
      );
    });
  }
  isToday(day: Date): boolean {
    const t = new Date();
    return (
      day.getFullYear() === t.getFullYear() &&
      day.getMonth() === t.getMonth() &&
      day.getDate() === t.getDate()
    );
  }
  prevMonth() {
    const d = this.calendarDate();
    this.calendarDate.set(new Date(d.getFullYear(), d.getMonth() - 1, 1));
    this.selectedDay.set(null);
  }
  nextMonth() {
    const d = this.calendarDate();
    this.calendarDate.set(new Date(d.getFullYear(), d.getMonth() + 1, 1));
    this.selectedDay.set(null);
  }
  selectDay(day: Date | null) {
    if (!day) return;
    this.selectedDay.set(this.selectedDay()?.toDateString() === day.toDateString() ? null : day);
  }
  onCalDragStart(taskId: string) {
    this.draggedCalTask.set(taskId);
  }
  onCalDrop(day: Date, event: DragEvent) {
    event.preventDefault();
    const id = this.draggedCalTask();
    if (!id) return;
    this.taskService.updateDueDate(id, day.toISOString());
    this.draggedCalTask.set(null);
  }
}
