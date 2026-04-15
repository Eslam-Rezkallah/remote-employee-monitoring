import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './services/auth.service';

/**
 * Protects dashboard routes.
 *
 * Flow:
 *  1. Not logged in → /login
 *  2. Logged in but no orgId → /onboarding (must create/join org first)
 *  3. Logged in + has orgId → ✅ allow
 */
export const authGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    router.navigate(['/login']);
    return false;
  }

  // FIX: Check if user has joined/created an org
  const user = auth.currentUser();
  if (!user?.orgId) {
    router.navigate(['/onboarding']);
    return false;
  }

  return true;
};

/**
 * Blocks logged-in users from accessing /login and /signup.
 *
 * Flow:
 *  1. Not logged in → ✅ allow (show login/signup)
 *  2. Logged in but no orgId → /onboarding
 *  3. Logged in + has orgId → /dashboard
 */
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