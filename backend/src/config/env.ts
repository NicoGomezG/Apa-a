import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Pooler de Supabase en modo transacción (puerto 6543). Lo usa la app en ejecución.
  DATABASE_URL: z.url(),

  SUPABASE_URL: z.url(),
  // Clave secreta (sb_secret_… o service_role). Solo backend: sirve para
  // operaciones de administración de Auth, como eliminar la cuenta.
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  // Solo para proyectos que todavía firman los JWT con el secreto HS256 heredado.
  // Si no se define, los tokens se validan con las claves públicas (JWKS) del proyecto.
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),

  // Orígenes permitidos para CORS, separados por coma. En Vercel el front y la API
  // comparten dominio, así que en producción normalmente queda vacío.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    // Se informan los nombres de las variables, nunca sus valores.
    throw new Error(`Variables de entorno inválidas o faltantes: ${fields}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_SECRET_KEY es obligatoria en producción');
  }
  return parsed.data;
}
