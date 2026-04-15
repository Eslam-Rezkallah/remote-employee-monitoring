import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const MAX_ATTEMPTS = 5;
const BAN_MINUTES  = 5;   // backend bans for 5 minutes

@Component({
  selector: 'app-check-email-component',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './check-email-component.html',
  styleUrls: ['./check-email-component.css', '../../styles.css'],
})
export class CheckEmailComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private router      = inject(Router);
  private route       = inject(ActivatedRoute);
  private fb          = inject(FormBuilder);

  otpForm!:      FormGroup;
  passwordForm!: FormGroup;

  email         = signal('');
  flow          = signal<'confirm-email' | 'reset-password'>('confirm-email');
  isSubmitting  = signal(false);
  isResending   = signal(false);
  serverError   = signal('');
  successMsg    = signal('');

  // Reset-password sub-steps: 'otp' → 'new-password'
  resetStep     = signal<'otp' | 'new-password'>('otp');
  showPassword  = signal(false);

  // Ban state
  attempts       = signal(0);
  isBanned       = signal(false);
  banSecondsLeft = signal(0);
  private banTimer: any;

  ngOnInit(): void {
    const emailParam = this.route.snapshot.queryParamMap.get('email') ?? '';
    const flowParam  = this.route.snapshot.queryParamMap.get('flow') ?? 'confirm-email';

    this.email.set(emailParam);
    this.flow.set(flowParam === 'reset-password' ? 'reset-password' : 'confirm-email');

    this.otpForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]]
    });

    this.passwordForm = this.fb.group({
      password:        ['', [Validators.required, Validators.pattern(PASSWORD_PATTERN)]],
      confirmPassword: ['', [Validators.required]],
    });
  }

  get code()            { return this.otpForm.get('code')!; }
  get password()        { return this.passwordForm.get('password')!; }
  get confirmPassword() { return this.passwordForm.get('confirmPassword')!; }

  get passwordMismatch(): boolean {
    return this.password.value
      && this.confirmPassword.value
      && this.password.value !== this.confirmPassword.value
      && this.confirmPassword.touched;
  }

  togglePassword(): void { this.showPassword.update(v => !v); }

  // ══════════════════════════════════════════════════════════
  // OTP SUBMIT — handles both flows
  // ══════════════════════════════════════════════════════════
  async onSubmit(): Promise<void> {
    if (this.otpForm.invalid || this.isBanned()) return;

    this.isSubmitting.set(true);
    this.serverError.set('');
    this.successMsg.set('');

    try {
      if (this.flow() === 'confirm-email') {
        // ── Confirm email flow ────────────────────────────
        const result = await this.authService.confirmEmail(this.email(), this.code.value);

        if (result.success) {
          this.successMsg.set('Email confirmed! Redirecting to login…');
          setTimeout(() => this.router.navigate(['/login']), 1500);
        } else {
          this.handleOTPError(result.message);
        }

      } else {
        // ── Reset password flow — Step 2: Validate OTP ────
        const result = await this.authService.validateForgotPasswordOTP(this.email(), this.code.value);

        if (result.success) {
          this.successMsg.set('Code verified! Now set your new password.');
          this.resetStep.set('new-password');
        } else {
          this.handleOTPError(result.message);
        }
      }
    } catch (err: any) {
      this.handleOTPError(err?.message || 'Something went wrong.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ══════════════════════════════════════════════════════════
  // RESET PASSWORD — Step 3: Set new password
  // ══════════════════════════════════════════════════════════
  async onResetPassword(): Promise<void> {
    if (this.passwordForm.invalid || this.passwordMismatch) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.serverError.set('');
    this.successMsg.set('');

    const result = await this.authService.resetPassword(this.email(), this.password.value);

    this.isSubmitting.set(false);

    if (result.success) {
      this.successMsg.set('Password reset successful! Redirecting to login…');
      setTimeout(() => this.router.navigate(['/login']), 1500);
    } else {
      this.serverError.set(result.message);
    }
  }

  // ── OTP error handling with attempt tracking ────────────
  private handleOTPError(msg: string): void {
    const newAttempts = this.attempts() + 1;
    this.attempts.set(newAttempts);

    if (newAttempts >= MAX_ATTEMPTS) {
      this.startBan();
      this.serverError.set(`Too many failed attempts. Please try again in ${BAN_MINUTES} minutes.`);
    } else {
      this.serverError.set(`${msg} (${MAX_ATTEMPTS - newAttempts} attempts left)`);
    }
    this.otpForm.reset();
  }

  // ── Resend OTP ──────────────────────────────────────────
  async resendEmail(): Promise<void> {
    if (this.isResending() || this.isBanned()) return;

    this.isResending.set(true);
    this.serverError.set('');
    this.successMsg.set('');

    try {
      if (this.flow() === 'reset-password') {
        // Re-trigger forgot password to resend OTP
        await this.authService.forgotPassword(this.email());
      } else {
        // For confirm-email, sending a wrong code triggers backend to resend
        await this.authService.confirmEmail(this.email(), '00000');
      }
    } catch { /* expected — wrong code triggers resend */ }

    this.successMsg.set('A new code has been sent to your email.');
    this.attempts.set(0);
    this.otpForm.reset();
    this.isResending.set(false);
  }

  // ── Ban timer ───────────────────────────────────────────
  private startBan(): void {
    this.isBanned.set(true);
    this.banSecondsLeft.set(BAN_MINUTES * 60);

    this.banTimer = setInterval(() => {
      const left = this.banSecondsLeft() - 1;
      if (left <= 0) {
        this.isBanned.set(false);
        this.attempts.set(0);
        this.banSecondsLeft.set(0);
        this.serverError.set('');
        clearInterval(this.banTimer);
      } else {
        this.banSecondsLeft.set(left);
      }
    }, 1000);
  }

  get banTimeFormatted(): string {
    const s = this.banSecondsLeft();
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  ngOnDestroy(): void {
    if (this.banTimer) clearInterval(this.banTimer);
  }
}