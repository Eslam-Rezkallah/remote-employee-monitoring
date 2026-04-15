import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from '../services/auth.service';

export interface Employee {
  _id: string;
  username: string;
  email: string;
  role: string;
  image?: { secure_url?: string };
  isActive: boolean;
  createdAt?: string;
}

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './employee-list.html',
  styleUrls: ['../dark-theme.css', '../../styles.css'],
})
export class EmployeeListComponent implements OnInit {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  employees = signal<Employee[]>([]);
  loading = signal(true);
  searchQuery = signal('');

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase();
    return !q
      ? this.employees()
      : this.employees().filter(
          (e) =>
            e.username.toLowerCase().includes(q) ||
            e.email.toLowerCase().includes(q) ||
            e.role.toLowerCase().includes(q),
        );
  });

  ngOnInit() {
    this.load();
  }

  async load() {
    const orgId = this.auth.currentUser()?.orgId;
    if (!orgId) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: { members: any[] } }>(
          `${BASE}/org/${orgId}/members?page=1&limit=100`,
        ),
      );
      const members = (res?.data?.members ?? [])
        .map((m: any) => {
          const user = m.userId ?? m.user ?? m;
          return {
            _id: user._id ?? m.userId,
            username: user.fullName ?? user.username ?? user.email?.split('@')[0] ?? 'Unknown',
            email: user.email ?? '',
            role: m.role ?? user.role ?? 'member',
            image: user.image,
            isActive: m.isActive ?? user.isActive ?? true,
            createdAt: m.joinedAt ?? user.createdAt,
          } as Employee;
        })
        .filter((e: Employee) => e._id);
      this.employees.set(members);
    } catch (err) {
      console.error('[EmployeeList] load error:', err);
    } finally {
      this.loading.set(false);
    }
  }

  getInitial(name: string): string {
    return name?.charAt(0)?.toUpperCase() ?? '?';
  }

  getRoleBadge(role: string): string {
    const r = role?.toLowerCase();
    if (r === 'admin') return 'role-admin';
    if (r === 'manager') return 'role-manager';
    return 'role-member';
  }
}
