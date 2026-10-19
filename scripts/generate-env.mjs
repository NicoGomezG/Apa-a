// Genera src/environments/environment.generated.ts a partir de variables de entorno
// (o del archivo .env de la raíz en local). Solo valores PÚBLICOS: la URL del
// proyecto Supabase y su clave publicable. Las claves secretas jamás pasan por acá.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const source = { ...readDotEnv(resolve(root, '.env')), ...process.env };
const isCi = Boolean(source.VERCEL || source.CI);

const config = {
  supabaseUrl: source.NG_APP_SUPABASE_URL ?? '',
  supabasePublishableKey: source.NG_APP_SUPABASE_PUBLISHABLE_KEY ?? '',
  apiUrl: source.NG_APP_API_URL || '/api',
  googleAuthEnabled: source.NG_APP_GOOGLE_AUTH_ENABLED === 'true',
};

if (source.VERCEL && (!config.supabaseUrl || !config.supabasePublishableKey)) {
  console.error('Faltan NG_APP_SUPABASE_URL o NG_APP_SUPABASE_PUBLISHABLE_KEY en Vercel.');
  process.exit(1);
}
if (!config.supabaseUrl && !isCi) {
  console.warn('Aviso: NG_APP_SUPABASE_URL no está definida; copia .env.example a .env y complétalo.');
}
function looksSecret(key) {
  if (key.startsWith('sb_secret_')) return true;
  // Claves heredadas: son JWT; la secreta trae role=service_role.
  const [, payload] = key.split('.');
  if (!key.startsWith('eyJ') || !payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role';
  } catch {
    return false;
  }
}

if (looksSecret(config.supabasePublishableKey)) {
  console.error('NG_APP_SUPABASE_PUBLISHABLE_KEY parece una clave SECRETA. Usa la clave publicable.');
  process.exit(1);
}

const file = resolve(root, 'src/environments/environment.generated.ts');
writeFileSync(
  file,
  `// Archivo generado por scripts/generate-env.mjs. No editar ni commitear.\n` +
    `export const environment = ${JSON.stringify(config, null, 2)} as const;\n`,
);
