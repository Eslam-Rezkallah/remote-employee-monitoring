import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from '../services/auth.service';
import { RoleService, Role, OrgMember } from '../services/role.service';

type Tab = 'general' | 'members' | 'invitations' | 'danger';

@Component({
  selector: 'app-org-settings',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, TitleCasePipe],
  templateUrl: './org-settings.html',
  styleUrls: ['../dark-theme.css', '../../styles.css', './org-settings.css'],
})
export class OrgSettingsComponent implements OnInit {
  private auth        = inject(AuthService);
  private roleService = inject(RoleService);
  private http        = inject(HttpClient);
  private fb          = inject(FormBuilder);
  private router      = inject(Router);

  activeTab      = signal<Tab>('general');
  savedGeneral   = signal(false);
  showDeleteOrg  = signal(false);
  deleteOrgInput = signal('');
  inviteSuccess  = signal('');
  inviteError    = signal('');
  joinCodeCopied = signal(false);

  members        = this.roleService.members;
  loadingMembers = this.roleService.loading;

  orgName  = signal('');
  joinCode = signal('');

  private get orgId(): string { return this.auth.currentUser()?.orgId ?? ''; }

  get isAdmin(): boolean { return this.roleService.isAdmin(); }
  get isOwner(): boolean { return this.roleService.isOwner(); }

  generalForm = this.fb.group({
    orgName: ['', [Validators.required, Validators.minLength(2)]],
    slug:    ['', [Validators.required]],
  });

  inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    role:  ['member' as Role, Validators.required],
  });

  ngOnInit() {
    this.loadOrgDetails();
    this.loadMembers();
  }

  // ── Load Org Details ────────────────────────────────────
private async loadOrgDetails() {
  const orgId = this.auth.currentUser()?.orgId;

  if (!orgId) {
    console.error('❌ No orgId found');
    return;
  }

  try {
    const res = await firstValueFrom(
      this.http.get<{ data: any }>(`${BASE}/org/${orgId}`)
    );

    const org = res?.data;

    console.log('🏢 ORG DATA:', org);

    if (org) {
      this.orgName.set(org.name || '');
      this.joinCode.set(org.joinCode || '');

      this.generalForm.patchValue({
        orgName: org.name ?? '',
        slug: org.slug ?? '',
      });
    }

  } catch (err: any) {
    console.error('[OrgSettings] loadOrgDetails:', err?.error?.message);
  }
}

  // ── Load Members ────────────────────────────────────────
  private async loadMembers() {
    if (!this.orgId) return;
    await this.roleService.loadMembers();
  }

  // ── Save General ────────────────────────────────────────
  async saveGeneral() {
    if (this.generalForm.invalid || !this.orgId) {
      this.generalForm.markAllAsTouched();
      return;
    }
    try {
      await firstValueFrom(
        this.http.patch(`${BASE}/org/${this.orgId}`, {
          name: this.generalForm.value.orgName,
          slug: this.generalForm.value.slug,
        })
      );
      this.orgName.set(this.generalForm.value.orgName!);
      this.savedGeneral.set(true);
      setTimeout(() => this.savedGeneral.set(false), 2500);
    } catch (err: any) {
      console.error('[OrgSettings] saveGeneral:', err?.error?.message);
    }
  }

  // ── Copy Join Code ──────────────────────────────────────
  copyJoinCode() {
    navigator.clipboard.writeText(this.joinCode()).then(() => {
      this.joinCodeCopied.set(true);
      setTimeout(() => this.joinCodeCopied.set(false), 2000);
    });
  }

  // ── Send Invite ─────────────────────────────────────────
  async sendInvite() {
    if (this.inviteForm.invalid || !this.orgId) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    const { email, role } = this.inviteForm.value;
    const result = await this.roleService.inviteMember(email!, role as Role, this.orgId);

    if (result.success) {
      this.inviteSuccess.set(result.message);
      this.inviteError.set('');
      this.inviteForm.reset({ role: 'member' });
      setTimeout(() => this.inviteSuccess.set(''), 3000);
    } else {
      this.inviteError.set(result.message);
      this.inviteSuccess.set('');
    }
  }

  // ── Remove Member ───────────────────────────────────────
  async removeMember(memberUserId: string) {
    if (!confirm('Remove this member from the organization?')) return;
    const result = await this.roleService.removeMember(memberUserId, this.orgId);
    if (!result.success) {
      console.error('[OrgSettings] removeMember:', result.message);
    }
  }

  // ── Update Role ─────────────────────────────────────────
  async updateRole(memberUserId: string, e: Event) {
    const role = (e.target as HTMLSelectElement).value as Role;
    const result = await this.roleService.updateMemberRole(memberUserId, role, this.orgId);
    if (!result.success) {
      console.error('[OrgSettings] updateRole:', result.message);
    }
  }

  // ── Delete Org ──────────────────────────────────────────
  get canDeleteOrg(): boolean { return this.deleteOrgInput() === 'DELETE'; }

  async deleteOrg() {
    if (!this.canDeleteOrg || !this.orgId) return;
    try {
      await firstValueFrom(
        this.http.delete(`${BASE}/org/${this.orgId}`)
      );
      this.auth.logout();
      this.router.navigate(['/login']);
    } catch (err: any) {
      console.error('[OrgSettings] deleteOrg:', err?.error?.message);
    }
  }
}