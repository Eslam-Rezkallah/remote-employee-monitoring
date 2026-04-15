import { Component, input, output, signal } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { RouterModule } from '@angular/router';

// ════════════════════════════════════════════════════════════
// FE-9.1 Reusable Task Card
// ════════════════════════════════════════════════════════════
@Component({
  selector: 'app-task-card',
  standalone: true,
  imports: [CommonModule, TitleCasePipe],
  template: `
    <div class="task-card-r"
         [class.tcr-urgent]="task().priority === 'highest'"
         [class.tcr-done]="task().status === 'done'">
      <div class="tcr-top">
        <span class="tcr-type">{{ typeIcon(task().workType) }}</span>
        <span class="tcr-badge"
              [style.background]="priorityColor(task().priority) + '18'"
              [style.color]="priorityColor(task().priority)">
          {{ task().priority | titlecase }}
        </span>
        <span class="tcr-status"
              [style.background]="statusColor(task().status) + '18'"
              [style.color]="statusColor(task().status)">
          {{ statusLabel(task().status) }}
        </span>
        @if (task().dueDate) {
          <span class="tcr-due">{{ task().dueDate }}</span>
        }
      </div>
      <span class="tcr-title" [class.tcr-striked]="task().status === 'done'">{{ task().title }}</span>
      @if (task().status === 'inprogress' && task().progress > 0) {
        <div class="tcr-prog"><div class="tcr-prog-fill" [style.width]="task().progress + '%'"></div></div>
      }
      @if (task().labels?.length > 0) {
        <div class="tcr-labels">
          @for (l of task().labels.slice(0,3); track l) {
            <span class="tcr-label">{{ l }}</span>
          }
        </div>
      }
      <div class="tcr-footer">
        <div class="tcr-av" [style.background]="task().assigneeColor">{{ task().assigneeInitial }}</div>
        <span class="tcr-name">{{ task().assignee }}</span>
        @if (task().estimated > 0) {
          <span class="tcr-hours">{{ task().logged }}h / {{ task().estimated }}h</span>
        }
      </div>
    </div>
  `,
  styles: [`
    .task-card-r { background: var(--color-background-primary); border: 1px solid var(--color-border-tertiary); border-radius: 10px; padding: 12px; transition: box-shadow 0.15s; }
    .task-card-r:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
    .tcr-urgent { border-left: 3px solid #ef4444; }
    .tcr-done   { opacity: 0.65; }
    .tcr-top    { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 7px; }
    .tcr-type   { font-size: 13px; }
    .tcr-badge, .tcr-status { font-size: 10px; padding: 2px 7px; border-radius: 5px; font-weight: 500; }
    .tcr-due    { margin-left: auto; font-size: 11px; color: var(--color-text-tertiary); }
    .tcr-title  { display: block; font-size: 13px; font-weight: 500; color: var(--color-text-primary); line-height: 1.4; margin-bottom: 8px; }
    .tcr-striked { text-decoration: line-through; color: var(--color-text-tertiary); }
    .tcr-prog   { height: 3px; background: var(--color-border-tertiary); border-radius: 99px; overflow: hidden; margin-bottom: 8px; }
    .tcr-prog-fill { height: 100%; background: #6366f1; border-radius: 99px; }
    .tcr-labels { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
    .tcr-label  { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--color-background-secondary); color: var(--color-text-tertiary); border: 1px solid var(--color-border-tertiary); }
    .tcr-footer { display: flex; align-items: center; gap: 7px; }
    .tcr-av     { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #fff; flex-shrink: 0; }
    .tcr-name   { font-size: 12px; color: var(--color-text-secondary); flex: 1; }
    .tcr-hours  { font-size: 11px; color: var(--color-text-tertiary); }
  `]
})
export class TaskCardComponent {
  task = input.required<any>();

  priorityColor(p: string) {
    return ({ highest:'#ef4444',high:'#f97316',medium:'#f59e0b',low:'#10b981',lowest:'#06b6d4' } as any)[p] ?? '#6b7280';
  }
  statusColor(s: string) {
    return ({ todo:'#9ca3af',inprogress:'#6366f1',inreview:'#f59e0b',done:'#10b981' } as any)[s] ?? '#9ca3af';
  }
  statusLabel(s: string) {
    return ({ todo:'To Do',inprogress:'In Progress',inreview:'In Review',done:'Done' } as any)[s] ?? s;
  }
  typeIcon(w: string) {
    return ({ task:'✓',feature:'★',bug:'🐛',epic:'⚡' } as any)[w] ?? '•';
  }
}

