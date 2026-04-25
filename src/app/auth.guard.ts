import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    router.navigate(['/login']);
    return false;
  }

  // ✅ FIX: currentUser() يرجع User | null مباشرة
  const user = auth.currentUser();
  if (!user?.orgId) {
    router.navigate(['/onboarding']);
    return false;
  }

  return true;
};

export const guestGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) return true;

  const user = auth.currentUser();
  if (!user?.orgId) {
    router.navigate(['/onboarding']);
    return false;
  }

  router.navigate(['/dashboard']);
  return false;
};