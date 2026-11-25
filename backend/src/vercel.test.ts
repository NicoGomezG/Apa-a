import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { ALICE, bearer, createFakeDeps, testEnv } from './test/fakes.js';
import { restoreOriginalUrl } from './vercel.js';

describe('restoreOriginalUrl (reescritura de Vercel)', () => {
  it('reconstruye la ruta desde __path', () => {
    expect(restoreOriginalUrl('/api?__path=me')).toBe('/api/me');
    expect(restoreOriginalUrl('/api?__path=me/preferences')).toBe('/api/me/preferences');
    expect(restoreOriginalUrl('/api?__path=me%2Fexport')).toBe('/api/me/export');
    expect(restoreOriginalUrl('/api/?__path=health')).toBe('/api/health');
  });

  it('conserva el resto de la query', () => {
    expect(restoreOriginalUrl('/api?__path=me&a=1&b=x%20y')).toBe('/api/me?a=1&b=x+y');
  });

  it('deja intacta una URL que ya llega con su ruta', () => {
    expect(restoreOriginalUrl('/api/me')).toBe('/api/me');
    expect(restoreOriginalUrl('/api/me?a=1')).toBe('/api/me?a=1');
    expect(restoreOriginalUrl(undefined)).toBe('/');
  });

  it('no toca __path fuera de /api', () => {
    expect(restoreOriginalUrl('/otra?__path=me')).toBe('/otra?__path=me');
  });

  it('la URL reconstruida llega a la ruta correcta', async () => {
    const fakes = createFakeDeps();
    const app = await buildApp(testEnv, fakes.deps);
    try {
      const health = await app.inject({ method: 'GET', url: restoreOriginalUrl('/api?__path=health') });
      expect(health.statusCode).toBe(200);
      const me = await app.inject({
        method: 'GET',
        url: restoreOriginalUrl('/api?__path=me'),
        headers: bearer(ALICE),
      });
      expect(me.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