// ════════════════════════════════════════════════════════════
// FE-9.2 Reusable Space Card
// ════════════════════════════════════════════════════════════
@Component({
  selector: 'app-space-card',
  standalone: true,
  imports: [CommonModule, RouterModule, TitleCasePipe],
  template: `
    <a class="space-card-r" [routerLink]="['/dashboard/spaces', space().id]">
      <div class="scr-header">
        <div class="scr-icon" [style.background]="space().color + '18'">{{ space().icon }}</div>
        <button class="scr-star" (click)="starClick.emit(space().id); $event.preventDefault(); $event.stopPropagation()"
                [class.scr-starred]="space().isStarred">
          {{ space().isStarred ? '★' : '☆' }}
        </button>
      </div>
      <span class="scr-name">{{ space().name }}</span>
      <span class="scr-key">{{ space().key }} · {{ space().type | titlecase }}</span>
      <div class="scr-footer">
        <span class="scr-lead">{{ space().lead }}</span>
        <span class="scr-members">{{ space().members }} members</span>
      </div>
      <div class="scr-bar" [style.background]="space().color + '20'">
        <div class="scr-bar-fill" [style.background]="space().color" style="width:70%"></div>
      </div>
    </a>
  `,
  styles: [`
    .space-card-r { display: flex; flex-direction: column; gap: 6px; background: var(--color-background-secondary); border: 1px solid var(--color-border-tertiary); border-radius: 12px; padding: 14px; text-decoration: none; transition: box-shadow 0.15s, border-color 0.15s; cursor: pointer; }
    .space-card-r:hover { box-shadow: 0 3px 12px rgba(0,0,0,0.08); border-color: var(--color-border-secondary); }
    .scr-header { display: flex; align-items: center; justify-content: space-between; }
    .scr-icon   { width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 17px; }
    .scr-star   { background: none; border: none; font-size: 16px; cursor: pointer; color: var(--color-text-tertiary); transition: color 0.12s; }
    .scr-starred { color: #f59e0b; }
    .scr-name   { font-size: 13px; font-weight: 500; color: var(--color-text-primary); }
    .scr-key    { font-size: 11px; color: var(--color-text-tertiary); }
    .scr-footer { display: flex; justify-content: space-between; font-size: 11px; color: var(--color-text-tertiary); }
    .scr-bar    { height: 4px; border-radius: 99px; overflow: hidden; margin-top: 4px; }
    .scr-bar-fill { height: 100%; border-radius: 99px; }
  `]
})
export class SpaceCardComponent {
  space    = input.required<any>();
  starClick = output<string>();
}

