import { Component, inject, signal, HostListener } from '@angular/core';
import { CommonModule }  from '@angular/common';
import { RouterModule }  from '@angular/router';
import { Router }        from '@angular/router';
import { AuthService }   from '../services/auth.service';
import { RoleService }   from '../services/role.service';
import { ThemeService }  from '../services/theme.service';
import { WorkSessionWidgetComponent } from '../workSessionWidgetComponent/work-session-widget';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule, WorkSessionWidgetComponent],
  templateUrl: './navbar.html',
  styleUrls: ['./navbar.css', '../../styles.css'],
})
export class NavbarComponent {
  private authService = inject(AuthService);
  private roleService = inject(RoleService);
  private router      = inject(Router);
  themeService        = inject(ThemeService);

  user     = this.authService.currentUser;
  menuOpen = signal(false);

  get userInitial(): string {
    return this.user()?.fullName?.charAt(0)?.toUpperCase() ?? '?';
  }

  roleName(): string {
    const r = this.roleService.role();
    return r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : 'Member';
  }

  isAdmin(): boolean { return this.roleService.isAdmin(); }

  toggleMenu(): void { this.menuOpen.set(!this.menuOpen()); }

  logout(): void {
    this.menuOpen.set(false);
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('app-navbar')) this.menuOpen.set(false);
  }
}