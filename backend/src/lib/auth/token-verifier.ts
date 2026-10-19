import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../../config/env.js';

export interface AuthUser {
  id: string;
  email: string | null;
  // Nombre que viene de Google u otro proveedor, si existe. Solo se usa como
  // valor inicial del perfil.
  suggestedName: string | null;
}

export type TokenVerifier = (token: string) => Promise<AuthUser>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function payloadToUser(payload: JWTPayload): AuthUser {
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
    throw new Error('token without a valid subject');
  }
  // Supabase emite tokens anónimos con `role: anon`; solo aceptamos usuarios autenticados.
  if (payload['role'] !== 'authenticated') {
    throw new Error('token is not for an authenticated user');
  }
  const metadata = (payload['user_metadata'] ?? {}) as Record<string, unknown>;
  const name = metadata['full_name'] ?? metadata['name'];
  return {
    id: payload.sub,
    email: typeof payload['email'] === 'string' ? payload['email'] : null,
    suggestedName: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null,
  };
}

/**
 * Valida los access tokens de Supabase Auth.
 * - Proyectos con claves de firma asimétricas: JWKS público del proyecto.
 * - Proyectos con el secreto HS256 heredado: SUPABASE_JWT_SECRET.
 */
export function createSupabaseTokenVerifier(env: Env): TokenVerifier {
  const issuer = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const options = { issuer, audience: 'authenticated' };

  if (env.SUPABASE_JWT_SECRET) {
    const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    return async (token) => {
      const { payload } = await jwtVerify(token, secret, { ...options, algorithms: ['HS256'] });
      return payloadToUser(payload);
    };
  }

  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { ...options, algorithms: ['ES256', 'RS256'] });
    return payloadToUser(payload);
  };
}
