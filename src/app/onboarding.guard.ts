import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn, Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { OnboardingComponent } from './onboardingComponent/onboarding.component';

/** Only allow onboarding if logged in but has no orgId yet */
export const onboardingGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    router.navigate(['/login']);
    return false;
  }

  const user = auth.currentUser();

  // Already has an org → go to dashboard
  if (user?.orgId) {
    router.navigate(['/dashboard']);
    return false;
  }

  return true;
};

/** Warn user before leaving onboarding mid-way */
export const onboardingDeactivateGuard: CanDeactivateFn<OnboardingComponent> = (component) => {
  // If on step 3 (success) or step 1 (nothing filled), allow navigation freely
  if (component.step() === 3 || component.step() === 1) return true;

  return confirm('Are you sure you want to leave? Your progress will be lost.');
};