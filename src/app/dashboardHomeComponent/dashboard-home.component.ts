import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DashboardService } from '../services/dashboard.service';
import { AuthService } from '../services/auth.service';

type PanelFilter = 'all' | 'todo' | 'inprogress' | 'done';

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [CommonModule, RouterModule, TitleCasePipe],
  templateUrl: './dashboard-home.html',
  styleUrls: ['../dark-theme.css', '../../styles.css', './dashboard-home.css'],
})
export class DashboardHomeComponent implements OnInit {
  private dashboardService = inject(DashboardService);
  private auth = inject(AuthService);

  currentUser = this.auth.currentUser;

  // ── STATE ────────────────────────────────────────────────
  assignedTasks  = signal<any[]>([]); // /me/tasks/assigned
  workedOnRaw    = signal<any[]>([]); // /me/tasks/worked-on
  teamTasksRaw   = signal<any[]>([]); // /me/tasks/team
  loading        = signal(true);
  error          = signal('');

  // ── FILTERS ──────────────────────────────────────────────
  workedOnFilter   = signal<PanelFilter>('all');
  assignedMeFilter = signal<PanelFilter>('all');
  teamFilter       = signal<PanelFilter>('all');
  selectedAssignee = signal<string>('all');

  filterOptions: { value: PanelFilter; label: string }[] = [
    { value: 'all',        label: 'All'         },
    { value: 'todo',       label: 'To Do'       },
    { value: 'inprogress', label: 'In Progress' },
    { value: 'done',       label: 'Done'        },
  ];

  // ── INIT ─────────────────────────────────────────────────
  async ngOnInit() {
    await this.loadDashboard();
  }

  async loadDashboard() {
    this.loading.set(true);
    this.error.set('');

    try {
      const [assignedRes, workedOnRes, teamRes] = await Promise.allSettled([
        this.dashboardService.getMyTasks(),
        this.dashboardService.getWorkedOnTasks(),
        this.dashboardService.getTeamTasks(),
      ]);

      if (assignedRes.status === 'fulfilled') {
        this.assignedTasks.set(assignedRes.value.data);
      }
      if (workedOnRes.status === 'fulfilled') {
        this.workedOnRaw.set(workedOnRes.value.data);
      }
      if (teamRes.status === 'fulfilled') {
        this.teamTasksRaw.set(teamRes.value.data);
      }

    } catch (err: any) {
      this.error.set(err?.error?.message || 'Failed to load dashboard');
    } finally {
      this.loading.set(false);
    }
  }

  // ── KPIs ─────────────────────────────────────────────────
  totalTasks  = computed(() => this.assignedTasks().length);
  doneTasks   = computed(() => this.assignedTasks().filter(t => t.status === 'done').length);
  todoTasks   = computed(() => this.assignedTasks().filter(t => t.status === 'todo').length);
  activeTasks = computed(() => this.assignedTasks().filter(t => t.status === 'inprogress').length);

  // ✅ FIX: totalLoggedHours مضاف
  totalLoggedHours = computed(() =>
    this.assignedTasks().reduce((sum, t) => sum + (t.logged ?? 0), 0)
  );

  completionPct = computed(() => {
    const total = this.totalTasks();
    return total > 0 ? Math.round((this.doneTasks() / total) * 100) : 0;
  });

  // ── PANELS ───────────────────────────────────────────────

  // Worked On panel — من /me/tasks/worked-on
  workedOnTasks = computed(() =>
    this.applyFilter(this.workedOnRaw(), this.workedOnFilter())
  );

  // Assigned to Me panel — من /me/tasks/assigned
  assignedToMeTasks = computed(() => {
    const myId = this.currentUser()?._id ?? '';
    const tasks = this.assignedTasks().filter(t =>
      t.assigneeId === myId || t.assigneeId?._id === myId
    );
    return this.applyFilter(tasks, this.assignedMeFilter());
  });

  // Team Tasks panel — من /me/tasks/team
  assignedToSomeoneTasks = computed(() => {
    const myId = this.currentUser()?._id ?? '';
    const tasks = this.teamTasksRaw().filter(t =>
      t.assigneeId !== myId && t.assigneeId?._id !== myId
    );
    return this.applyFilter(tasks, this.teamFilter());
  });

  otherAssignees = computed(() => {
    const myId = this.currentUser()?._id ?? '';
    const all = this.teamTasksRaw()
      .filter(t => t.assigneeId !== myId && t.assignee)
      .map(t => t.assignee);
    return [...new Set(all)] as string[];
  });

  assignedToSelectedTasks = computed(() => {
    const tasks = this.assignedToSomeoneTasks();
    const sel = this.selectedAssignee();
    return sel === 'all' ? tasks : tasks.filter(t => t.assignee === sel);
  });

  // Recent tasks — آخر 5 من الـ assigned
  recentTasks = computed(() =>
    [...this.assignedTasks()]
      .sort((a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
      )
      .slice(0, 5)
  );

  // ── HELPERS ──────────────────────────────────────────────
  private applyFilter(tasks: any[], filter: PanelFilter): any[] {
    return filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
  }

  priorityColor(p: string): string {
    const map: Record<string, string> = {
      highest: '#ef4444', high: '#f97316',
      medium: '#f59e0b', low: '#10b981', lowest: '#06b6d4',
    };
    return map[p] ?? '#6b7280';
  }

  statusColor(s: string): string {
    const map: Record<string, string> = {
      todo: '#9ca3af', inprogress: '#6366f1', done: '#10b981',
    };
    return map[s] ?? '#9ca3af';
  }

  statusLabel(s: string): string {
    const map: Record<string, string> = {
      todo: 'To Do', inprogress: 'In Progress', done: 'Done',
    };
    return map[s] ?? s;
  }

  workTypeIcon(w: string): string {
    const map: Record<string, string> = {
      task: '✓', feature: '★', bug: '🐛', epic: '⚡',
    };
    return map[w] ?? '•';
  }

  priorityBadgeClass(p: string): string {
    const map: Record<string, string> = {
      highest: 'p-high', high: 'p-high',
      medium: 'p-med', low: 'p-low', lowest: 'p-low',
    };
    return map[p] ?? 'p-med';
  }

  statusBadgeClass(s: string): string {
    const map: Record<string, string> = {
      todo: 's-todo', inprogress: 's-progress', done: 's-done',
    };
    return map[s] ?? 's-todo';
  }

  greetingTime(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  todayLabel(): string {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }
}