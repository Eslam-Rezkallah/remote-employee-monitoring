import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.html',
  styleUrls: ['./login.css'],
})
export class LoginComponent implements OnInit {
  private fb          = inject(FormBuilder);
  private router      = inject(Router);
  private authService = inject(AuthService);

  loginForm!: FormGroup;
  showPassword = false;
  isSubmitting = false;
  errorMessage = '';

  ngOnInit(): void {
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.loginForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  get email()    { return this.loginForm.get('email')!;    }
  get password() { return this.loginForm.get('password')!; }

  togglePassword(): void { this.showPassword = !this.showPassword; }

  onSubmit(): void {
    if (this.loginForm.invalid) { this.loginForm.markAllAsTouched(); return; }
    this.isSubmitting = true;
    this.errorMessage = '';
    setTimeout(() => {
      const result = this.authService.login(this.email.value, this.password.value);
      this.isSubmitting = false;
      if (result.success) {
        this.router.navigate(['/dashboard']);
      } else {
        this.errorMessage = result.message;
      }
    }, 800);
  }
}