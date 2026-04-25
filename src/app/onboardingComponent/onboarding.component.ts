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
  private fb     = inject(FormBuilder);
  private router = inject(Router);
  private auth   = inject(AuthService);
  private http   = inject(HttpClient);

  step = signal<1 | 2 | 3>(1);
  mode = signal<'create' | 'join' | null>(null);

  createForm: FormGroup = this.fb.group({
    orgName: ['', [Validators.required, Validators.minLength(2)]],
    slug:    ['', [Validators.required, slugValidator]],
    logo:    [null],
  });

  // ✅ FIX: joinForm يقبل joinCode (8 chars) أو invitation token (64 chars hex)
  joinForm: FormGroup = this.fb.group({
    joinCode: ['', [Validators.required, Validators.minLength(8)]],
  });

  // للـ join بالـ joinCode المحتاج password
  showPasswordField = signal(false);
  joinPassword = signal('');

  logoPreview  = signal<string | null>(null);
  isDragging   = signal(false);
  isSubmitting = signal(false);
  errorMsg     = signal<string | null>(null);

  get orgName()    { return this.createForm.get('orgName')!; }
  get slug()       { return this.createForm.get('slug')!; }
  get inviteCode() { return this.joinForm.get('joinCode')!; }

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
      this.showPasswordField.set(false);
    }
  }

  onOrgNameInput(event: Event) {
    const val = (event.target as HTMLInputElement).value;
    const generated = val.toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    this.slug.setValue(generated);
  }

  // ── Drag & Drop ───────────────────────────────────────────
  onDragOver(e: DragEvent)  { e.preventDefault(); this.isDragging.set(true); }
  onDragLeave(e: DragEvent) { e.preventDefault(); this.isDragging.set(false); }

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

  // ── Submit ────────────────────────────────────────────────
  async onSubmit() {
    this.errorMsg.set(null);

    if (this.mode() === 'create') {
      if (this.createForm.invalid) { this.createForm.markAllAsTouched(); return; }
      await this.createOrg();
    } else {
      if (this.joinForm.invalid) { this.joinForm.markAllAsTouched(); return; }
      await this.joinOrg();
    }
  }

  // ── CREATE ORG ────────────────────────────────────────────
  // Backend: POST /org
  // Body: { name, slug } — ownerId بييجي من الـ token
  // Response: { message: "Organization created", data: { _id, name, slug, ... } }
  private async createOrg() {
    this.isSubmitting.set(true);

    try {
      const name = this.createForm.value.orgName?.trim();
      let slug   = this.createForm.value.slug?.trim();

      if (!slug) {
        slug = name.toLowerCase().replace(/\s+/g, '-');
      }

      const logoFile = this.createForm.value.logo;
      let body: any;

      // لو في logo، بعتها كـ FormData
      if (logoFile instanceof File) {
        const fd = new FormData();
        fd.append('name', name);
        fd.append('slug', slug);
        fd.append('logo', logoFile);
        body = fd;
      } else {
        body = { name, slug };
      }

      const res = await firstValueFrom(
        this.http.post<{ message: string; data: any }>(`${BASE}/org`, body),
      );

      // ✅ الباك بيرجع: { data: { _id, name, slug, joinCode, ... } }
      const orgId = res.data?._id;
      if (!orgId) throw new Error('No orgId returned from server');

      this.auth.setOrgId(orgId);
      this.auth.updateUser({ orgId, role: 'owner' });

      this.step.set(3);
      setTimeout(() => this.router.navigate(['/dashboard']), 1800);

    } catch (err: any) {
      this.errorMsg.set(err?.error?.message || 'Failed to create organization.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ── JOIN ORG ──────────────────────────────────────────────
  // حالتين:
  // 1. joinCode (8 chars uppercase) → POST /auth/org-join { email, password, joinCode }
  // 2. invitation token (hex 64)    → POST /invite/accept { token }
  private async joinOrg() {
    this.isSubmitting.set(true);

    const code = this.joinForm.value.joinCode.trim();

    try {
      let orgId: string | null = null;

      const isJoinCode = /^[A-Z0-9]{8}$/i.test(code);

      if (isJoinCode) {
        // ── Join بالـ joinCode ────────────────────────────
        // محتاج email و password من الـ user المسجل دخول
        const currentUser = this.auth.currentUser();
        const password    = this.joinPassword();

        if (!password) {
          // طلب الـ password من الـ user
          this.showPasswordField.set(true);
          this.errorMsg.set('Please enter your password to join with this code.');
          this.isSubmitting.set(false);
          return;
        }

        const res = await firstValueFrom(
          this.http.post<{ message: string; data: any }>(`${BASE}/auth/org-join`, {
            email:    currentUser?.email,
            password: password,
            joinCode: code.toUpperCase(),
          }),
        );

        // ✅ Response: { data: { organization: { _id, name }, membership: { role } } }
        orgId = res.data?.organization?._id;

      } else {
        // ── Join بالـ invitation token ────────────────────
        // POST /invite/accept { token }
        const res = await firstValueFrom(
          this.http.post<{ message: string; data: any }>(`${BASE}/invite/accept`, {
            token: code,
          }),
        );

        // ✅ Response: { data: { organizationId, organizationName, role } }
        orgId = res.data?.organizationId;
      }

      if (!orgId) throw new Error('No orgId returned from server');

      this.auth.setOrgId(orgId);
      this.auth.updateUser({ orgId, role: 'member' });

      this.step.set(3);
      setTimeout(() => this.router.navigate(['/dashboard']), 1800);

    } catch (err: any) {
      this.errorMsg.set(err?.error?.message || 'Failed to join organization.');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}