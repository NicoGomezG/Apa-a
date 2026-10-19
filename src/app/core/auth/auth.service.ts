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

  constructor() {
    this.ready = this.supabase.auth.getSession().then(({ data }) => {
      this.sessionState.set(data.session);
      this.initializedState.set(true);
    });

    this.supabase.auth.onAuthStateChange((event, session) => {
      this.sessionState.set(session);
      if (event === 'PASSWORD_RECOVERY') {
        void this.router.navigateByUrl('/auth/nueva-clave');
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

  async signUp(email: string, password: string, fullName: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    });
    return error ? failure(error) : { ok: true };
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

  async updatePassword(password: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.updateUser({ password });
    return error ? failure(error) : { ok: true };
  }

  async signOut(): Promise<void> {
    // scope 'local': cierra este dispositivo aunque el servidor no responda.
    await this.supabase.auth.signOut({ scope: 'local' });
    this.sessionState.set(null);
  }
}
