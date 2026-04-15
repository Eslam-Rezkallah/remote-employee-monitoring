import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, BASE } from '../services/auth.service';
import { SpaceService } from '../services/space.service';
import { ReportsService } from '../services/reports.service';

type ReportTab = 'overview' | 'sprint' | 'velocity' | 'flow' | 'epic' | 'cycle' | 'devops';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './reports.html',
  styleUrls: ['../dark-theme.css', '../../styles.css', './reports.css'],
})
export class ReportsComponent implements OnInit {
  private reportsService = inject(ReportsService);
  private auth = inject(AuthService);
  private spaceService = inject(SpaceService);

  activeTab = signal<ReportTab>('overview');

  tabs: { id: ReportTab; label: string; icon: string }[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
    },
    {
      id: 'sprint',
      label: 'Sprint Report',
      icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
    },
    {
      id: 'velocity',
      label: 'Velocity',
      icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
    },
    {
      id: 'flow',
      label: 'Cumulative Flow',
      icon: 'M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z',
    },
    { id: 'epic', label: 'Epic Report', icon: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12' },
    { id: 'cycle', label: 'Cycle Time', icon: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z' },
    {
      id: 'devops',
      label: 'DevOps',
      icon: 'M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 6 0m-6 0H3m16.5 0a3 3 0 0 0 3-3m-3 3a3 3 0 1 1-6 0m6 0h1.5m-7.5 0V5.25A2.25 2.25 0 0 1 12 3h0a2.25 2.25 0 0 1 2.25 2.25V14.25',
    },
  ];

  spaces = this.spaceService.spaces;
  selectedSpaceId = signal('');
  sprints = signal<any[]>([]);
  selectedSprintId = signal('');
  loadingSprints = signal(false);
  loadingReport = signal(false);

  sprintReport = signal<any>(null);
  burndownData = signal<any[]>([]);
  burnupData = signal<any[]>([]);
  velocityData = signal<any[]>([]);
  flowData = signal<any[]>([]);
  devopsSummary = signal<any>(null);

  private get orgId(): string {
    return this.auth.currentUser()?.orgId ?? '';
  }

  ngOnInit() {
    const check = setInterval(() => {
      const s = this.spaces();
      if (s.length > 0) {
        clearInterval(check);
        this.selectedSpaceId.set(s[0].id);
        this.loadSprints(s[0].id);
      }
    }, 300);
    setTimeout(() => clearInterval(check), 5000);
  }

  async onSpaceChange(spaceId: string) {
    this.selectedSpaceId.set(spaceId);
    this.sprints.set([]);
    this.selectedSprintId.set('');
    this.clearData();
    if (spaceId) await this.loadSprints(spaceId);
  }

  async loadSprints(spaceId: string) {
    if (!this.orgId || !spaceId) return;

    this.loadingSprints.set(true);

    try {
      const res = await this.reportsService.getVelocity(this.orgId, spaceId, 10);

      const list = (res?.data?.velocity ?? []).map((v: any) => ({
        _id: v.sprintId,
        name: v.sprint,
        status: v.status,
      }));

      this.sprints.set(list);

      if (list.length > 0) {
        this.selectedSprintId.set(list[list.length - 1]._id);
        await this.loadReportData();
      }
    } catch (err) {
      console.error('[Reports] loadSprints:', err);
    } finally {
      this.loadingSprints.set(false);
    }
  }

  async onSprintChange(sprintId: string) {
    this.selectedSprintId.set(sprintId);
    await this.loadReportData();
  }

  async loadReportData() {
    const sid = this.selectedSpaceId();
    const spId = this.selectedSprintId();

    if (!this.orgId || !sid || !spId) return;

    this.loadingReport.set(true);
    this.clearData();

    try {
      const [r, bd, bu, cf, vel, dev] = await Promise.allSettled([
        this.reportsService.getSprintReport(this.orgId, sid, spId),
        this.reportsService.getBurndown(this.orgId, sid, spId),
        this.reportsService.getBurnup(this.orgId, sid, spId),
        this.reportsService.getFlow(this.orgId, sid, spId),
        this.reportsService.getVelocity(this.orgId, sid, 6),
        this.reportsService.getDevopsSummary(this.orgId, sid),
      ]);

      if (r.status === 'fulfilled') this.sprintReport.set(r.value?.data);
      if (bd.status === 'fulfilled') this.burndownData.set(bd.value?.data?.series ?? []);
      if (bu.status === 'fulfilled') this.burnupData.set(bu.value?.data?.series ?? []);
      if (cf.status === 'fulfilled') this.flowData.set(cf.value?.data?.series ?? []);
      if (vel.status === 'fulfilled') this.velocityData.set(vel.value?.data?.velocity ?? []);
      if (dev.status === 'fulfilled') this.devopsSummary.set(dev.value?.data);
    } catch (e) {
      console.error('[Reports] loadReportData:', e);
    } finally {
      this.loadingReport.set(false);
    }
  }

  private clearData() {
    this.sprintReport.set(null);
    this.burndownData.set([]);
    this.burnupData.set([]);
    this.velocityData.set([]);
    this.flowData.set([]);
    this.devopsSummary.set(null);
  }

  get sprintCompletionPct(): number {
    const r = this.sprintReport();
    if (!r?.totals?.total) return 0;
    return Math.round((r.totals.done / r.totals.total) * 100);
  }

  avgVelocity = computed(() => {
    const data = this.velocityData();
    if (!data.length) return 0;
    return Math.round(
      data.reduce((s: number, d: any) => s + (d.completedPoints || d.completedTasks || 0), 0) /
        data.length,
    );
  });

  epics = computed(() => {
    const tasks = this.sprintReport()?.tasks ?? [];
    const map: Record<string, any> = {};
    tasks.forEach((t: any) => {
      const key = t.parentTaskId ?? 'General';
      if (!map[key])
        map[key] = { name: 'General', color: '#6366f1', total: 0, done: 0, inprogress: 0, todo: 0 };
      map[key].total++;
      if (t.status === 'Done') map[key].done++;
      else if (t.status === 'InProgress') map[key].inprogress++;
      else map[key].todo++;
    });
    return Object.values(map).slice(0, 5);
  });

  epicPct(epic: any): number {
    return epic.total ? Math.round((epic.done / epic.total) * 100) : 0;
  }

  readonly BD_MAX = 40;
  readonly BU_MAX = 50;
  readonly VEL_MAX = 50;
  readonly FLOW_MAX = 44;
  readonly CYCLE_MAX = 12;
  readonly CYCLE_AVG = 3.9;
  readonly CYCLE_UCL = 8;
  readonly DEPLOY_MAX = 5;
  readonly LEAD_MAX = 15;

  barH(val: number, max: number): string {
    return (Math.min(val || 0, max) / max) * 100 + '%';
  }
  flowBarHeight(val: number): string {
    return this.barH(val, this.FLOW_MAX);
  }
  cycleBarColor(s: string): string {
    return s === 'outlier' ? '#ef4444' : '#6366f1';
  }

  // Static fallbacks for tabs without live backend data yet
  cycleData = [
    { task: 'T-001', days: 2, status: 'normal' },
    { task: 'T-002', days: 3, status: 'normal' },
    { task: 'T-003', days: 8, status: 'outlier' },
    { task: 'T-004', days: 2, status: 'normal' },
    { task: 'T-005', days: 4, status: 'normal' },
    { task: 'T-006', days: 11, status: 'outlier' },
  ];
  leadTimeData = [
    { stage: 'Coding', hours: 12 },
    { stage: 'Review', hours: 6 },
    { stage: 'Testing', hours: 8 },
    { stage: 'Deploy', hours: 3 },
  ];
}
