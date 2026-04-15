// src/app/inviteUserComponent/invite-user.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InviteService } from '../services/invite.service';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-invite-user',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './invite-user.html',
})
export class InviteUserComponent {
  private inviteService = inject(InviteService);
  private auth = inject(AuthService);

  email = '';
  loading = signal(false);
  message = signal<string | null>(null);

  get isAdmin() {
    return this.auth.currentUser()?.role === 'Admin';
  }

  async sendInvite() {
    if (!this.email) return;

    this.loading.set(true);
    this.message.set(null);

    const res = await this.inviteService.sendInvite(this.email);

    this.message.set(res.message);
    this.loading.set(false);

    if (res.success) this.email = '';
  }
}
