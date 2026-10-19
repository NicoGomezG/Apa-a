import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// El CLI de Prisma (migraciones) usa la conexión DIRECTA de Supabase (puerto 5432):
// el pooler en modo transacción (6543) no sirve para migrar.
// La app en ejecución usa DATABASE_URL (pooler), ver src/lib/prisma.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DIRECT_URL'] ?? '',
  },
});
