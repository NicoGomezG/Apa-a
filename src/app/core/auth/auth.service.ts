import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase';
import { authErrorMessage } from './auth-errors';

export type AuthResult = { ok: true } | { ok: false; message: string };

const failure = (error: Parameters<typeof authErrorMessage>[0]): AuthResult => ({
  ok: false,
  message: authErrorMessage(error),
});

const RECOVERY_KEY = 'apana.recuperando';

function readRecovering(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1';
  } catch {
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE);
  private readonly router = inject(Router);

  private readonly sessionState = signal<Session | null>(null);
  readonly session = this.sessionState.asReadonly();
  readonly isAuthenticated = computed(() => this.sessionState() !== null);
  readonly email = computed(() => this.sessionState()?.user.email ?? null);
  private readonly initializedState = signal(false);
  readonly initialized = this.initializedState.asReadonly();

  /** Se resuelve cuando ya se sabe si hay sesión (incluye el canje de ?code= de OAuth). */
  readonly ready: Promise<void>;

  /**
   * true solo si se llegó desde el enlace de recuperación del correo (evento PASSWORD_RECOVERY).
   * Cambiar la contraseña exige esto: con la sesión abierta no basta. Se guarda en sessionStorage
   * para sobrevivir una recarga de /auth/nueva-clave en la misma pestaña.
   */
  private readonly recoveringState = signal(readRecovering());
  readonly recovering = this.recoveringState.asReadonly();

  constructor() {
    this.ready = this.supabase.auth.getSession().then(({ data }) => {
      this.sessionState.set(data.session);
      this.initializedState.set(true);
    });

    this.supabase.auth.onAuthStateChange((event, session) => {
      this.sessionState.set(session);
      if (event === 'PASSWORD_RECOVERY') {
        this.setRecovering(true);
        void this.router.navigateByUrl('/auth/nueva-clave');
      } else if (event === 'SIGNED_OUT') {
        this.setRecovering(false);
      }
    });
  }

  async accessToken(): Promise<string | null> {
    // getSession renueva el token si está por expirar.
    const { data } = await this.supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    return error ? failure(error) : { ok: true };
  }

  /**
   * Con "Confirm email" apagado en Supabase, la respuesta trae sesión y la persona queda dentro.
   * Si viene sin sesión (confirmación activa o correo ya registrado) hay que mostrar "revisa tu correo".
   */
  async signUp(email: string, password: string, fullName: string): Promise<AuthResult & { signedIn?: boolean }> {
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    });
    if (error) return failure(error);
    if (data.session) this.sessionState.set(data.session);
    return { ok: true, signedIn: data.session !== null };
  }

  async signInWithGoogle(): Promise<AuthResult> {
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    return error ? failure(error) : { ok: true };
  }

  async sendPasswordReset(email: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/nueva-clave`,
    });
    return error ? failure(error) : { ok: true };
  }

  /** Solo desde el enlace de recuperación (ver `recovering`). */
  async updatePassword(password: string): Promise<AuthResult> {
    if (!this.recoveringState()) {
      return { ok: false, message: 'Para cambiar tu contraseña, pide el enlace por correo.' };
    }
    const { error } = await this.supabase.auth.updateUser({ password });
    if (error) return failure(error);
    this.setRecovering(false);
    return { ok: true };
  }

  private setRecovering(value: boolean): void {
    this.recoveringState.set(value);
    try {
      if (value) sessionStorage.setItem(RECOVERY_KEY, '1');
      else sessionStorage.removeItem(RECOVERY_KEY);
    } catch {
      // Sin almacenamiento: vale solo mientras no se recargue la página.
    }
  }

  async signOut(): Promise<void> {
    // scope 'local': cierra este dispositivo aunque el servidor no responda.
    await this.supabase.auth.signOut({ scope: 'local' });
    this.sessionState.set(null);
  }
}
