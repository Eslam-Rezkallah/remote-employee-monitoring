import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from '../services/auth.service';

interface WorkSession {
  _id: string;
  status: string;
  startTime: string;
  endTime: string | null;
  activeSeconds: number;
  idleSeconds: number;
  pausedSeconds: number;
  totalSeconds: number;
  taskId?: { title: string; status: string } | null;
  note?: string;
}

interface Screenshot {
  _id: string;
  imageUrl: string;
  capturedAt: string;
  userId?: string;
}

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './employee-detail.html',
  styleUrls: ['../dark-theme.css', '../../styles.css'],
})
export class EmployeeDetailComponent implements OnInit {
  private route  = inject(ActivatedRoute);
  private router = inject(Router);
  private http   = inject(HttpClient);
  private auth   = inject(AuthService);

  employee   = signal<any>(null);
  sessions   = signal<WorkSession[]>([]);
  screenshots = signal<Screenshot[]>([]);
  loading    = signal(true);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/dashboard/employees']);
      return;
    }
    this.loadEmployee(id);
  }

  /**
   * Load employee data.
   *
   * The backend does NOT have GET /user/profile/:userId for viewing
   * other users. Instead we:
   *  1. Load org members (GET /org/:orgId/members) and find the one matching userId
   *  2. Load work sessions (GET /work-session/me is only for current user,
   *     so for now we show sessions only if viewing yourself)
   *  3. Load screenshots (GET /org/:orgId/screenshots) filtered client-side
   */
  private async loadEmployee(userId: string) {
    this.loading.set(true);

    try {
      // ── 1. Get employee from org members ────────────────────
      if (this.orgId) {
        const membersRes = await firstValueFrom(
          this.http.get<{ data: { members: any[] } }>(
            `${BASE}/org/${this.orgId}/members?page=1&limit=100`
          )
        );

        const members = membersRes?.data?.members ?? [];
        const match = members.find((m: any) => {
          const uid = m.userId?._id ?? m.userId;
          return uid === userId;
        });

        if (match) {
          const user = match.userId ?? {};
          this.employee.set({
            _id:      user._id ?? userId,
            username: user.username ?? user.email?.split('@')[0] ?? 'Unknown',
            email:    user.email ?? '',
            role:     match.role ?? 'member',
            image:    user.image ?? null,
            phone:    user.phone ?? '',
            address:  user.address ?? '',
            isActive: match.isActive ?? true,
            joinedAt: match.joinedAt,
          });
        }
      }

      // Fallback: try GET /user/profile if viewing own profile
      if (!this.employee() && userId === this.auth.currentUser()?._id) {
        try {
          const profileRes = await firstValueFrom(
            this.http.get<{ data: { user: any } }>(`${BASE}/user/profile`)
          );
          const u = profileRes?.data?.user;
          if (u) {
            this.employee.set({
              _id:      u._id,
              username: u.username ?? u.email?.split('@')[0],
              email:    u.email ?? '',
              role:     u.role ?? 'Member',
              image:    u.image,
              phone:    u.phone ?? '',
              address:  u.address ?? '',
              isActive: true,
            });
          }
        } catch { /* ignore */ }
      }

      // ── 2. Load work sessions ───────────────────────────────
      // GET /work-session/me only returns current user's sessions.
      // For other users, we'd need a backend endpoint like
      // GET /work-session/user/:userId — which doesn't exist yet.
      // So we load sessions only if this is the current user.
      if (this.orgId && userId === this.auth.currentUser()?._id) {
        try {
          const sessRes = await firstValueFrom(
            this.http.get<{ data: { items: WorkSession[] } }>(
              `${BASE}/work-session/me?orgId=${this.orgId}&limit=10`
            )
          );
          this.sessions.set(sessRes?.data?.items ?? []);
        } catch { /* sessions optional */ }
      }

      // ── 3. Load screenshots ─────────────────────────────────
      if (this.orgId) {
        try {
          const today = new Date();
          const from = new Date(today.getFullYear(), today.getMonth(), today.getDate())
            .toISOString().split('T')[0];
          const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
            .toISOString().split('T')[0];

          const ssRes = await firstValueFrom(
            this.http.get<{ data: any }>(
              `${BASE}/org/${this.orgId}/screenshots?from=${from}&to=${to}&page=1&limit=20`
            )
          );
          const allScreenshots = ssRes?.data?.screenshots ?? ssRes?.data ?? [];
          // Filter for this user
          const userScreenshots = allScreenshots.filter(
            (s: any) => (s.userId?._id ?? s.userId) === userId
          );
          this.screenshots.set(userScreenshots);
        } catch { /* screenshots optional */ }
      }

    } catch (err) {
      console.error('[EmployeeDetail] load error:', err);
    } finally {
      this.loading.set(false);
    }
  }

  getInitial(name: string): string {
    return name?.charAt(0)?.toUpperCase() ?? '?';
  }

  formatDuration(seconds: number): string {
    if (!seconds || seconds < 0) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  get totalActiveToday(): string {
    const now = new Date();
    const todaySessions = this.sessions().filter(s => {
      const d = new Date(s.startTime);
      return d.getDate() === now.getDate()
          && d.getMonth() === now.getMonth()
          && d.getFullYear() === now.getFullYear();
    });
    return this.formatDuration(todaySessions.reduce((sum, s) => sum + (s.activeSeconds ?? 0), 0));
  }

  get totalIdleToday(): string {
    const now = new Date();
    const todaySessions = this.sessions().filter(s => {
      const d = new Date(s.startTime);
      return d.getDate() === now.getDate();
    });
    return this.formatDuration(todaySessions.reduce((sum, s) => sum + (s.idleSeconds ?? 0), 0));
  }
}