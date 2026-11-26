import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@host:6543/postgres',
  SUPABASE_URL: 'https://abc.supabase.co',
};

describe('loadEnv', () => {
  it('aplica valores por defecto', () => {
    const env = loadEnv({ ...base });
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200']);
  });

  it('separa los orígenes CORS por coma', () => {
    expect(loadEnv({ ...base, CORS_ORIGINS: 'https://a.cl, https://b.cl' }).CORS_ORIGINS).toEqual([
      'https://a.cl',
      'https://b.cl',
    ]);
  });

  it('informa los nombres de las variables faltantes, nunca los valores', () => {
    expect(() => loadEnv({ SUPABASE_URL: 'no-es-url' })).toThrow(/DATABASE_URL.*SUPABASE_URL|SUPABASE_URL.*DATABASE_URL/);
    try {
      loadEnv({ ...base, SUPABASE_JWT_SECRET: 'corto-y-secreto' });
    } catch (err) {
      expect((err as Error).message).not.toContain('corto-y-secreto');
    }
  });

  it('exige la clave secreta en producción', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('una variable vacía (CLAVE=) cuenta como no definida', () => {
    const env = loadEnv({ ...base, SUPABASE_SECRET_KEY: '', SUPABASE_JWT_SECRET: '  ', CORS_ORIGINS: '' });
    expect(env.SUPABASE_SECRET_KEY).toBeUndefined();
    expect(env.SUPABASE_JWT_SECRET).toBeUndefined();
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200']);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', SUPABASE_SECRET_KEY: '' })).toThrow(/SUPABASE_SECRET_KEY/);
  });
});
