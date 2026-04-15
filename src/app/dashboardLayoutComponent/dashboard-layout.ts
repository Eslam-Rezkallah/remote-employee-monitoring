import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SidebarComponent } from '../sidebarComponent/sidebar';
import { NavbarComponent }  from '../navbarComponent/navbar';
import { ThemeService }     from '../services/theme.service';
import { ToastComponent }   from '../toastComponent/toast';
import { SpaceService }     from '../services/space.service';

@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, NavbarComponent, ToastComponent],
  templateUrl: './dashboard-layout.html',
  styleUrls: ['./dashboard-layout.css'],
})
export class DashboardLayoutComponent implements OnInit {
  themeService = inject(ThemeService);
  private spaceService = inject(SpaceService);

  ngOnInit() {
    // Load spaces once when dashboard loads
    this.spaceService.loadSpaces();
  }
}