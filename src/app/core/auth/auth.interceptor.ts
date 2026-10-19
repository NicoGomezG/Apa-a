import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment.generated';
import { AuthService } from './auth.service';

const isApiRequest = (url: string) => url === environment.apiUrl || url.startsWith(`${environment.apiUrl}/`);

/** Adjunta el token de sesión SOLO a nuestra API; nunca a otros dominios. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiRequest(req.url)) return next(req);

  const auth = inject(AuthService);
  const router = inject(Router);

  return from(auth.accessToken()).pipe(
    switchMap((token) =>
      next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req),
    ),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        void auth.signOut().then(() => router.navigateByUrl('/auth/ingresar'));
      }
      return throwError(() => error);
    }),
  );
};
