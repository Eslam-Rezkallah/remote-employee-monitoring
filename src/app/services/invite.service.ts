// src/app/services/invite.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { BASE } from './auth.service';

@Injectable({ providedIn: 'root' })
export class InviteService {
  private http = inject(HttpClient);

  async sendInvite(email: string) {
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string }>(`${BASE}/invite/send`, { email }),
      );
      return { success: true, message: res.message || 'Invite sent' };
    } catch (err: any) {
      return {
        success: false,
        message: err?.error?.message || 'Failed to send invite',
      };
    }
  }
}
