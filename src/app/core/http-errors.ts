import { HttpErrorResponse } from '@angular/common/http';

/** Mensaje para mostrar al usuario a partir de un error de nuestra API. */
export function apiErrorMessage(error: unknown, fallback = 'No pudimos completar la operación. Intenta de nuevo.'): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'No pudimos conectarnos. Revisa tu conexión a internet.';
    const message = (error.error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}
