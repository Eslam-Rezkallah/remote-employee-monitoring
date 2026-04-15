import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DashboardService } from '../services/dashboard.service';
import { AuthService } from '../services/auth.service';

type PanelFilter = 'all' | 'todo' | 'inprogress' | 'inreview' | 'done';

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

  // ── STATE ───────────────────────────────────────────────
  tasks = signal<any[]>([]);
  loading = signal(true);
  error = signal('');

  // ── FILTERS ─────────────────────────────────────────────
  workedOnFilter    = signal<PanelFilter>('all');
  assignedMeFilter  = signal<PanelFilter>('all');
  assignedSomFilter = signal<PanelFilter>('all');

  selectedAssignee = signal<string>('all');

  filterOptions: { value: PanelFilter; label: string }[] = [
    { value: 'all',        label: 'All' },
    { value: 'todo',       label: 'To Do' },
    { value: 'inprogress', label: 'In Progress' },
    { value: 'inreview',   label: 'In Review' },
    { value: 'done',       label: 'Done' },
  ];

  // ── INIT ────────────────────────────────────────────────
  async ngOnInit() {
    await this.loadDashboard();
  }

  async loadDashboard() {
    this.loading.set(true);

    try {
      // No global /metrics endpoint — KPIs are computed from tasks.
      const tasksRes = await this.dashboardService.getMyTasks();
      this.tasks.set(tasksRes.data || []);
    } catch (err: any) {
      console.error('[Dashboard] loadDashboard error:', err);
      this.error.set(err?.error?.message || 'Failed to load dashboard');
    } finally {
      this.loading.set(false);
    }
  }

  // ── KPIs (computed from tasks) ──────────────────────────

  totalTasks   = computed(() => this.tasks().length);
  doneTasks    = computed(() => this.tasks().filter(t => t.status === 'done').length);
  todoTasks    = computed(() => this.tasks().filter(t => t.status === 'todo').length);
  activeTasks  = computed(() => this.tasks().filter(t => t.status === 'inprogress').length);

  completionPct = computed(() => {
    const total = this.totalTasks();
    return total > 0 ? Math.round((this.doneTasks() / total) * 100) : 0;
  });

  totalLogged = computed(() => {
    const sum = this.tasks().reduce((s, t) => s + (t.logged || 0), 0);
    return Math.round(sum * 10) / 10;
  });

  // ── COMPUTED ────────────────────────────────────────────

  workedOnTasks = computed(() => {
    const tasks = this.tasks().filter(t => t.logged > 0);
    return this.applyFilter(tasks, this.workedOnFilter());
  });

  assignedToMeTasks = computed(() => {
    const me = this.currentUser()?.fullName ?? '';
    const tasks = this.tasks().filter(t =>
      t.assignee?.toLowerCase() === me.toLowerCase()
    );
    return this.applyFilter(tasks, this.assignedMeFilter());
  });

  assignedToSomeoneTasks = computed(() => {
    const me = this.currentUser()?.fullName?.toLowerCase() ?? '';
    const tasks = this.tasks().filter(t =>
      t.assignee && t.assignee.toLowerCase() !== me
    );
    return this.applyFilter(tasks, this.assignedSomFilter());
  });

  otherAssignees = computed(() => {
    const me = this.currentUser()?.fullName?.toLowerCase() ?? '';
    const all = this.tasks()
      .filter(t => t.assignee && t.assignee.toLowerCase() !== me)
      .map(t => t.assignee);
    return [...new Set(all)];
  });

  assignedToSelectedTasks = computed(() => {
    const tasks = this.assignedToSomeoneTasks();
    const sel = this.selectedAssignee();
    return sel === 'all' ? tasks : tasks.filter(t => t.assignee === sel);
  });

  // Recent tasks for the bottom table (latest 5)
  recentTasks = computed(() => {
    return [...this.tasks()]
      .sort((a, b) => {
        const da = new Date(b.updatedAt || b.createdAt || 0).getTime();
        const db = new Date(a.updatedAt || a.createdAt || 0).getTime();
        return da - db;
      })
      .slice(0, 5);
  });

  // ── HELPERS ─────────────────────────────────────────────

  private applyFilter(tasks: any[], filter: PanelFilter): any[] {
    return filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
  }

  priorityColor(p: string): string {
    const map: Record<string, string> = {
      highest: '#ef4444', high: '#f97316', medium: '#f59e0b',
      low: '#10b981', lowest: '#06b6d4',
    };
    return map[p] ?? '#6b7280';
  }

  statusColor(s: string): string {
    const map: Record<string, string> = {
      todo: '#9ca3af', inprogress: '#6366f1', inreview: '#f59e0b', done: '#10b981',
    };
    return map[s] ?? '#9ca3af';
  }

  statusLabel(s: string): string {
    const map: Record<string, string> = {
      todo: 'To Do', inprogress: 'In Progress', inreview: 'In Review', done: 'Done',
    };
    return map[s] ?? s;
  }

  workTypeIcon(w: string): string {
    const map: Record<string, string> = {
      task: '✓', feature: '★', bug: '🐛', epic: '⚡'
    };
    return map[w] ?? '•';
  }

  priorityBadgeClass(p: string): string {
    const map: Record<string, string> = {
      highest: 'p-high', high: 'p-high', medium: 'p-med', low: 'p-low', lowest: 'p-low',
    };
    return map[p] ?? 'p-med';
  }

  statusBadgeClass(s: string): string {
    const map: Record<string, string> = {
      todo: 's-todo', inprogress: 's-progress', inreview: 's-progress', done: 's-done',
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
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }
}