// ════════════════════════════════════════════════════════════
// FE-9.3 Modal / Dialog
// ════════════════════════════════════════════════════════════
@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (open()) {
      <div class="modal-backdrop-r" (click)="closeOnBackdrop && close.emit()"></div>
      <div class="modal-panel-r" [style.max-width]="maxWidth()" role="dialog" aria-modal="true">
        <div class="modal-header-r">
          <h2 class="modal-title-r">{{ title() }}</h2>
          <button class="modal-close-r" (click)="close.emit()">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="modal-body-r"><ng-content/></div>
      </div>
    }
  `,
  styles: [`
    .modal-backdrop-r { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100; }
    .modal-panel-r    { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 101; background: var(--color-background-primary); border: 1px solid var(--color-border-secondary); border-radius: 14px; width: 90vw; max-height: 85vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.16); animation: modal-in 0.2s ease; }
    @keyframes modal-in { from { opacity:0; transform: translate(-50%,-48%) scale(0.97); } to { opacity:1; transform: translate(-50%,-50%) scale(1); } }
    .modal-header-r   { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--color-border-tertiary); }
    .modal-title-r    { font-size: 15px; font-weight: 500; color: var(--color-text-primary); margin: 0; }
    .modal-close-r    { background: none; border: none; padding: 4px; cursor: pointer; color: var(--color-text-tertiary); border-radius: 6px; display: flex; }
    .modal-close-r:hover { background: var(--color-background-secondary); }
    .modal-body-r     { padding: 20px; }
  `]
})
export class ModalComponent {
  open           = input<boolean>(false);
  title          = input<string>('');
  maxWidth       = input<string>('520px');
  closeOnBackdrop = true;
  close          = output<void>();
}

// ════════════════════════════════════════════════════════════
// FE-9.4 Dropdown Menu
// ════════════════════════════════════════════════════════════
export interface DropdownItem {
  label: string;
  icon?: string;
  danger?: boolean;
  action: () => void;
}

@Component({
  selector: 'app-dropdown',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dropdown-wrap" style="position:relative">
      <div (click)="toggle()"><ng-content select="[trigger]"/></div>
      @if (isOpen()) {
        <div class="dropdown-backdrop" (click)="close()"></div>
        <div class="dropdown-menu" [class.dropdown-up]="direction() === 'up'">
          @for (item of items(); track item.label) {
            <button class="dropdown-item" [class.dropdown-danger]="item.danger"
                    (click)="item.action(); close()">
              @if (item.icon) { <span class="di-icon">{{ item.icon }}</span> }
              {{ item.label }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .dropdown-backdrop { position: fixed; inset: 0; z-index: 200; }
    .dropdown-menu     { position: absolute; right: 0; top: calc(100% + 6px); z-index: 201; background: var(--color-background-primary); border: 1px solid var(--color-border-secondary); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 180px; padding: 4px; animation: dd-in 0.15s ease; }
    .dropdown-up       { top: auto; bottom: calc(100% + 6px); }
    @keyframes dd-in   { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
    .dropdown-item     { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; font-size: 13px; color: var(--color-text-secondary); border-radius: 7px; cursor: pointer; transition: background 0.12s; }
    .dropdown-item:hover { background: var(--color-background-secondary); color: var(--color-text-primary); }
    .dropdown-danger   { color: #ef4444 !important; }
    .dropdown-danger:hover { background: #ef444412 !important; }
    .di-icon           { font-size: 14px; }
  `]
})
export class DropdownComponent {
  items     = input<DropdownItem[]>([]);
  direction = input<'down' | 'up'>('down');
  isOpen    = signal(false);
  toggle()  { this.isOpen.update(v => !v); }
  close()   { this.isOpen.set(false); }
}

// ════════════════════════════════════════════════════════════
// FE-9.6 Loading Skeleton
// ════════════════════════════════════════════════════════════
@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (type() === 'card') {
      <div class="skel-card">
        <div class="skel-row">
          <div class="skel skel-circle"></div>
          <div style="flex:1">
            <div class="skel skel-line" style="width:60%;margin-bottom:6px"></div>
            <div class="skel skel-line" style="width:40%"></div>
          </div>
        </div>
        <div class="skel skel-line" style="width:100%;margin-bottom:6px"></div>
        <div class="skel skel-line" style="width:75%"></div>
      </div>
    }
    @if (type() === 'list') {
      @for (i of rows(); track i) {
        <div class="skel-list-row">
          <div class="skel skel-circle-sm"></div>
          <div style="flex:1">
            <div class="skel skel-line" [style.width]="(50 + i * 7) + '%'"></div>
          </div>
          <div class="skel skel-pill"></div>
        </div>
      }
    }
    @if (type() === 'table') {
      <div class="skel-table">
        <div class="skel skel-header"></div>
        @for (i of rows(); track i) {
          <div class="skel-table-row">
            <div class="skel skel-line" style="width:30%"></div>
            <div class="skel skel-line" style="width:20%"></div>
            <div class="skel skel-pill"></div>
            <div class="skel skel-pill"></div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
    .skel { background: linear-gradient(90deg, var(--color-border-tertiary) 25%, var(--color-background-secondary) 50%, var(--color-border-tertiary) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 4px; }
    .skel-card       { background: var(--color-background-secondary); border: 1px solid var(--color-border-tertiary); border-radius: 12px; padding: 14px; }
    .skel-row        { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .skel-circle     { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; }
    .skel-circle-sm  { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; }
    .skel-line       { height: 12px; border-radius: 6px; }
    .skel-pill       { width: 60px; height: 20px; border-radius: 99px; }
    .skel-header     { height: 40px; border-radius: 6px; margin-bottom: 8px; }
    .skel-list-row   { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--color-border-tertiary); }
    .skel-table      { }
    .skel-table-row  { display: flex; align-items: center; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--color-border-tertiary); }
  `]
})
export class SkeletonComponent {
  type = input<'card' | 'list' | 'table'>('card');
  count = input<number>(3);
  rows = input<number[]>([1, 2, 3]);
}

// ════════════════════════════════════════════════════════════
// FE-9.7 Empty State
// ════════════════════════════════════════════════════════════
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="empty-state-r">
      <div class="esr-icon">
        @if (icon() === 'tasks') {
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z"/>
          </svg>
        }
        @if (icon() === 'search') {
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/>
          </svg>
        }
        @if (icon() === 'spaces') {
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Z"/>
          </svg>
        }
        @if (icon() === 'star') {
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/>
          </svg>
        }
      </div>
      <p class="esr-title">{{ title() }}</p>
      @if (description()) {
        <p class="esr-desc">{{ description() }}</p>
      }
      @if (actionLabel()) {
        <button class="btn-primary esr-btn" (click)="action.emit()">{{ actionLabel() }}</button>
      }
    </div>
  `,
  styles: [`
    .empty-state-r { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 24px; text-align: center; color: var(--color-text-tertiary); }
    .esr-icon   { opacity: 0.4; }
    .esr-title  { font-size: 14px; font-weight: 500; color: var(--color-text-secondary); margin: 0; }
    .esr-desc   { font-size: 12px; color: var(--color-text-tertiary); margin: 0; max-width: 280px; line-height: 1.5; }
    .esr-btn    { margin-top: 8px; }
  `]
})
export class EmptyStateComponent {
  icon        = input<'tasks' | 'search' | 'spaces' | 'star'>('tasks');
  title       = input<string>('Nothing here yet');
  description = input<string>('');
  actionLabel = input<string>('');
  action      = output<void>();
}

