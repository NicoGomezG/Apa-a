import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { DELETE_CONFIRMATION } from './modules/account/account.routes.js';
import { ALICE, BOB, bearer, createFakeDeps, testEnv } from './test/fakes.js';

let app: FastifyInstance;
let fakes: ReturnType<typeof createFakeDeps>;

beforeEach(async () => {
  fakes = createFakeDeps();
  app = await buildApp(testEnv, fakes.deps);
});

afterEach(async () => {
  await app.close();
});

describe('autenticación', () => {
  it('responde /api/health sin sesión', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('rechaza /api/me sin token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('rechaza un token inválido', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer nope' } });
    expect(res.statusCode).toBe(401);
  });

  it('rechaza un esquema distinto de Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Basic token-${ALICE.id}` } });
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 404 con formato propio en rutas inexistentes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});

describe('perfil', () => {
  it('crea el perfil la primera vez, con preferencias de Chile, y lo audita una sola vez', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(ALICE) });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      id: ALICE.id,
      email: ALICE.email,
      displayName: 'Alice',
      preferences: { timezone: 'America/Santiago', locale: 'es-CL', currency: 'CLP' },
    });

    await app.inject({ method: 'GET', url: '/api/me', headers: bearer(ALICE) });
    expect(fakes.auditLog.filter((entry) => entry.action === 'profile.created')).toHaveLength(1);
  });

  it('cada usuario ve solo su propio perfil', async () => {
    await app.inject({ method: 'GET', url: '/api/me', headers: bearer(ALICE) });
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(BOB) });
    expect(res.json().id).toBe(BOB.id);
    expect(res.json().email).toBe(BOB.email);
    expect(res.json().displayName).toBeNull();
  });

  it('actualiza el nombre y guarda en la bitácora solo el nombre del campo', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { displayName: '  Ali  ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe('Ali');

    const entry = fakes.auditLog.find((item) => item.action === 'profile.updated');
    expect(entry?.metadata).toEqual({ fields: ['displayName'] });
    expect(JSON.stringify(entry)).not.toContain('Ali"');
  });

  it('un nombre vacío queda como null', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(ALICE), payload: { displayName: '   ' } });
    expect(res.json().displayName).toBeNull();
  });

  it('rechaza un nombre de más de 80 caracteres', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { displayName: 'x'.repeat(81) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('acepta zonas horarias IANA de Chile', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/preferences',
      headers: bearer(ALICE),
      payload: { timezone: 'America/Punta_Arenas' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().preferences.timezone).toBe('America/Punta_Arenas');
  });

  it('rechaza zonas horarias, monedas o idiomas no soportados', async () => {
    for (const payload of [{ timezone: 'Marte/Olympus' }, { currency: 'BTC' }, { locale: 'en-US' }, {}]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/me/preferences', headers: bearer(ALICE), payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});

describe('cuenta', () => {
  it('exporta los datos propios como descarga sin caché', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/export', headers: bearer(ALICE) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.profile.id).toBe(ALICE.id);
    expect(body.account.email).toBe(ALICE.email);
  });

  it('no elimina la cuenta sin la frase de confirmación exacta', async () => {
    await app.inject({ method: 'GET', url: '/api/me', headers: bearer(ALICE) });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: 'eliminar' },
    });
    expect(res.statusCode).toBe(400);
    expect(fakes.profiles.has(ALICE.id)).toBe(true);
    expect(fakes.deletedAuthUsers).toHaveLength(0);
  });

  it('elimina datos e identidad solo del usuario que lo pide', async () => {
    await app.inject({ method: 'GET', url: '/api/me', headers: bearer(ALICE) });
    await app.inject({ method: 'GET', url: '/api/me', headers: bearer(BOB) });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: DELETE_CONFIRMATION },
    });
    expect(res.statusCode).toBe(204);
    expect(fakes.profiles.has(ALICE.id)).toBe(false);
    expect(fakes.profiles.has(BOB.id)).toBe(true);
    expect(fakes.deletedAuthUsers).toEqual([ALICE.id]);
    expect(fakes.auditLog.some((entry) => entry.action === 'account.deleted' && entry.userId === ALICE.id)).toBe(true);
  });

  it('si Supabase Auth falla, informa el error y se puede reintentar', async () => {
    await app.inject({ method: 'GET', url: '/api/me', headers: bearer(ALICE) });
    fakes.setFailAuthDelete(true);
    const failed = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: DELETE_CONFIRMATION },
    });
    expect(failed.statusCode).toBe(502);
    expect(fakes.profiles.has(ALICE.id)).toBe(false);

    fakes.setFailAuthDelete(false);
    const retry = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: DELETE_CONFIRMATION },
    });
    expect(retry.statusCode).toBe(204);
    expect(fakes.deletedAuthUsers).toEqual([ALICE.id]);
  });
});
