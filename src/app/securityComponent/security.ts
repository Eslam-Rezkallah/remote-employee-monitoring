import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from '../services/auth.service';

interface Session {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current: boolean;
}

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './security.html',
  styleUrls: ['../dark-theme.css', '../../styles.css'],
})
export class SecurityComponent implements OnInit {
  private auth   = inject(AuthService);
  private http   = inject(HttpClient);
  private router = inject(Router);
  private fb     = inject(FormBuilder);

  // ── Delete account ────────────────────────────────────────
  showDeleteConfirm = signal(false);
  deleteInput       = signal('');

  // ── 2FA state ─────────────────────────────────────────────
  twoFAEnabled  = signal(false);
  twoFALoading  = signal(false);
  twoFAError    = signal('');
  twoFASuccess  = signal('');
  showOtpInput  = signal(false);

  otpForm = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]],
  });

  // ── Read receipts ─────────────────────────────────────────
  readReceipts = signal(true);

  // ── Sessions (local — no backend endpoint for this) ───────
  sessions = signal<Session[]>([
    { id: '1', device: 'Chrome on Windows', location: 'Cairo, EG', lastActive: 'Now', current: true },
  ]);

  get code() { return this.otpForm.get('code')!; }

  ngOnInit() {
    this.loadSecuritySettings();
  }

  // ══════════════════════════════════════════════════════════
  // LOAD SECURITY SETTINGS
  // Uses GET /user/profile to check twoStepVerification flag
  // ══════════════════════════════════════════════════════════
  private async loadSecuritySettings() {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: { user: any } }>(`${BASE}/user/profile`)
      );
      const user = res?.data?.user;
      if (user) {
        this.twoFAEnabled.set(!!user.twoStepVerification);
        this.readReceipts.set(user.readReceipts !== false);
      }
    } catch (err) {
      console.error('[Security] loadSettings:', err);
    }
  }

  // ══════════════════════════════════════════════════════════
  // ENABLE 2FA — Step 1: Request OTP
  // Backend: PATCH /user/twoStepVerification
  // Body: { email }
  // Sends OTP to user's email
  // ══════════════════════════════════════════════════════════
  async request2FA() {
    this.twoFALoading.set(true);
    this.twoFAError.set('');
    this.twoFASuccess.set('');

    try {
      const email = this.auth.currentUser()?.email;
      if (!email) throw new Error('No email found');

      await firstValueFrom(
        this.http.patch(`${BASE}/user/twoStepVerification`, { email })
      );

      this.showOtpInput.set(true);
      this.twoFASuccess.set('Verification code sent to your email.');
    } catch (err: any) {
      this.twoFAError.set(err?.error?.message || 'Failed to send verification code.');
    } finally {
      this.twoFALoading.set(false);
    }
  }

  // ══════════════════════════════════════════════════════════
  // ENABLE 2FA — Step 2: Verify OTP
  // Backend: POST /auth/verify-2step-verification
  // Body: { email, code }
  // ══════════════════════════════════════════════════════════
  async verify2FA() {
    if (this.otpForm.invalid) { this.otpForm.markAllAsTouched(); return; }

    this.twoFALoading.set(true);
    this.twoFAError.set('');

    try {
      const email = this.auth.currentUser()?.email;
      await firstValueFrom(
        this.http.post(`${BASE}/auth/verify-2step-verification`, {
          email,
          code: this.code.value,
        })
      );

      this.twoFAEnabled.set(true);
      this.showOtpInput.set(false);
      this.twoFASuccess.set('Two-factor authentication enabled successfully!');
      this.otpForm.reset();
      setTimeout(() => this.twoFASuccess.set(''), 3000);
    } catch (err: any) {
      this.twoFAError.set(err?.error?.message || 'Invalid verification code.');
      this.otpForm.reset();
    } finally {
      this.twoFALoading.set(false);
    }
  }

  // ══════════════════════════════════════════════════════════
  // DISABLE 2FA
  // Backend: PATCH /user/disableTwoStepVerification
  // Body: { email }
  // ══════════════════════════════════════════════════════════
  async disable2FA() {
    this.twoFALoading.set(true);
    this.twoFAError.set('');

    try {
      const email = this.auth.currentUser()?.email;
      await firstValueFrom(
        this.http.patch(`${BASE}/user/disableTwoStepVerification`, { email })
      );

      this.twoFAEnabled.set(false);
      this.twoFASuccess.set('Two-factor authentication disabled.');
      setTimeout(() => this.twoFASuccess.set(''), 3000);
    } catch (err: any) {
      this.twoFAError.set(err?.error?.message || 'Failed to disable 2FA.');
    } finally {
      this.twoFALoading.set(false);
    }
  }

  // ══════════════════════════════════════════════════════════
  // TOGGLE READ RECEIPTS
  // Backend: PATCH /user/profile/read-receipts
  // Body: { enabled: boolean }
  // ══════════════════════════════════════════════════════════
  async toggleReadReceipts() {
    const newVal = !this.readReceipts();
    try {
      await firstValueFrom(
        this.http.patch(`${BASE}/user/profile/read-receipts`, { enabled: newVal })
      );
      this.readReceipts.set(newVal);
    } catch (err: any) {
      console.error('[Security] toggleReadReceipts:', err?.error?.message);
    }
  }

  // ── Sessions (local only) ────────────────────────────────
  revokeSession(id: string) {
    this.sessions.update(s => s.filter(x => x.id !== id));
  }

  revokeAll() {
    this.sessions.update(s => s.filter(x => x.current));
  }

  // ── Delete account ────────────────────────────────────────
  get canDelete(): boolean {
    return this.deleteInput() === 'DELETE';
  }

  deleteAccount() {
    if (!this.canDelete) return;
    // Backend doesn't have a delete-account endpoint
    // Just logout for now
    this.auth.logout();
    this.router.navigate(['/']);
  }
}