import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AuthUser, TokenVerifier } from '../lib/auth/token-verifier.js';
import { unauthorized } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

/** El usuario autenticado de la request. Solo usar en rutas con `onRequest: app.authenticate`. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw unauthorized();
  return request.authUser;
}

export const authPlugin = fp(async (app: FastifyInstance, opts: { verifyToken: TokenVerifier }) => {
  app.decorateRequest('authUser', null);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw unauthorized();

    try {
      request.authUser = await opts.verifyToken(token);
    } catch (err) {
      request.log.debug({ reason: (err as Error).message }, 'token rejected');
      throw unauthorized();
    }
  });
});
