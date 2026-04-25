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

  // ✅ FIX: currentUser returns the signal itself
  // استخدامها في الكومبوننت: auth.currentUser()  → User | null
  // استخدامها في الجارد:     auth.currentUser()  → User | null  (مش signal)
  get currentUser(): () => User | null {
    return this._currentUser;
  }

  get token(): () => string | null {
    return this._token;
  }

  isLoggedIn(): boolean {
    return !!this._token();
  }

  // ── LOGIN ────────────────────────────────────────────────
  async login(
    email: string,
    password: string,
  ): Promise<{ success: boolean; message: string; requiresOTP?: boolean }> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: any }>(
          `${BASE}/auth/login`,
          { email, password }
        ),
      );

      if (res.data?.requiresOTP) {
        return { success: false, message: '2FA_REQUIRED', requiresOTP: true };
      }

      await this.saveSession(res.data.accessToken, res.data.user);
      return { success: true, message: 'Login successful' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || 'Invalid email or password' };
    }
  }

  // ── VALIDATE 2FA OTP ─────────────────────────────────────
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

  // ── LOGIN WITH GOOGLE ─────────────────────────────────────
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
      if (loginErr?.status === 404) return this.signupWithGoogle(idToken);
      if (loginErr?.status === 409) {
        return { success: false, message: 'This email is already registered with email/password.' };
      }
      return { success: false, message: loginErr?.error?.message || 'Google Sign-In failed.' };
    }
  }

  async signupWithGoogle(idToken: string): Promise<{ success: boolean; message: string }> {
    try {
      await firstValueFrom(this.http.post(`${BASE}/auth/signupWithGoogle`, { idToken }));
      const loginRes = await firstValueFrom(
        this.http.post<{ message: string; data: { accessToken: string; user: User } }>(
          `${BASE}/auth/loginWithGmail`,
          { idToken },
        ),
      );
      await this.saveSession(loginRes.data.accessToken, loginRes.data.user);
      return { success: true, message: 'Account created!' };
    } catch (err: any) {
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

  // ── REGISTER ─────────────────────────────────────────────
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

  // ── FORGOT PASSWORD ───────────────────────────────────────
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

  async validateForgotPasswordOTP(
    email: string,
    code: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.patch<{ message: string }>(`${BASE}/auth/validate-forget-password`, {
          email, code,
        }),
      );
      return { success: true, message: res.message || 'OTP validated' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || 'Invalid OTP' };
    }
  }

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

  // ── CONFIRM EMAIL ─────────────────────────────────────────
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

  // ── SESSION ───────────────────────────────────────────────
  private async saveSession(token: string, user?: User): Promise<void> {
    // لو الباك مبعتش user كامل، جيبه من /user/profile
    if (!user || !user._id) {
      try {
        const profileRes = await firstValueFrom(
          this.http.get<{ message: string; data: { user: User } }>(`${BASE}/user/profile`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
        user = profileRes.data.user;
      } catch {
        user = { _id: '', username: '', email: '', role: 'Member' };
      }
    }

    user.fullName = user.fullName ?? user.username;

    // ✅ FIX: جيب الـ orgId من /org/me بعد اللوجين
    try {
      const orgRes = await firstValueFrom(
        this.http.get<{ message: string; data: { organizations: any[] } }>(
          `${BASE}/org/me`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
      const firstOrg = orgRes.data?.organizations?.[0];
      if (firstOrg?._id) {
        user.orgId = firstOrg._id;
      }
    } catch {
      // مفيش org بعد → يروح onboarding
    }

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

  updateUser(fields: Partial<User>): void {
    const user = this._currentUser();
    if (!user) return;
    const updated = { ...user, ...fields };
    this._currentUser.set(updated);
    localStorage.setItem('rms_user', JSON.stringify(updated));
  }

  setOrgId(orgId: string): void {
    const user = this._currentUser();
    if (!user) return;
    const updated = { ...user, orgId };
    this._currentUser.set(updated);
    localStorage.setItem('rms_user', JSON.stringify(updated));
  }

  getMyOrgs() {
    return this.http.get(`${BASE}/org/me`);
  }
}