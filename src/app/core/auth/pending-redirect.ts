import { safeRedirect } from './auth.guards';

// Destino pendiente tras ingresar con Google o confirmar el correo (p. ej. una invitación de
// amistad). Esos flujos salen de la app y vuelven por /auth/callback, así que se guarda en
// localStorage. Si el almacenamiento no está disponible, se vuelve al inicio.

const KEY = 'apana.volver';

export function rememberRedirect(target: string | undefined): void {
  const url = safeRedirect(target, '');
  try {
    if (url) localStorage.setItem(KEY, url);
    else localStorage.removeItem(KEY);
  } catch {
    // Sin almacenamiento: no pasa nada, se vuelve al inicio.
  }
}

/** Devuelve y olvida el destino pendiente. */
export function takeRedirect(): string {
  try {
    const url = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return safeRedirect(url);
  } catch {
    return '/';
  }
}
