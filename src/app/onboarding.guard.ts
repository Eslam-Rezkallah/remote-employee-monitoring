import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn, Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { OnboardingComponent } from './onboardingComponent/onboarding.component';

export const onboardingGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    router.navigate(['/login']);
    return false;
  }

  // ✅ FIX: currentUser() يرجع User | null مباشرة
  const user = auth.currentUser();
  if (user?.orgId) {
    router.navigate(['/dashboard']);
    return false;
  }

  return true;
};

export const onboardingDeactivateGuard: CanDeactivateFn<OnboardingComponent> = (component) => {
  if (component.step() === 3 || component.step() === 1) return true;
  return confirm('Are you sure you want to leave? Your progress will be lost.');
};