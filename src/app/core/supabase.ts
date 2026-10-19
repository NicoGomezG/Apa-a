import { InjectionToken } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment.generated';

export const isSupabaseConfigured = (): boolean =>
  Boolean(environment.supabaseUrl && environment.supabasePublishableKey);

/**
 * Cliente de Supabase SOLO para autenticación (sesión, login, OAuth).
 * Los datos de Apaña se leen y escriben siempre a través de nuestra API (/api),
 * nunca directo contra la base.
 */
export const SUPABASE = new InjectionToken<SupabaseClient>('SUPABASE', {
  providedIn: 'root',
  factory: () =>
    createClient(
      environment.supabaseUrl || 'http://localhost:54321',
      environment.supabasePublishableKey || 'not-configured',
      {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    ),
});
