import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth  = inject(AuthService);
  const token = auth.token();

  // Skip if no token or request already has Authorization header
  if (!token || req.headers.has('Authorization')) {
    return next(req);
  }

  const cloned = req.clone({
    setHeaders: { Authorization: `Bearer ${token}` }
  });

  return next(cloned);
};