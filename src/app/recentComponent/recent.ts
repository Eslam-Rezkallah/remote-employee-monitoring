import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DashboardService } from '../services/dashboard.service';

type RecentItem = {
  kind: 'task';
  data: any;
  visitedAt: number;
};

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';

@Component({
  selector: 'app-recent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './recent.html',
  styleUrls: ['../dark-theme.css', '../../styles.css', './recent.css'],
})
export class RecentComponent implements OnInit {
  private dashboardService = inject(DashboardService);

  items = signal<RecentItem[]>([]);
  loading = signal(true);
  error = signal('');

  showAll = signal(false);
  readonly PREVIEW_COUNT = 10;

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);

    try {
      const res = await this.dashboardService.getMyTasks();

      const tasks = res?.data || [];

      const mapped = tasks.map((t: any) => ({
        kind: 'task' as const,
        data: t,
        visitedAt: new Date(t.updatedAt || t.createdAt || Date.now()).getTime(),
      }));

      this.items.set(mapped);
    } catch (err: any) {
      this.error.set(err?.error?.message || 'Failed to load recent items');
    } finally {
      this.loading.set(false);
    }
  }

  // ── DISPLAY ─────────────────────────────────────────────

  displayedItems = computed(() => {
    const items = this.items();
    return this.showAll() ? items : items.slice(0, this.PREVIEW_COUNT);
  });

  totalCount = computed(() => this.items().length);

  // ── GROUPING ────────────────────────────────────────────

  groups = computed(() => {
    const now = Date.now();
    const map = new Map<DateGroup, RecentItem[]>();
    const order: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Older'];

    order.forEach((g) => map.set(g, []));

    for (const item of this.displayedItems()) {
      const diff = now - item.visitedAt;
      const hours = diff / (1000 * 3600);

      let group: DateGroup;

      if (hours < 24) group = 'Today';
      else if (hours < 48) group = 'Yesterday';
      else if (hours < 168) group = 'This Week';
      else group = 'Older';

      map.get(group)!.push(item);
    }

    return order
      .filter((g) => map.get(g)!.length > 0)
      .map((g) => ({ label: g, items: map.get(g)! }));
  });

  // ── HELPERS ─────────────────────────────────────────────

  timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';

    return `${days} days ago`;
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

  workTypeIcon(w: string): string {
    const map: Record<string, string> = {
      task: '✓',
      feature: '★',
      bug: '🐛',
      epic: '⚡',
    };
    return map[w] ?? '•';
  }

  isTask(item: RecentItem) {
    return item.kind === 'task';
  }
  isSpace(item: any): boolean {
    return item.kind === 'space';
  }
}
