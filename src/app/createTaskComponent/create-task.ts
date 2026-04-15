import { Component, inject, signal, input, output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TaskService, WorkType, TaskPriority } from '../services/task.service';
import { SpaceService, Space } from '../services/space.service';
import { AuthService } from '../services/auth.service';

const LABELS = ['frontend','backend','auth','design','testing','devops','docs','security','database','realtime','setup','ui'];

@Component({
  selector: 'app-create-task',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-task.html',
  styleUrls: ['./create-task.css'],
})
export class CreateTaskComponent implements OnInit {
  private taskService  = inject(TaskService);
  private spaceService = inject(SpaceService);
  private auth         = inject(AuthService);
  private fb           = inject(FormBuilder);

  spaceId = input<string>('');
  close   = output<void>();

  user           = this.auth.currentUser;
  allLabels      = LABELS;
  selectedLabels = signal<string[]>([]);
  isSubmitting   = signal(false);
  errorMsg       = signal<string | null>(null);

  // Space selector (shown when no spaceId is provided)
  availableSpaces = signal<Space[]>([]);
  selectedSpaceId = signal<string>('');
  needsSpaceSelect = signal(false);

  workTypes: { value: WorkType; label: string; icon: string; color: string }[] = [
    { value: 'task',    label: 'Task',    icon: '✓',  color: '#6366f1' },
    { value: 'feature', label: 'Feature', icon: '★',  color: '#f59e0b' },
    { value: 'bug',     label: 'Bug',     icon: '🐛', color: '#ef4444' },
    { value: 'epic',    label: 'Epic',    icon: '⚡', color: '#8b5cf6' },
  ];

  priorities: { value: TaskPriority; label: string; color: string }[] = [
    { value: 'highest', label: 'Highest', color: '#ef4444' },
    { value: 'high',    label: 'High',    color: '#f97316' },
    { value: 'medium',  label: 'Medium',  color: '#f59e0b' },
    { value: 'low',     label: 'Low',     color: '#10b981' },
    { value: 'lowest',  label: 'Lowest',  color: '#06b6d4' },
  ];

  form = this.fb.group({
    title:       ['', [Validators.required, Validators.minLength(3)]],
    description: [''],
    workType:    ['task' as WorkType],
    priority:    ['medium' as TaskPriority],
    assignee:    [''],
    sprint:      [''],
    dueDate:     [''],
    estimated:   [0],
    component:   [''],
    parentId:    [''],
  });

  get title() { return this.form.get('title')!; }

  ngOnInit() {
    // If no valid spaceId provided, show space selector
    const sid = this.spaceId();
    const isValidId = sid && sid.length >= 20; // MongoDB ObjectId = 24 chars

    if (!isValidId) {
      this.needsSpaceSelect.set(true);
      // Load spaces if not already loaded
      this.spaceService.loadSpaces().then(() => {
        this.availableSpaces.set(this.spaceService.spaces());
        // Auto-select first space
        if (this.availableSpaces().length > 0) {
          this.selectedSpaceId.set(this.availableSpaces()[0].id);
        }
      });
    } else {
      this.selectedSpaceId.set(sid);
    }
  }

  assignToMe() {
    this.form.patchValue({ assignee: this.user()?.fullName ?? '' });
  }

  toggleLabel(label: string) {
    this.selectedLabels.update(l =>
      l.includes(label) ? l.filter(x => x !== label) : [...l, label]
    );
  }

  onSpaceChange(event: Event) {
    this.selectedSpaceId.set((event.target as HTMLSelectElement).value);
  }

  async onSubmit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    // Validate spaceId
    const targetSpaceId = this.selectedSpaceId();
    if (!targetSpaceId || targetSpaceId.length < 20) {
      this.errorMsg.set('Please select a space first.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMsg.set(null);

    const v = this.form.value;
    const taskData = {
      title:           v.title!,
      description:     v.description ?? '',
      status:          'todo' as const,
      priority:        v.priority as TaskPriority,
      workType:        v.workType as WorkType,
      assignee:        v.assignee ?? '',
      assigneeInitial: (v.assignee ?? '?').charAt(0).toUpperCase(),
      assigneeColor:   '#6366f1',
      reporter:        this.user()?.fullName ?? '',
      spaceId:         targetSpaceId,
      sprint:          v.sprint ?? '',
      dueDate:         v.dueDate ?? '',
      startDate:       new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      estimated:       v.estimated ?? 0,
      logged:          0,
      progress:        0,
      labels:          this.selectedLabels(),
      parentId:        v.parentId ?? undefined,
      component:       v.component ?? '',
    };

    const result = await this.taskService.createTask(targetSpaceId, taskData);
    this.isSubmitting.set(false);

    if (result) {
      this.close.emit();
    } else {
      this.errorMsg.set('Failed to create task. Please try again.');
    }
  }
}