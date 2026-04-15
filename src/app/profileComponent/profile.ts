import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from '../services/auth.service';
import { RoleService } from '../services/role.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './profile.html',
  styleUrls: ['../dark-theme.css', '../../styles.css'],
})
export class ProfileComponent implements OnInit {
  private auth = inject(AuthService);
  private role = inject(RoleService);
  private http = inject(HttpClient);
  private fb   = inject(FormBuilder);

  user = this.auth.currentUser;

  editing    = signal(false);
  saving     = signal(false);
  errorMsg   = signal<string | null>(null);
  successMsg = signal<string | null>(null);

  // Extra profile fields from backend
  phone      = signal('');
  gender     = signal('');
  address    = signal('');

  editForm = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    email:    ['', [Validators.required, Validators.email]],
    phone:    [''],
    gender:   [''],
    address:  [''],
  });

  get userInitial() { return this.user()?.fullName?.charAt(0)?.toUpperCase() ?? '?'; }

  // ── Role label from org membership (not user.role) ────────
  getRoleLabel() {
    const r = this.role.role();
    if (r === 'owner')   return 'Owner';
    if (r === 'admin')   return 'Admin';
    return 'Member';
  }

  ngOnInit() {
    this.loadProfile();
    // Load org role if not already loaded
    this.role.loadMyRole();
  }

  // ══════════════════════════════════════════════════════════
  // LOAD PROFILE
  // Backend: GET /user/profile
  // Returns full user object with teams, projects, tasks
  // ══════════════════════════════════════════════════════════
  private async loadProfile() {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: { user: any } }>(`${BASE}/user/profile`)
      );

      const u = res?.data?.user;
      if (u) {
        // Update local auth state with fresh data
        this.auth.updateUser({
          username: u.username,
          fullName: u.username,
          email:    u.email,
          image:    u.image,
          role:     u.role,
        });

        this.phone.set(u.phone || '');
        this.gender.set(u.gender || '');
        this.address.set(u.address || '');

        // Sync edit form
        this.editForm.patchValue({
          fullName: u.username ?? '',
          email:    u.email ?? '',
          phone:    u.phone ?? '',
          gender:   u.gender ?? '',
          address:  u.address ?? '',
        });
      }
    } catch (err) {
      console.error('[Profile] loadProfile failed:', err);
    }
  }

  // ══════════════════════════════════════════════════════════
  // SAVE EDIT
  // Backend: PATCH /user/profile
  // Body: { username, phone, gender, address }
  // NOTE: email change is handled separately via security flow
  // ══════════════════════════════════════════════════════════
  async saveEdit() {
    if (this.editForm.invalid) { this.editForm.markAllAsTouched(); return; }

    this.saving.set(true);
    this.errorMsg.set(null);

    const { fullName, phone, gender, address } = this.editForm.value;

    try {
      await firstValueFrom(
        this.http.patch(`${BASE}/user/profile`, {
          username: fullName,
          phone:    phone || undefined,
          gender:   gender || undefined,
          address:  address || undefined,
        })
      );

      // Update local user signal
      this.auth.updateUser({
        fullName: fullName!,
        username: fullName!,
      });

      this.phone.set(phone || '');
      this.gender.set(gender || '');
      this.address.set(address || '');

      this.successMsg.set('Profile updated successfully.');
      this.editing.set(false);
      setTimeout(() => this.successMsg.set(null), 3000);
    } catch (err: any) {
      this.errorMsg.set(err?.error?.message || 'Failed to update profile.');
    } finally {
      this.saving.set(false);
    }
  }
}