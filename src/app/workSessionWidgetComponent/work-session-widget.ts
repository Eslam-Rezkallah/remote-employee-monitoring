import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkSessionService } from '../services/work-session.service';

@Component({
  selector: 'app-work-session-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './work-session-widget.html',
  styleUrls: ['./work-session-widget.css'],
})
export class WorkSessionWidgetComponent {
  ws = inject(WorkSessionService);

  isLoading = signal(false);

  async onStart() {
    this.isLoading.set(true);
    await this.ws.start();
    this.isLoading.set(false);
  }

  async onPause() {
    this.isLoading.set(true);
    await this.ws.pause();
    this.isLoading.set(false);
  }

  async onResume() {
    this.isLoading.set(true);
    await this.ws.resume();
    this.isLoading.set(false);
  }

  async onStop() {
    this.isLoading.set(true);
    await this.ws.stop();
    this.isLoading.set(false);
  }
}