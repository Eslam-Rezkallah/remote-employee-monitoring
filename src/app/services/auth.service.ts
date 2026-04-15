import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface User {
  _id: string;
  username: string;
  fullName?: string;
  email: string;
  password?: string;
  role: string;
  image?: any;
  orgId?: string;
}

// ── Centralised base URL ────────────────────────────────────
// Change this ONE place when you deploy to production
export const BASE = 'http://localhost:3000';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  private _currentUser = signal<User | null>(null);
  private _token = signal<string | null>(null);

  constructor() {
    const token = localStorage.getItem('rms_token');
    const stored = localStorage.getItem('rms_user');
    if (token && stored) {
      this._token.set(token);
      this._currentUser.set(JSON.parse(stored));
    }
  }

  get currentUser() {
    return this._currentUser;
  }
  get token() {
    return this._token;
  }

  isLoggedIn(): boolean {
    return !!this._token();
  }

  // ═══════════════════════════════════════════════════════════
  // LOGIN — Email/Password
  // Backend: POST /auth/login
  // Body:    { email, password }
  // Returns: { data: { accessToken, user } }
  //          OR { data: { requiresOTP: true } } if 2FA enabled
  // ═══════════════════════════════════════════════════════════
  async login(
    email: string,
    password: string,
  ): Promise<{ success: boolean; message: string; requiresOTP?: boolean }> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: any }>(`${BASE}/auth/login`, { email, password }),
      );

      // If 2FA is enabled, backend returns requiresOTP instead of a token
      if (res.data?.requiresOTP) {
        return { success: false, message: '2FA_REQUIRED', requiresOTP: true };
      }

      await this.saveSession(res.data.accessToken, res.data.user);
      return { success: true, message: 'Login successful' };
    } catch (err: any) {
      const msg = err?.error?.message || 'Invalid email or password';
      return { success: false, message: msg };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOGIN — Validate 2FA OTP
  // Backend: POST /auth/validate-login-otp
  // Body:    { email, code }
  // ═══════════════════════════════════════════════════════════
  async validateLoginOTP(
    email: string,
    code: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: { accessToken: string; user: User } }>(
          `${BASE}/auth/validate-login-otp`,
          { email, code },
        ),
      );
      await this.saveSession(res.data.accessToken, res.data.user);
      return { success: true, message: 'Login successful' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || 'Invalid OTP' };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOGIN — Google OAuth
  // Backend: POST /auth/loginWithGmail  { idToken }
  //          POST /auth/signupWithGoogle { idToken }  (auto-signup)
  // ═══════════════════════════════════════════════════════════
  async loginWithGoogle(idToken: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: { accessToken: string; user: User } }>(
          `${BASE}/auth/loginWithGmail`,
          { idToken },
        ),
      );
      await this.saveSession(res.data.accessToken, res.data.user);
      return { success: true, message: 'Login successful' };
    } catch (loginErr: any) {
      const status = loginErr?.status;

      // User not found → auto signup then login
      if (status === 404) {
        return await this.signupWithGoogle(idToken);
      }

      // Registered with different provider (email/password)
      if (status === 409) {
        return { success: false, message: 'This email is already registered with email/password.' };
      }

      return { success: false, message: loginErr?.error?.message || 'Google Sign-In failed.' };
    }
  }

  // ── Google Signup then Login ──────────────────────────────
  async signupWithGoogle(idToken: string): Promise<{ success: boolean; message: string }> {
    try {
      await firstValueFrom(this.http.post(`${BASE}/auth/signupWithGoogle`, { idToken }));

      // Signup succeeded → now login
      const loginRes = await firstValueFrom(
        this.http.post<{ message: string; data: { accessToken: string; user: User } }>(
          `${BASE}/auth/loginWithGmail`,
          { idToken },
        ),
      );
      await this.saveSession(loginRes.data.accessToken, loginRes.data.user);
      return { success: true, message: 'Account created!' };
    } catch (err: any) {
      // 409 = already exists → try login directly
      if (err?.status === 409) {
        try {
          const loginRes = await firstValueFrom(
            this.http.post<{ message: string; data: { accessToken: string; user: User } }>(
              `${BASE}/auth/loginWithGmail`,
              { idToken },
            ),
          );
          await this.saveSession(loginRes.data.accessToken, loginRes.data.user);
          return { success: true, message: 'Login successful' };
        } catch (e: any) {
          return { success: false, message: e?.error?.message || 'Login failed.' };
        }
      }
      return { success: false, message: err?.error?.message || 'Google Sign-Up failed.' };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // REGISTER — Email/Password
  // Backend: POST /auth/signup
  // Body:    { username, email, password, confirmPassword }
  // ═══════════════════════════════════════════════════════════
  async register(data: {
    fullName: string;
    email: string;
    password: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      await firstValueFrom(
        this.http.post<{ message: string; data: any }>(`${BASE}/auth/signup`, {
          username: data.fullName,
          email: data.email,
          password: data.password,
          confirmPassword: data.password,
        }),
      );
      return { success: true, message: 'Account created! Please check your email.' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || 'Registration failed.' };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FORGOT PASSWORD — Step 1: Send OTP
  // Backend: PATCH /auth/forget-password
  // Body:    { email }
  // ═══════════════════════════════════════════════════════════
  async forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.patch<{ message: string }>(`${BASE}/auth/forget-password`, { email }),
      );
      return { success: true, message: res.message || 'OTP sent to your email' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || 'Failed to send reset email' };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FORGOT PASSWORD — Step 2: Validate OTP
  // Backend: PATCH /auth/validate-forget-password
  // Body:    { email, code }
  // ═══════════════════════════════════════════════════════════
  async validateForgotPasswordOTP(
    email: string,
    code: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.patch<{ message: string }>(`${BASE}/auth/validate-forget-password`, {
          email,
          code,
        }),
      );
      return { success: true, message: res.message || 'OTP validated' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || 'Invalid OTP' };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FORGOT PASSWORD — Step 3: Reset Password
  // Backend: PATCH /auth/reset-password
  // Body:    { email, password, confirmPassword }
  // ═══════════════════════════════════════════════════════════
  async resetPassword(
    email: string,
    password: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.patch<{ message: string }>(`${BASE}/auth/reset-password`, {
          email,
          password,
          confirmPassword: password,
        }),
      );
      return { success: true, message: res.message || 'Password reset successful' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || 'Failed to reset password' };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CONFIRM EMAIL
  // Backend: PATCH /auth/confirm-email
  // Body:    { email, code }
  // ═══════════════════════════════════════════════════════════
  async confirmEmail(email: string, code: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.patch<{ message: string }>(`${BASE}/auth/confirm-email`, { email, code }),
      );
      return { success: true, message: res.message || 'Email confirmed' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || 'Invalid code' };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  private async saveSession(token: string, user?: User): Promise<void> {
    if (!user) {
      try {
        const profileRes = await firstValueFrom(
          this.http.get<{ message: string; data: { user: User } }>(`${BASE}/user/profile`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
        user = profileRes.data.user;
      } catch {
        user = {
          _id: '',
          username: '',
          email: '',
          role: 'Member',
        };
      }
    }

    user.fullName = user.fullName ?? user.username;

    this._token.set(token);
    this._currentUser.set(user);
    localStorage.setItem('rms_token', token);
    localStorage.setItem('rms_user', JSON.stringify(user));
  }

  logout(): void {
    this._currentUser.set(null);
    this._token.set(null);
    localStorage.removeItem('rms_token');
    localStorage.removeItem('rms_user');
  }

  /** Update user fields locally (used by Profile/Account after PATCH) */
  updateUser(fields: Partial<User>): void {
    const user = this._currentUser();
    if (!user) return;

    const updated = {
      ...user,
      ...fields,
      role: fields.role ?? user.role,
    };

    this._currentUser.set(updated);

    // 🔥 تأكد التخزين
    localStorage.setItem('rms_user', JSON.stringify(updated));
  }

  setOrgId(orgId: string): void {
    const user = this._currentUser();
    if (!user) return;
    const updated = { ...user, orgId };
    this._currentUser.set(updated);
    localStorage.setItem('rms_user', JSON.stringify(updated));
  }

  // FIX: Backend route is GET /org/me (not /org/my)
  getMyOrgs() {
    return this.http.get(`${BASE}/org/me`);
  }
}
