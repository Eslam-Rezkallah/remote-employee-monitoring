import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from '../services/auth.service';

function slugValidator(control: AbstractControl): ValidationErrors | null {
  const val = control.value as string;
  if (!val) return null;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(val) ? null : { invalidSlug: true };
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './onboarding.component.html',
  styleUrls: ['./onboarding.component.css'],
})
export class OnboardingComponent {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private auth = inject(AuthService);
  private http = inject(HttpClient);

  step = signal<1 | 2 | 3>(1);
  mode = signal<'create' | 'join' | null>(null);

  createForm: FormGroup = this.fb.group({
    orgName: ['', [Validators.required, Validators.minLength(2)]],
    slug: ['', [Validators.required, slugValidator]],
    logo: [null],
  });

  joinForm: FormGroup = this.fb.group({
    joinCode: ['', [Validators.required, Validators.minLength(6)]],
  });

  logoPreview = signal<string | null>(null);
  isDragging = signal(false);
  isSubmitting = signal(false);
  errorMsg = signal<string | null>(null);

  get orgName() {
    return this.createForm.get('orgName')!;
  }
  get slug() {
    return this.createForm.get('slug')!;
  }
  get inviteCode() {
    return this.joinForm.get('joinCode')!;
  }

  selectMode(m: 'create' | 'join') {
    this.mode.set(m);
    this.step.set(2);
    this.errorMsg.set(null);
  }

  goBack() {
    if (this.step() === 2) {
      this.step.set(1);
      this.mode.set(null);
      this.errorMsg.set(null);
    }
  }

  onOrgNameInput(event: Event) {
    const val = (event.target as HTMLInputElement).value;
    const generated = val
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    this.slug.setValue(generated);
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(e: DragEvent) {
    e.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.isDragging.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.handleLogoFile(file);
  }

  onFileInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.handleLogoFile(file);
  }

  handleLogoFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => this.logoPreview.set(reader.result as string);
    reader.readAsDataURL(file);
    this.createForm.patchValue({ logo: file });
  }

  removeLogo() {
    this.logoPreview.set(null);
    this.createForm.patchValue({ logo: null });
  }

  async onSubmit() {
    this.errorMsg.set(null);

    if (this.mode() === 'create') {
      if (this.createForm.invalid) {
        this.createForm.markAllAsTouched();
        return;
      }
      await this.createOrg();
    } else {
      if (this.joinForm.invalid) {
        this.joinForm.markAllAsTouched();
        return;
      }
      await this.joinOrg();
    }
  }

  // ── CREATE ORG ─────────────────────────────
  private async createOrg() {
    this.isSubmitting.set(true);

    try {
      const name = this.createForm.value.orgName?.trim();
      let slug = this.createForm.value.slug?.trim();

      if (!slug) {
        slug = name.toLowerCase().replace(/\s+/g, '-');
      }

      const payload = {
        name,
        slug,
        ownerId: this.auth.currentUser()?._id, // 🔥 FIX هنا
      };

      console.log('📦 PAYLOAD:', payload);

      const res = await firstValueFrom(
        this.http.post<{ message: string; data: any }>(`${BASE}/auth/org-create`, payload),
      );

      console.log('🔥 CREATE RESPONSE:', res.data);

      const orgId = res.data?.organization?._id;

      if (!orgId) {
        throw new Error('No orgId returned');
      }

      this.auth.setOrgId(orgId);

      this.auth.updateUser({
        role: 'owner',
      });

      this.step.set(3);

      setTimeout(() => {
        this.router.navigate(['/dashboard']);
      }, 500);
      this.auth.setOrgId(orgId);

      // 🔥 كمان خزنه في user
      this.auth.updateUser({
        orgId: orgId,
        role: 'owner',
      });
    } catch (err: any) {
      console.log('❌ ERROR BODY:', err?.error);
      console.log('❌ DETAILS:', err?.error?.details);

      this.errorMsg.set(err?.error?.message || 'Failed to create organization.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ── JOIN ORG ─────────────────────────────
  private async joinOrg() {
    this.isSubmitting.set(true);

    const token = this.joinForm.value.joinCode.trim();

    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: any }>(`${BASE}/org/invitations/accept`, {
          token: token,
        }),
      );
      console.log('JOIN RESPONSE:', res.data);
      console.log('JOIN RESPONSE:', res.data);

      const orgId = res.data?.organization?._id || res.data?.orgId || res.data?._id;

      console.log('🔥 EXTRACTED ORG ID:', orgId);

      if (orgId) {
        this.auth.updateUser({
          orgId,
          role: 'member',
        });
      }

      this.step.set(3);
      setTimeout(() => this.router.navigate(['/dashboard']), 1800);
    } catch (err: any) {
      console.log('❌ ERROR:', err?.error);
      this.errorMsg.set(err?.error?.message || 'Failed to join organization.');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
