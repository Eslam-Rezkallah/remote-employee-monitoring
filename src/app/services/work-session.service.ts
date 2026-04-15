import { Injectable, signal, computed, inject, OnDestroy, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from './auth.service';

export type SessionStatus = 'idle' | 'active' | 'paused' | 'stopped';

export interface WorkSession {
  _id: string;
  userId: string;
  organizationId: string;
  taskId?: string;
  status: SessionStatus;
  startTime: string;
  endTime: string | null;
  activeSeconds: number;
  idleSeconds: number;
  pausedSeconds: number;
  totalSeconds: number;
  lastActivityAt: string;
  isIdle: boolean;
  pauseSegments: { pausedAt: string; resumedAt: string | null }[];
  note?: string;
  liveSeconds?: number;
}

const BASE_URL = `${BASE}/work-session`;

@Injectable({ providedIn: 'root' })
export class WorkSessionService implements OnDestroy {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private zone = inject(NgZone);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  // ── State ─────────────────────────────────────────────────────
  session = signal<WorkSession | null>(null);
  status = computed<SessionStatus>(() => this.session()?.status ?? 'idle');
  isActive = computed(() => this.status() === 'active');
  isPaused = computed(() => this.status() === 'paused');
  isIdle = computed(() => this.session()?.isIdle ?? false);
  elapsedSeconds = signal(0);

  formattedTime = computed(() => {
    const s = this.elapsedSeconds();
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  });

  private timerInterval: any = null;
  private activityInterval: any = null;
  private activityListeners: (() => void)[] = [];
  private lastActivitySent = 0;

  constructor() {
    // ── Restore active session on app load ──
    this.fetchActiveSession();
  }

  // ── Fetch active session (on load) ───────────────────────────
  async fetchActiveSession(): Promise<void> {
    if (!this.orgId) return;
    try {
      const res = await firstValueFrom(
        this.http.get<{ message: string; data: { items: WorkSession[] } }>(
          `${BASE_URL}/me?orgId=${this.orgId}&status=active&limit=1`,
        ),
      );

      const active = res?.data?.items?.find((s) => s.status === 'active' || s.status === 'paused');
      if (active) {
        this.session.set(active);
        // Sync elapsed time from liveSeconds
        this.elapsedSeconds.set(active.liveSeconds ?? active.activeSeconds ?? 0);
        if (active.status === 'active') {
          this.startTimer();
          this.startActivityPing();
          this.listenToUserActivity();
        }
      }
    } catch {
      /* no active session — stay idle */
    }
  }

  // ── Start ─────────────────────────────────────────────────────
  async start(taskId?: string, note?: string): Promise<void> {
    if (!this.orgId) {
      console.warn('No orgId');
      return;
    }
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: WorkSession }>(`${BASE_URL}/start`, {
          orgId: this.orgId,
          taskId,
          note,
        }),
      );
      if (res?.data) {
        this.session.set(res.data);
        this.elapsedSeconds.set(0);
        this.startTimer();
        this.startActivityPing();
        this.listenToUserActivity();
      }
    } catch (e: any) {
      console.error('Start failed:', e?.error?.message ?? e);
    }
  }

  // ── Pause ─────────────────────────────────────────────────────
  async pause(note?: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: WorkSession }>(`${BASE_URL}/pause`, {
          orgId: this.orgId,
          note,
        }),
      );
      if (res?.data) {
        this.session.set(res.data);
        this.stopTimer();
        this.stopActivityPing();
        this.removeActivityListeners();
      }
    } catch (e: any) {
      console.error('Pause failed:', e?.error?.message ?? e);
    }
  }

  // ── Resume ────────────────────────────────────────────────────
  async resume(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: WorkSession }>(`${BASE_URL}/resume`, {
          orgId: this.orgId,
        }),
      );
      if (res?.data) {
        this.session.set(res.data);
        this.startTimer();
        this.startActivityPing();
        this.listenToUserActivity();
      }
    } catch (e: any) {
      console.error('Resume failed:', e?.error?.message ?? e);
    }
  }

  // ── Stop ──────────────────────────────────────────────────────
  async stop(note?: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: WorkSession }>(`${BASE_URL}/stop`, {
          orgId: this.orgId,
          note,
        }),
      );
      if (res?.data) {
        this.session.set(res.data);
        this.stopTimer();
        this.stopActivityPing();
        this.removeActivityListeners();
        setTimeout(() => {
          this.session.set(null);
          this.elapsedSeconds.set(0);
        }, 1500);
      }
    } catch (e: any) {
      console.error('Stop failed:', e?.error?.message ?? e);
    }
  }

  // ── Activity ping to backend ──────────────────────────────────
  async sendActivity(type: 'keyboard' | 'mouse' = 'keyboard'): Promise<void> {
    if (!this.isActive()) return;

    const user = this.auth.currentUser();
    const currentSession = this.session();

    const payload = {
      orgId: user?.orgId,
      userId: user?._id,
      sessionId: currentSession?._id, // 🔥 ده المفتاح
      type,
      timestamp: new Date().toISOString(),
    };

    console.log('📦 ACTIVITY PAYLOAD:', payload);

    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: { isIdle: boolean; lastActivityAt: string } }>(
          `${BASE_URL}/activity`,
          payload,
        ),
      );

      if (res?.data && this.session()) {
        this.session.update((s) =>
          s ? { ...s, isIdle: res.data.isIdle, lastActivityAt: res.data.lastActivityAt } : s,
        );
      }
    } catch (err: any) {
      console.log('❌ ACTIVITY ERROR:', err?.error);
      console.log('❌ DETAILS:', err?.error?.details);
    }
  }

  // ── Listen to real user activity (mouse/keyboard) ────────────
  private listenToUserActivity(): void {
    this.removeActivityListeners();

    const handler = (type: 'keyboard' | 'mouse') => {
      const now = Date.now();
      // Send immediately if was idle, otherwise debounce to 15s
      const minInterval = this.isIdle() ? 0 : 15000;
      if (now - this.lastActivitySent >= minInterval) {
        this.lastActivitySent = now;
        this.zone.run(() => this.sendActivity(type));
      }
    };

    const mouseHandler = () => handler('mouse');
    const keyHandler = () => handler('keyboard');

    this.zone.runOutsideAngular(() => {
      document.addEventListener('mousemove', mouseHandler, { passive: true });
      document.addEventListener('mousedown', mouseHandler, { passive: true });
      document.addEventListener('keydown', keyHandler, { passive: true });
      document.addEventListener('touchstart', mouseHandler, { passive: true });
    });

    this.activityListeners = [
      () => document.removeEventListener('mousemove', mouseHandler),
      () => document.removeEventListener('mousedown', mouseHandler),
      () => document.removeEventListener('keydown', keyHandler),
      () => document.removeEventListener('touchstart', mouseHandler),
    ];
  }

  private removeActivityListeners(): void {
    this.activityListeners.forEach((fn) => fn());
    this.activityListeners = [];
  }

  // ── Timer ─────────────────────────────────────────────────────
  private startTimer(): void {
    this.stopTimer();
    this.zone.runOutsideAngular(() => {
      this.timerInterval = setInterval(() => {
        if (this.isActive()) {
          this.zone.run(() => this.elapsedSeconds.update((s) => s + 1));
        }
      }, 1000);
    });
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // ── Periodic ping every 20s ───────────────────────────────────
  private startActivityPing(): void {
    this.stopActivityPing();
    this.zone.runOutsideAngular(() => {
      this.activityInterval = setInterval(() => {
        this.zone.run(() => this.sendActivity('keyboard'));
      }, 20000);
    });
  }

  private stopActivityPing(): void {
    if (this.activityInterval) {
      clearInterval(this.activityInterval);
      this.activityInterval = null;
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.stopActivityPing();
    this.removeActivityListeners();
  }
}
