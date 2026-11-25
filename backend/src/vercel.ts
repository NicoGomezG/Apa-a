import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { createApp } from './main.js';

const PATH_PARAM = '__path';

/**
 * vercel.json reescribe `/api/:path*` hacia la función `/api?__path=:path*`, así que la
 * función puede recibir `/api?__path=me` en vez de `/api/me`. Reconstruye la ruta original
 * para que Fastify enrute bien. Si la URL ya llega intacta, la deja igual.
 */
export function restoreOriginalUrl(url: string | undefined): string {
  if (!url) return '/';
  const parsed = new URL(url, 'http://localhost');
  const path = parsed.searchParams.get(PATH_PARAM);
  if (path === null) return url;
  parsed.searchParams.delete(PATH_PARAM);
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname !== '/api') return url;
  const query = parsed.searchParams.toString();
  const cleanPath = path.replace(/^\/+/, '');
  return `/api${cleanPath ? `/${cleanPath}` : ''}${query ? `?${query}` : ''}`;
}

// Una instancia por contenedor de Vercel, reutilizada entre invocaciones.
let appPromise: Promise<FastifyInstance> | null = null;

export async function handleVercelRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  appPromise ??= createApp().then(async (app) => {
    await app.ready();
    return app;
  });
  const app = await appPromise;
  req.url = restoreOriginalUrl(req.url);
  app.server.emit('request', req, res);
}
