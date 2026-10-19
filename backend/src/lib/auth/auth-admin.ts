import { createClient } from '@supabase/supabase-js';
import type { Env } from '../../config/env.js';

export interface AuthAdmin {
  /** Elimina la identidad en Supabase Auth. Si ya no existe, no falla. */
  deleteUser(userId: string): Promise<void>;
}

export function createSupabaseAuthAdmin(env: Env): AuthAdmin {
  return {
    async deleteUser(userId) {
      if (!env.SUPABASE_SECRET_KEY) {
        throw new Error('SUPABASE_SECRET_KEY no está configurada');
      }
      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error && error.status !== 404) {
        throw new Error(`Supabase Auth no pudo eliminar al usuario (status ${error.status ?? 'desconocido'})`);
      }
    },
  };
}
