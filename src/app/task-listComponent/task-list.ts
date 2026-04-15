import { Component, inject, signal, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TaskService, Task, TaskStatus } from '../services/task.service';
import { CreateTaskComponent } from '../createTaskComponent/create-task';
import { CreateSprintComponent } from '../createSprintComponent/create-sprint';
type ViewMode = 'board' | 'list';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, RouterModule, CreateSprintComponent],
  templateUrl: './task-list.html',
  styleUrls: ['../dark-theme.css', '../../styles.css', './task-list.css'],
})
export class TaskListComponent {
  spaceId = input.required<string>();
  
  taskService = inject(TaskService);

  viewMode         = signal<ViewMode>('board');
  createTaskOpen   = signal(false);
  createSprintOpen = signal(false);

  allSprints = computed(() => {
    const all = this.taskService.tasks().map(t => t.sprint);
    return [...new Set(all)].sort();
  });
  activeSprint = signal<string>('');

  currentSprint = computed(() => {
    if (this.activeSprint()) return this.activeSprint();
    return this.allSprints()[this.allSprints().length - 1] ?? '';
  });

  sprintTasks = computed(() =>
    this.taskService.tasks().filter(t => t.sprint === this.currentSprint())
  );

  todoTasks       = computed(() => this.sprintTasks().filter(t => t.status === 'todo'));
  inProgressTasks = computed(() => this.sprintTasks().filter(t => t.status === 'inprogress'));
  inReviewTasks   = computed(() => this.sprintTasks().filter(t => t.status === 'inreview'));
  doneTasks       = computed(() => this.sprintTasks().filter(t => t.status === 'done'));

  sprintStats = computed(() => {
    const tasks = this.sprintTasks();
    const total = tasks.length;
    const done  = tasks.filter(t => t.status === 'done').length;
    return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
  });

  editingTaskId = signal<string | null>(null);

  openQuickEdit(id: string, event: MouseEvent) {
    event.stopPropagation();
    this.editingTaskId.set(this.editingTaskId() === id ? null : id);
  }
  closeQuickEdit() { this.editingTaskId.set(null); }

  draggedTaskId = signal<string | null>(null);
  dragOverCol   = signal<TaskStatus | null>(null);

  onDragStart(taskId: string, event: DragEvent) {
    this.draggedTaskId.set(taskId);
    event.dataTransfer?.setData('text/plain', taskId);
    (event.target as HTMLElement).classList.add('dragging');
  }
  onDragEnd(event: DragEvent) {
    (event.target as HTMLElement).classList.remove('dragging');
    this.draggedTaskId.set(null);
    this.dragOverCol.set(null);
  }
  onDragOver(status: TaskStatus, event: DragEvent) {
    event.preventDefault();
    this.dragOverCol.set(status);
  }
  onDragLeave() { this.dragOverCol.set(null); }
  onDrop(status: TaskStatus, event: DragEvent) {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain') ?? this.draggedTaskId();
    if (id) this.taskService.updateStatus(id, status);
    this.dragOverCol.set(null);
    this.draggedTaskId.set(null);
  }

  cycleStatus(task: Task) {
    const cycle: TaskStatus[] = ['todo', 'inprogress', 'inreview', 'done'];
    const next = cycle[(cycle.indexOf(task.status) + 1) % cycle.length];
    this.taskService.updateStatus(task.id, next);
  }

  priorityColor(p: string): string {
    const map: Record<string, string> = { highest: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#10b981', lowest: '#06b6d4' };
    return map[p] ?? '#6b7280';
  }
  statusColor(s: string): string {
    const map: Record<string, string> = { todo: '#9ca3af', inprogress: '#6366f1', inreview: '#f59e0b', done: '#10b981' };
    return map[s] ?? '#9ca3af';
  }
  statusLabel(s: string): string {
    const map: Record<string, string> = { todo: 'To Do', inprogress: 'In Progress', inreview: 'In Review', done: 'Done' };
    return map[s] ?? s;
  }
  workTypeIcon(w: string): string {
    const map: Record<string, string> = { task: '✓', feature: '★', bug: '🐛', epic: '⚡' };
    return map[w] ?? '•';
  }

  columns: { status: TaskStatus; label: string; colorClass: string }[] = [
    { status: 'todo',       label: 'To Do',      colorClass: 'kh-todo'   },
    { status: 'inprogress', label: 'In Progress', colorClass: 'kh-prog'   },
    { status: 'inreview',   label: 'In Review',   colorClass: 'kh-review' },
    { status: 'done',       label: 'Done',        colorClass: 'kh-done'   },
  ];

  getColTasks(status: TaskStatus): Task[] {
    return this.sprintTasks().filter(t => t.status === status);
  }

  
}