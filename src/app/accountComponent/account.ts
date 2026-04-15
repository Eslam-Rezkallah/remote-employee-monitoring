import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from '../services/auth.service';

// Password pattern matching backend
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './account.html',
  styleUrls: ['../dark-theme.css', '../../styles.css'],
})
export class AccountComponent {
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);

  user = this.auth.currentUser;

  savedName = signal(false);
  savedPass = signal(false);
  nameError = signal<string | null>(null);
  passError = signal<string | null>(null);
  savingName = signal(false);
  savingPass = signal(false);

  nameForm = this.fb.group({
    fullName: [this.user()?.fullName ?? '', [Validators.required, Validators.minLength(2)]],
  });

  passwordForm = this.fb.group({
    oldPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.pattern(PASSWORD_PATTERN)]],
    confirmPassword: ['', [Validators.required]],
  });

  async saveName() {
    if (this.nameForm.invalid) {
      this.nameForm.markAllAsTouched();
      return;
    }
    this.savingName.set(true);
    this.nameError.set(null);
    try {
      await firstValueFrom(
        this.http.patch(`${BASE}/user/profile`, {
          username: this.nameForm.value.fullName,
        }),
      );
      this.auth.updateUser({
        fullName: this.nameForm.value.fullName!,
        username: this.nameForm.value.fullName!,
      });
      this.savedName.set(true);
      setTimeout(() => this.savedName.set(false), 2500);
    } catch (err: any) {
      this.nameError.set(err?.error?.message || 'Failed to update name.');
    } finally {
      this.savingName.set(false);
    }
  }

  async savePassword() {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const { oldPassword, newPassword, confirmPassword } = this.passwordForm.value;
    if (newPassword !== confirmPassword) {
      this.passError.set('Passwords do not match.');
      return;
    }
    this.savingPass.set(true);
    this.passError.set(null);
    try {
      await firstValueFrom(
        this.http.patch(`${BASE}/user/profile/password`, {
          oldPassword,
          password: newPassword,
          confirmPassword,
        }),
      );
      this.savedPass.set(true);
      this.passwordForm.reset();
      setTimeout(() => this.savedPass.set(false), 2500);
    } catch (err: any) {
      this.passError.set(err?.error?.message || 'Failed to update password.');
    } finally {
      this.savingPass.set(false);
    }
  }
}
