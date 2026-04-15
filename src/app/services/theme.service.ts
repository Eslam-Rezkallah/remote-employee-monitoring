import { Injectable, signal, effect } from '@angular/core';

export type Theme = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  theme = signal<Theme>((localStorage.getItem('theme') as Theme) ?? 'system');

  constructor() {
    effect(() => {
      const t = this.theme();
      localStorage.setItem('theme', t);
      this.applyTheme(t);
    });
  }

  private applyTheme(theme: Theme) {
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  toggle() {
    this.theme.update(t => t === 'dark' ? 'light' : 'dark');
  }

  setTheme(t: Theme) { this.theme.set(t); }
  isDark() { return this.theme() === 'dark'; }
}