import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SpaceService, Space } from '../services/space.service';
import { CreateSpaceComponent } from '../createSpaceComponent/create-space.component';

type FilterType = 'all' | 'engineering' | 'design' | 'marketing' | 'management' | 'other';

@Component({
  selector: 'app-spaces-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, CreateSpaceComponent],
  templateUrl: './spaces-list.html',
  styleUrls: ['../dark-theme.css', '../../styles.css'],
})
export class SpacesListComponent implements OnInit {
  private spaceService = inject(SpaceService);

  spaces       = this.spaceService.spaces;
  loading      = this.spaceService.loading;
  searchQuery  = signal('');
  activeFilter = signal<FilterType>('all');
  createOpen   = signal(false);

  filters: { label: string; value: FilterType }[] = [
    { label: 'All',         value: 'all' },
    { label: 'Engineering', value: 'engineering' },
    { label: 'Design',      value: 'design' },
    { label: 'Marketing',   value: 'marketing' },
    { label: 'Management',  value: 'management' },
    { label: 'Other',       value: 'other' },
  ];

  filtered = computed(() => {
    let list = this.spaces();
    const q = this.searchQuery().toLowerCase();
    const f = this.activeFilter();

    if (q) list = list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.key.toLowerCase().includes(q) ||
      s.lead.toLowerCase().includes(q)
    );
    if (f !== 'all') list = list.filter(s => s.type === f);

    return list;
  });

  // FIX: Load spaces from backend on init
  ngOnInit() {
    this.spaceService.loadSpaces();
  }

  toggleStar(id: string) { this.spaceService.toggleStar(id); }
  deleteSpace(id: string) { this.spaceService.deleteSpace(id); }

  getTypeColor(type: string): string {
    const map: Record<string, string> = {
      engineering: '#6366f1', design: '#8b5cf6',
      marketing: '#10b981', management: '#f59e0b', other: '#6b7280',
    };
    return map[type] ?? '#6b7280';
  }
}