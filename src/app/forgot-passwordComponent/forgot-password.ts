import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Backend password pattern: min 8, uppercase, lowercase, digit, special
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

@Component({
  selector: 'app-forget-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './forgot-password.html',
  styleUrls: ['./forgot-password.css', '../../styles.css'],
})
export class ForgetPasswordComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private authService = inject(AuthService);

  forgetPasswordForm!: FormGroup;

  isSubmitting = signal(false);
  isSubmitted = signal(false);
  serverError = signal('');

  ngOnInit(): void {
    this.forgetPasswordForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  get email() {
    return this.forgetPasswordForm.get('email')!;
  }

  // ── Submit: calls PATCH /auth/forget-password ────────────
  async onSubmit(): Promise<void> {
    if (this.forgetPasswordForm.invalid) {
      this.forgetPasswordForm.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.serverError.set('');

    const result = await this.authService.forgotPassword(this.email.value);

    this.isSubmitting.set(false);

    if (result.success) {
      this.isSubmitted.set(true);
      // Navigate to the reset-password flow with the email as query param.
      setTimeout(() => {
        this.router.navigate(['/reset-password'], {
          queryParams: {
            email: this.email.value,
            flow: 'reset-password',
          },
        });
      }, 700);
    } else {
      this.serverError.set(result.message);
    }
  }
}
