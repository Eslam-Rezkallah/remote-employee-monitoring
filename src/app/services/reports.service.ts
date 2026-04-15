import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASE } from './auth.service';
import { firstValueFrom } from 'rxjs';

/**
 * Reports service — connects to real backend report & metrics endpoints.
 *
 * Backend endpoints:
 *   GET /org/:orgId/spaces/:spaceId/reports/sprints/:sprintId                → sprint report
 *   GET /org/:orgId/spaces/:spaceId/reports/sprints/:sprintId/burndown       → burndown chart
 *   GET /org/:orgId/spaces/:spaceId/reports/sprints/:sprintId/burnup         → burnup chart
 *   GET /org/:orgId/spaces/:spaceId/reports/sprints/:sprintId/cumulative-flow → cumulative flow
 *   GET /org/:orgId/spaces/:spaceId/metrics/velocity?sprints=N               → velocity
 *   GET /org/:orgId/spaces/:spaceId/metrics/cycle-time                       → cycle time
 *   GET /org/:orgId/spaces/:spaceId/devops/summary                           → DevOps DORA metrics
 *   GET /org/:orgId/spaces/:spaceId/ai/sprint-completion                     → AI predictions
 *   GET /org/:orgId/spaces/:spaceId/ai/bottlenecks                           → AI bottleneck detection
 */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private http = inject(HttpClient);

  // ── Sprint Report ───────────────────────────────────────
  async getSprintReport(orgId: string, spaceId: string, sprintId: string): Promise<any> {
    return firstValueFrom(
      this.http.get(`${BASE}/org/${orgId}/spaces/${spaceId}/reports/sprints/${sprintId}`)
    );
  }

  // ── Burndown Chart ──────────────────────────────────────
  async getBurndown(orgId: string, spaceId: string, sprintId: string): Promise<any> {
    return firstValueFrom(
      this.http.get(`${BASE}/org/${orgId}/spaces/${spaceId}/reports/sprints/${sprintId}/burndown`)
    );
  }

  // ── Burnup Chart ────────────────────────────────────────
  async getBurnup(orgId: string, spaceId: string, sprintId: string): Promise<any> {
    return firstValueFrom(
      this.http.get(`${BASE}/org/${orgId}/spaces/${spaceId}/reports/sprints/${sprintId}/burnup`)
    );
  }

  // ── Cumulative Flow ─────────────────────────────────────
  async getFlow(orgId: string, spaceId: string, sprintId: string): Promise<any> {
    return firstValueFrom(
      this.http.get(`${BASE}/org/${orgId}/spaces/${spaceId}/reports/sprints/${sprintId}/cumulative-flow`)
    );
  }

  // ── Velocity ────────────────────────────────────────────
  async getVelocity(orgId: string, spaceId: string, sprints: number = 6): Promise<any> {
    return firstValueFrom(
      this.http.get(`${BASE}/org/${orgId}/spaces/${spaceId}/metrics/velocity`, {
        params: { sprints: sprints.toString() }
      })
    );
  }

  // ── Cycle Time ──────────────────────────────────────────
  async getCycleTime(orgId: string, spaceId: string): Promise<any> {
    return firstValueFrom(
      this.http.get(`${BASE}/org/${orgId}/spaces/${spaceId}/metrics/cycle-time`)
    );
  }

  // ── DevOps Summary (DORA metrics) ───────────────────────
  async getDevopsSummary(orgId: string, spaceId: string): Promise<any> {
    return firstValueFrom(
      this.http.get(`${BASE}/org/${orgId}/spaces/${spaceId}/devops/summary`)
    );
  }

  // ── AI: Sprint Completion Prediction ────────────────────
  async getAiSprintCompletion(orgId: string, spaceId: string): Promise<any> {
    return firstValueFrom(
      this.http.get(`${BASE}/org/${orgId}/spaces/${spaceId}/ai/sprint-completion`)
    );
  }

  // ── AI: Bottleneck Detection ────────────────────────────
  async getAiBottlenecks(orgId: string, spaceId: string): Promise<any> {
    return firstValueFrom(
      this.http.get(`${BASE}/org/${orgId}/spaces/${spaceId}/ai/bottlenecks`)
    );
  }
}