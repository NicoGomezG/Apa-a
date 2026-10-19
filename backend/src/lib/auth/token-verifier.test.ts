import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { testEnv } from '../../test/fakes.js';
import { createSupabaseTokenVerifier, payloadToUser } from './token-verifier.js';

const SECRET = 'un-secreto-de-prueba-suficientemente-largo-para-hs256';
const SUB = '0192f0a4-1c2b-7d3e-8f40-5a6b7c8d9e01';
const ISSUER = `${testEnv.SUPABASE_URL}/auth/v1`;

function sign(claims: Record<string, unknown>, opts: { secret?: string; issuer?: string; audience?: string; exp?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(SUB)
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

describe('verificador de tokens de Supabase (HS256)', () => {
  const verify = createSupabaseTokenVerifier({ ...testEnv, SUPABASE_JWT_SECRET: SECRET });

  it('acepta un token válido de usuario autenticado', async () => {
    const token = await sign({ role: 'authenticated', email: 'a@b.cl', user_metadata: { full_name: 'Ana Pérez' } });
    await expect(verify(token)).resolves.toEqual({ id: SUB, email: 'a@b.cl', suggestedName: 'Ana Pérez' });
  });

  it('rechaza firma, emisor, audiencia o expiración incorrectos', async () => {
    const bad = [
      await sign({ role: 'authenticated' }, { secret: 'otro-secreto-de-prueba-suficientemente-largo-xx' }),
      await sign({ role: 'authenticated' }, { issuer: 'https://otro.supabase.co/auth/v1' }),
      await sign({ role: 'authenticated' }, { audience: 'anon' }),
      await sign({ role: 'authenticated' }, { exp: '-1m' }),
    ];
    for (const token of bad) {
      await expect(verify(token)).rejects.toThrow();
    }
  });

  it('rechaza tokens del rol anónimo', async () => {
    const token = await sign({ role: 'anon' });
    await expect(verify(token)).rejects.toThrow();
  });
});

describe('payloadToUser', () => {
  it('exige un sub con formato UUID', () => {
    expect(() => payloadToUser({ sub: '1 OR 1=1', role: 'authenticated' })).toThrow();
  });

  it('recorta nombres largos y descarta los vacíos', () => {
    expect(payloadToUser({ sub: SUB, role: 'authenticated', user_metadata: { name: 'x'.repeat(100) } }).suggestedName).toHaveLength(80);
    expect(payloadToUser({ sub: SUB, role: 'authenticated', user_metadata: { name: '  ' } }).suggestedName).toBeNull();
  });
});
