import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from './auth.service';

export interface Screenshot {
  _id: string;
  userId: string | { _id: string; username: string };
  organizationId: string;
  imageUrl: string;
  capturedAt: string;
  createdAt: string;
}

/**
 * Screenshot service — captures and manages employee screenshots.
 *
 * Backend endpoints:
 *   POST   /org/:orgId/screenshots                              → upload screenshot
 *   GET    /org/:orgId/screenshots                               → list all
 *   GET    /org/:orgId/screenshots?from=…&to=…&page=1&limit=10  → filtered list
 *   GET    /org/:orgId/screenshots/:id                           → single screenshot
 *   DELETE /org/:orgId/screenshots/:id                           → delete screenshot
 */
@Injectable({ providedIn: 'root' })
export class ScreenshotService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  // ── List screenshots ────────────────────────────────────
  async list(options?: {
    from?: string; // ISO date string (YYYY-MM-DD)
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<Screenshot[]> {
    if (!this.orgId) return [];

    try {
      const params: Record<string, string> = {};
      if (options?.from) params['from'] = options.from;
      if (options?.to) params['to'] = options.to;
      if (options?.page) params['page'] = String(options.page);
      if (options?.limit) params['limit'] = String(options.limit);

      const res = await firstValueFrom(
        this.http.get<{ data: any }>(`${BASE}/org/${this.orgId}/screenshots`, { params }),
      );

      return res?.data?.screenshots ?? res?.data ?? [];
    } catch (err) {
      console.error('[ScreenshotService] list:', err);
      return [];
    }
  }

  // ── Get single screenshot ───────────────────────────────
  async get(screenshotId: string): Promise<Screenshot | null> {
    if (!this.orgId) return null;
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: any }>(`${BASE}/org/${this.orgId}/screenshots/${screenshotId}`),
      );
      return res?.data?.screenshot ?? res?.data ?? null;
    } catch {
      return null;
    }
  }

  // ── Upload screenshot ───────────────────────────────────
  // Backend expects: { base64Image, capturedAt }
  async upload(base64Image: string, capturedAt?: string): Promise<Screenshot | null> {
    if (!this.orgId) return null;
    try {
      const res = await firstValueFrom(
        this.http.post<{ data: any }>(`${BASE}/org/${this.orgId}/screenshots`, {
          base64Image,
          capturedAt: capturedAt ?? new Date().toISOString(),
        }),
      );
      return res?.data?.screenshot ?? res?.data ?? null;
    } catch (err: any) {
      console.error('[ScreenshotService] upload:', err?.error?.message);
      return null;
    }
  }

  // ── Delete screenshot ───────────────────────────────────
  async delete(screenshotId: string): Promise<boolean> {
    if (!this.orgId) return false;
    try {
      await firstValueFrom(
        this.http.delete(`${BASE}/org/${this.orgId}/screenshots/${screenshotId}`),
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Capture browser screenshot (canvas-based) ───────────
  // This captures a screenshot of the current viewport
  // Uses html2canvas if available, otherwise returns null
  async captureAndUpload(): Promise<Screenshot | null> {
    try {
      // Dynamic import without TS type-checking — html2canvas is optional
      const mod = await (Function('return import("html2canvas")')() as Promise<any>);
      const html2canvas = mod.default ?? mod;
      const canvas = await html2canvas(document.body, {
        scale: 0.5,
        logging: false,
        useCORS: true,
      });
      const base64 = canvas.toDataURL('image/png').split(',')[1];
      return this.upload(base64);
    } catch {
      console.warn(
        '[ScreenshotService] html2canvas not available — install with: npm i html2canvas',
      );
      return null;
    }
  }
}