// ════════════════════════════════════════════════════════════
// FE-9.5 Form Input with validation
// ════════════════════════════════════════════════════════════
@Component({
  selector: 'app-form-input',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fi-wrap">
      @if (label()) {
        <label class="fi-label">
          {{ label() }}
          @if (required()) { <span class="fi-req">*</span> }
        </label>
      }
      @if (type() === 'textarea') {
        <textarea class="fi-input fi-textarea"
                  [placeholder]="placeholder()"
                  [class.fi-error]="error()"
                  [rows]="rows()"
                  (input)="valueChange.emit($any($event.target).value)">{{ value() }}</textarea>
      } @else {
        <input class="fi-input"
               [type]="type()"
               [placeholder]="placeholder()"
               [value]="value()"
               [class.fi-error]="error()"
               (input)="valueChange.emit($any($event.target).value)"/>
      }
      @if (error()) {
        <p class="fi-error-msg">{{ error() }}</p>
      }
      @if (hint() && !error()) {
        <p class="fi-hint">{{ hint() }}</p>
      }
    </div>
  `,
  styles: [`
    .fi-wrap    { display: flex; flex-direction: column; gap: 5px; }
    .fi-label   { font-size: 12px; font-weight: 500; color: var(--color-text-secondary); }
    .fi-req     { color: #ef4444; margin-left: 2px; }
    .fi-input   { padding: 9px 12px; background: var(--color-background-secondary); border: 1px solid var(--color-border-tertiary); border-radius: 8px; font-size: 13px; color: var(--color-text-primary); outline: none; transition: border-color 0.15s, box-shadow 0.15s; width: 100%; box-sizing: border-box; }
    .fi-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
    .fi-input.fi-error { border-color: #ef4444; }
    .fi-input.fi-error:focus { box-shadow: 0 0 0 3px rgba(239,68,68,0.12); }
    .fi-textarea { resize: vertical; min-height: 80px; }
    .fi-error-msg { font-size: 11px; color: #ef4444; margin: 0; }
    .fi-hint    { font-size: 11px; color: var(--color-text-tertiary); margin: 0; }
  `]
})
export class FormInputComponent {
  label       = input<string>('');
  type        = input<string>('text');
  placeholder = input<string>('');
  value       = input<string>('');
  error       = input<string>('');
  hint        = input<string>('');
  required    = input<boolean>(false);
  rows        = input<number>(3);
  valueChange = output<string>();
}