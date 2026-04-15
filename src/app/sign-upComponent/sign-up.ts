import {
  Component,
  OnInit,
  AfterViewInit,
  inject,
  signal,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidatorFn,
  ValidationErrors,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';

declare const google: any;

const passwordMatchValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const pw = group.get('password')?.value;
  const cpw = group.get('confirmPassword')?.value;
  return pw && cpw && pw !== cpw ? { passwordMismatch: true } : null;
};

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

@Component({
  selector: 'app-sign-up',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './sign-up.html',
  styleUrls: ['./sign-up.css', '../../styles.css'],
})
export class SignUpComponent implements OnInit, AfterViewInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private authService = inject(AuthService);

  @ViewChild('googleBtn') googleBtnRef!: ElementRef;

  private readonly GOOGLE_CLIENT_ID =
    '24506607384-rums4fal2k0fjc4vcnr99kkmr878d4u3.apps.googleusercontent.com';

  signUpForm!: FormGroup;
  isSubmitting = signal(false);
  showPassword = signal(false);
  showConfirmPassword = signal(false);
  serverError = signal('');

  ngOnInit(): void {
    this.signUpForm = this.fb.group(
      {
        fullName: ['', [Validators.required, Validators.minLength(2)]],
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.pattern(PASSWORD_PATTERN)]],
        confirmPassword: ['', [Validators.required]],
      },
      { validators: passwordMatchValidator },
    );

    this.loadGoogleSDK();
  }

  ngAfterViewInit(): void {}

  get fullName() {
    return this.signUpForm.get('fullName')!;
  }
  get email() {
    return this.signUpForm.get('email')!;
  }
  get password() {
    return this.signUpForm.get('password')!;
  }
  get confirmPassword() {
    return this.signUpForm.get('confirmPassword')!;
  }

  get mismatch(): boolean {
    return !!this.signUpForm.errors?.['passwordMismatch'] && this.confirmPassword.touched;
  }

  togglePassword(): void {
    this.showPassword.update((v) => !v);
  }
  toggleConfirmPassword(): void {
    this.showConfirmPassword.update((v) => !v);
  }

  private goAfterAuth(): void {
    const user = this.authService.currentUser();
    this.router.navigate([user?.orgId ? '/dashboard' : '/onboarding']);
  }

  // ── Email/Password Signup ────────────────────────────────
  async onSubmit(): Promise<void> {
    if (this.signUpForm.invalid) {
      this.signUpForm.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.serverError.set('');

    const result = await this.authService.register({
      fullName: this.fullName.value,
      email: this.email.value,
      password: this.password.value,
    });

    this.isSubmitting.set(false);

    if (result.success) {
      this.router.navigate(['/confirm-email'], {
        queryParams: { email: this.email.value },
      });
    } else {
      this.serverError.set(result.message);
    }
  }

  // ── Google OAuth ─────────────────────────────────────────
  private loadGoogleSDK(): void {
    if (typeof google !== 'undefined' && google?.accounts?.id) {
      setTimeout(() => this.renderGoogleButton(), 100);
      return;
    }

    if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
      const check = setInterval(() => {
        if (typeof google !== 'undefined' && google?.accounts?.id) {
          clearInterval(check);
          setTimeout(() => this.renderGoogleButton(), 100);
        }
      }, 100);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setTimeout(() => this.renderGoogleButton(), 100);
    document.head.appendChild(script);
  }

  private renderGoogleButton(): void {
    if (!this.googleBtnRef?.nativeElement) {
      setTimeout(() => this.renderGoogleButton(), 200);
      return;
    }

    google.accounts.id.initialize({
      client_id: this.GOOGLE_CLIENT_ID,
      callback: (response: any) => this.handleGoogleResponse(response),
      ux_mode: 'popup',
    });

    this.googleBtnRef.nativeElement.innerHTML = '';

    google.accounts.id.renderButton(this.googleBtnRef.nativeElement, {
      theme: 'outline',
      size: 'large',
      width: 380,
      text: 'signup_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      locale: 'en',
    });
  }

  private async handleGoogleResponse(response: any): Promise<void> {
    const idToken = response?.credential;
    if (!idToken) {
      this.serverError.set('Google Sign-Up failed. Please try again.');
      return;
    }

    this.isSubmitting.set(true);
    this.serverError.set('');

    // signupWithGoogle tries signup → then auto-login
    // If already exists (409), it falls back to login
    const result = await this.authService.signupWithGoogle(idToken);

    this.isSubmitting.set(false);

    if (result.success) {
      this.goAfterAuth();
    } else {
      this.serverError.set(result.message);
    }
  }

  // FIX: replaced the dummy method with Google SDK flow above
  signUpWithGoogle(): void {
    // This is now handled by the Google SDK button rendered via renderGoogleButton()
    // Keeping this as a no-op for the manual button fallback in the template
  }
}
