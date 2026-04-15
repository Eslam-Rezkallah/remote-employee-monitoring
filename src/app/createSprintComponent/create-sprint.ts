import { Component, inject, signal, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TaskService } from '../services/task.service';
import { AuthService, BASE } from '../services/auth.service';

@Component({
  selector: 'app-create-sprint',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-sprint.html',
  styleUrls: ['../createTaskComponent/create-task.css'],
})
export class CreateSprintComponent {
  private taskService = inject(TaskService);
  private auth        = inject(AuthService);
  private http        = inject(HttpClient);
  private fb          = inject(FormBuilder);

  spaceId = input<string>('');
  close   = output<void>();

  created      = signal('');
  isSubmitting = signal(false);
  errorMsg     = signal<string | null>(null);

  form = this.fb.group({
    name:      ['', [Validators.required, Validators.minLength(2)]],
    startDate: ['', Validators.required],
    endDate:   ['', Validators.required],
    goal:      [''],
  });

  get name() { return this.form.get('name')!; }
  private get orgId(): string { return this.auth.currentUser()?.orgId ?? ''; }

  // Backend: POST /org/:orgId/spaces/:spaceId/sprints
  // Body: { name, goal, startDate, endDate }
  async onSubmit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.isSubmitting.set(true);
    this.errorMsg.set(null);

    const v          = this.form.value;
    const sprintName = v.name!.trim();
    const sid        = this.spaceId();

    if (sid && this.orgId) {
      try {
        await firstValueFrom(
          this.http.post(
            `${BASE}/org/${this.orgId}/spaces/${sid}/sprints`,
            {
              name:      sprintName,
              goal:      v.goal ?? '',
              startDate: v.startDate,
              endDate:   v.endDate,
            }
          )
        );
        this.taskService.addSprint(sprintName);
        this.created.set(sprintName);
        setTimeout(() => this.close.emit(), 1200);
      } catch (err: any) {
        this.errorMsg.set(err?.error?.message || 'Failed to create sprint.');
      }
    } else {
      // Fallback: local only (no spaceId or orgId)
      this.taskService.addSprint(sprintName);
      this.created.set(sprintName);
      setTimeout(() => this.close.emit(), 1200);
    }

    this.isSubmitting.set(false);
  }
}