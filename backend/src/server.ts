import 'dotenv/config';
import { createApp } from './main.js';

// Servidor local de desarrollo. En Vercel el punto de entrada es api/index.mjs.
const app = await createApp();
const port = Number(process.env['PORT'] ?? 8080);

try {
  await app.listen({ port, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
