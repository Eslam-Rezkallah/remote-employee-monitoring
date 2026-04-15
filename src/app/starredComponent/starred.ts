import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DashboardService } from '../services/dashboard.service';

const PAGE_SIZE = 8;

@Component({
  selector: 'app-starred',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TitleCasePipe],
  templateUrl: './starred.html',
  styleUrls: ['../dark-theme.css', '../../styles.css', './starred.css'],
})
export class StarredComponent implements OnInit {
  private dashboardService = inject(DashboardService);

  items       = signal<any[]>([]);
  loading     = signal(true);
  error       = signal('');
  searchQuery = signal('');
  currentPage = signal(1);

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      const res = await this.dashboardService.getStarred();
      const raw = res?.data || [];

      // Map backend star items to what the template expects
      // Backend may return: { entityType, entityId, entity: { ... } }
      // or it may return populated objects directly.
      const mapped = raw.map((item: any) => this.mapStarItem(item));
      this.items.set(mapped);
    } catch (err: any) {
      this.error.set(err?.error?.message || 'Failed to load starred');
    } finally {
      this.loading.set(false);
    }
  }

  // Map backend star response to { kind, data } shape expected by template
  private mapStarItem(item: any): any {
    // If already has the right shape, return as-is
    if (item.kind && item.data) return item;

    // Backend shape: { entityType: 'space'|'task', entity: {...} } or populated
    const kind = item.entityType || item.type || 'task';
    const entity = item.entity || item;

    if (kind === 'space') {
      return {
        kind: 'space',
        data: {
          id:      entity._id || entity.id,
          name:    entity.name || 'Untitled Space',
          icon:    entity.icon || '📁',
          key:     entity.key || '',
          type:    entity.type || 'scrum',
          color:   entity.color || '#6366f1',
          members: entity.members?.length || entity.memberCount || 0,
          lead:    entity.lead || entity.ownerId?.username || '',
        }
      };
    } else {
      // Map backend task type → frontend workType
      const typeMap: Record<string, string> = { Task: 'task', Bug: 'bug', Story: 'feature', Epic: 'epic' };
      const statusMap: Record<string, string> = { Todo: 'todo', InProgress: 'inprogress', Done: 'done' };
      const prioMap: Record<string, string> = { Urgent: 'highest', High: 'high', Medium: 'medium', Low: 'low' };

      return {
        kind: 'task',
        data: {
          id:       entity._id || entity.id,
          title:    entity.title || 'Untitled Task',
          workType: typeMap[entity.type] || entity.workType || 'task',
          status:   statusMap[entity.status] || entity.status?.toLowerCase() || 'todo',
          priority: prioMap[entity.priority] || entity.priority?.toLowerCase() || 'medium',
          assignee: entity.assigneeId?.username || entity.assignee || '',
          sprint:   entity.sprintId?.name || entity.sprint || '',
        }
      };
    }
  }

  // ── Display ─────────────────────────────────────────────

  filteredItems = computed(() => {
    const q = this.searchQuery().toLowerCase();
    return this.items().filter(item =>
      !q ||
      item.data?.name?.toLowerCase().includes(q) ||
      item.data?.title?.toLowerCase().includes(q)
    );
  });

  allStarred = computed(() => this.filteredItems());

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.allStarred().length / PAGE_SIZE))
  );

  pagedItems = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.allStarred().slice(start, start + PAGE_SIZE);
  });

  pages = computed(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1)
  );

  goToPage(p: number) {
    if (p < 1 || p > this.totalPages()) return;
    this.currentPage.set(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  onSearch() {
    this.currentPage.set(1);
  }

  // ── Type guards ─────────────────────────────────────────

  isSpace(item: any): boolean {
    return item?.kind === 'space';
  }

  isTask(item: any): boolean {
    return item?.kind === 'task';
  }

  toggleStar(id: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    // Optimistic remove
    this.items.update(list => list.filter(i => (i.data?._id || i.data?.id) !== id));
  }

  // ── UI helpers ──────────────────────────────────────────

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
      task: '✓', feature: '★', bug: '🐛', epic: '⚡',
    };
    return map[w] ?? '•';
  }
}