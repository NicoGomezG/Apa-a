import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { createApp } from './main.js';

// Una instancia por contenedor de Vercel, reutilizada entre invocaciones.
let appPromise: Promise<FastifyInstance> | null = null;

export async function handleVercelRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  appPromise ??= createApp().then(async (app) => {
    await app.ready();
    return app;
  });
  const app = await appPromise;
  app.server.emit('request', req, res);
}
