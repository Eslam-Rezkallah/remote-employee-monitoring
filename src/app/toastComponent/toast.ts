import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="'toast-' + toast.type" role="alert">
          <span class="toast-icon">
            @if (toast.type === 'success') { ✓ }
            @if (toast.type === 'error')   { ✕ }
            @if (toast.type === 'warning') { ⚠ }
            @if (toast.type === 'info')    { ℹ }
          </span>
          <span class="toast-msg">{{ toast.message }}</span>
          <button class="toast-close" (click)="toastService.dismiss(toast.id)">×</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .toast {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 500;
      min-width: 280px;
      max-width: 400px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      pointer-events: all;
      animation: toast-in 0.25s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(20px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .toast-success { background: #10b981; color: #fff; }
    .toast-error   { background: #ef4444; color: #fff; }
    .toast-warning { background: #f59e0b; color: #fff; }
    .toast-info    { background: #6366f1; color: #fff; }
    .toast-icon    { font-size: 15px; flex-shrink: 0; }
    .toast-msg     { flex: 1; }
    .toast-close   { background: none; border: none; color: rgba(255,255,255,0.8); font-size: 18px; cursor: pointer; padding: 0 2px; line-height: 1; }
    .toast-close:hover { color: #fff; }
  `]
})
export class ToastComponent {
  toastService = inject(ToastService);
}