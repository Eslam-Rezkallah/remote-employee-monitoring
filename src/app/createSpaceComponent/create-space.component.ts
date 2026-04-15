import { Component, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { SpaceService } from '../services/space.service';

const ICONS  = ['⚙️','🎨','📣','📋','🧪','🚀','💡','📊','🔐','🌐','🎯','💬','📁','🏆','⭐','🔥','💎','🛠️','📱','🎵'];
const COLORS = ['#6366f1','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16','#f97316','#0ea5e9'];

@Component({
  selector: 'app-create-space',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-space.component.html',
  styleUrls: ['./create-space.component.css'],
})
export class CreateSpaceComponent {
  private spaceService = inject(SpaceService);
  private router       = inject(Router);
  private fb           = inject(FormBuilder);

  close = output<void>();

  icons  = ICONS;
  colors = COLORS;

  selectedIcon  = signal('⚙️');
  selectedColor = signal('#6366f1');
  isSubmitting  = signal(false);
  errorMsg      = signal<string | null>(null);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    key:  ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{2,6}$/)]],
    type: ['engineering', [Validators.required]],
  });

  get name() { return this.form.get('name')!; }
  get key()  { return this.form.get('key')!;  }

  onNameInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.key.setValue(val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4));
  }

  selectIcon(icon: string)   { this.selectedIcon.set(icon);  }
  selectColor(color: string) { this.selectedColor.set(color); }

  async onSubmit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.isSubmitting.set(true);
    this.errorMsg.set(null);

    const space = await this.spaceService.addSpaceRemote({
      name:  this.name.value!,
      key:   this.key.value!,
      icon:  this.selectedIcon(),
      color: this.selectedColor(),
      type:  this.form.value.type!,
      lead:  'Me',
    });

    this.isSubmitting.set(false);

    if (space) {
      this.close.emit();
      this.router.navigate(['/dashboard/spaces', space.id]);
    } else {
      this.errorMsg.set('Failed to create space. Please try again.');
    }
  }
}