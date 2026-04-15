import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from './auth.service';

export interface Space {
  id: string;
  _id?: string;
  name: string;
  key: string;
  icon: string;
  color: string;
  type: 'engineering' | 'design' | 'marketing' | 'management' | 'other';
  lead: string;
  members: number;
  isStarred: boolean;
  createdAt: string;
  visitedAt?: number;
}

// Backend space types → frontend display types
function mapType(t: string): Space['type'] {
  const map: Record<string, Space['type']> = {
    Project: 'engineering',
    Team: 'management',
    Personal: 'other',
    engineering: 'engineering',
    design: 'design',
    marketing: 'marketing',
    management: 'management',
    other: 'other',
  };
  return map[t] ?? 'other';
}

function toBackendType(t: string): string {
  const map: Record<string, string> = {
    engineering: 'Project',
    design: 'Project',
    marketing: 'Project',
    management: 'Team',
    other: 'Personal',
  };
  return map[t] ?? 'Project';
}

function getSpaceItems(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.spaces)) return data.spaces;
  return [];
}

function getSpacePayload(data: any): any {
  return data?.space ?? data;
}

function mapSpace(s: any): Space {
  const createdBy = s.createdBy ?? s.ownerId;
  const members = Array.isArray(s.members) ? s.members.length : (s.memberCount ?? 1);
  return {
    id: s._id ?? s.id,
    _id: s._id ?? s.id,
    name: s.name ?? 'Untitled space',
    key: s.key ?? s.name?.substring(0, 4).toUpperCase() ?? 'SPC',
    icon: s.icon || '⚙️',
    color: '#6366f1',
    type: mapType(s.type),
    lead: createdBy?.username ?? createdBy?.fullName ?? 'Unknown',
    members,
    isStarred: false,
    createdAt: s.createdAt
      ? new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : '',
    visitedAt: undefined,
  };
}

@Injectable({ providedIn: 'root' })
export class SpaceService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  private _spaces = signal<Space[]>([]);
  private _loading = signal(false);
  private _loaded = signal(false);
  private _recent = signal<string[]>([]);

  readonly spaces = this._spaces.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly starred = computed(() => this._spaces().filter((s) => s.isStarred));
  readonly recent = computed(
    () =>
      this._recent()
        .map((id) => this._spaces().find((s) => s.id === id))
        .filter(Boolean) as Space[],
  );
  readonly recentAll = computed(() =>
    this._spaces()
      .filter((s) => s.visitedAt)
      .sort((a, b) => (b.visitedAt ?? 0) - (a.visitedAt ?? 0)),
  );

  // ══════════════════════════════════════════════════════════
  // LOAD SPACES
  // Backend: GET /org/:orgId/spaces?limit=100
  // Response: { data: { items: [...], total } }
  // ══════════════════════════════════════════════════════════
  async loadSpaces(): Promise<void> {
    if (!this.orgId) return;
    if (this._loaded()) return; // avoid duplicate loads
    this._loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<{ message: string; data: any }>(`${BASE}/org/${this.orgId}/spaces?limit=100`),
      );
      const mapped = getSpaceItems(res?.data).map(mapSpace);
      this._spaces.set(mapped);
      this._loaded.set(true);
    } catch (err) {
      console.error('[SpaceService] loadSpaces error:', err);
    } finally {
      this._loading.set(false);
    }
  }

  // Force reload (e.g. after creating a space)
  async reloadSpaces(): Promise<void> {
    this._loaded.set(false);
    await this.loadSpaces();
  }

  // ══════════════════════════════════════════════════════════
  // CREATE SPACE
  // Backend: POST /org/:orgId/spaces
  // Body: { name, icon?, type? }
  // Response: { data: { _id, name, ... } }
  // ══════════════════════════════════════════════════════════
  async addSpaceRemote(data: {
    name: string;
    key: string;
    icon: string;
    color: string;
    type: string;
    lead: string;
  }): Promise<Space | null> {
    if (!this.orgId) return null;
    try {
      const res = await firstValueFrom(
        this.http.post<{ message: string; data: any }>(`${BASE}/org/${this.orgId}/spaces`, {
          name: data.name,
          icon: data.icon,
          type: toBackendType(data.type),
        }),
      );
      const newSpace = mapSpace(getSpacePayload(res.data));
      newSpace.key = data.key;
      newSpace.color = data.color;
      newSpace.type = data.type as Space['type'];
      newSpace.lead = data.lead;
      this._spaces.update((s) => [...s, newSpace]);
      return newSpace;
    } catch (err: any) {
      console.error('[SpaceService] addSpace error:', err?.error ?? err);
      return null;
    }
  }

  // Sync fallback (creates temp + fires remote)
  addSpace(space: Omit<Space, 'id' | 'createdAt' | 'members' | 'isStarred' | 'visitedAt'>): Space {
    const tempSpace: Space = {
      ...space,
      id: 'temp_' + Date.now(),
      members: 1,
      isStarred: false,
      createdAt: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    };
    this._spaces.update((s) => [...s, tempSpace]);
    this.addSpaceRemote({ ...space, lead: space.lead }).then((real) => {
      if (real) {
        this._spaces.update((s) => s.map((x) => (x.id === tempSpace.id ? real : x)));
      }
    });
    return tempSpace;
  }

  toggleStar(id: string) {
    this._spaces.update((s) => s.map((x) => (x.id === id ? { ...x, isStarred: !x.isStarred } : x)));
    // TODO: Call POST /stars when integrating Phase 4
  }

  deleteSpace(id: string) {
    this._spaces.update((s) => s.filter((x) => x.id !== id));
  }

  getById(id: string): Space | undefined {
    return this._spaces().find((s) => s.id === id);
  }

  visitSpace(id: string) {
    this._recent.update((r) => [id, ...r.filter((x) => x !== id)].slice(0, 3));
    this._spaces.update((s) => s.map((x) => (x.id === id ? { ...x, visitedAt: Date.now() } : x)));
  }
}
