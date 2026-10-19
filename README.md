# Apaña

**Tu vida, más ordenada.** Una plataforma para tener bajo control finanzas, suscripciones,
agenda, personas, compras, vehículos y salud en un solo lugar.

| | Frontend (raíz) | Backend (`backend/`) |
|---|---|---|
| Stack | Angular 21 (standalone + signals), Bootstrap 5.3, ng-bootstrap, FontAwesome | Fastify 5 + Prisma 7 + Zod |
| Datos | — | Supabase Postgres, schema `app` (no expuesto por la Data API) |
| Auth | Supabase Auth (correo/contraseña, Google opcional) | Valida el JWT de Supabase en cada request |
| Hosting | Vercel (sitio estático) | Vercel Function en `/api` (`api/index.mjs`) |

Angular usa Supabase **solo para la sesión**. Todos los datos pasan por la API, que valida
quién es el dueño de cada registro.

## Puesta en marcha local (sin Docker)

Se trabaja contra un **proyecto de Supabase de desarrollo** en la nube, separado del de producción.

1. **Crea el proyecto** en [supabase.com](https://supabase.com) (región recomendada: São Paulo).
2. **Configura Auth** en Supabase → Authentication → URL Configuration:
   - Site URL: `http://localhost:4200`
   - Redirect URLs: `http://localhost:4200/auth/callback` y `http://localhost:4200/auth/nueva-clave`
3. **Variables de entorno**:
   ```bash
   cp .env.example .env                  # valores públicos del front
   cp backend/.env.example backend/.env  # secretos del backend
   ```
   Completa ambos con los datos de Supabase → Project Settings (API y Database).
4. **Instala dependencias** (Node ≥ 22.12):
   ```bash
   npm install
   npm install --prefix backend
   ```
5. **Aplica las migraciones** (crea el schema `app`; no borra nada):
   ```bash
   npm run db:migrate:deploy --prefix backend
   ```
6. **Levanta todo** en dos terminales:
   ```bash
   npm run dev:api   # API en http://localhost:8080 (Swagger en /documentation)
   npm start         # App en http://localhost:4200 (proxy de /api a la API)
   ```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Front en modo desarrollo |
| `npm test` | Pruebas del front (Vitest) |
| `npm run build` | Build de producción del front |
| `npm run dev:api` | API con recarga automática |
| `npm test --prefix backend` | Pruebas del backend |
| `npm run typecheck --prefix backend` | Typecheck del backend |
| `npm run db:migrate:deploy --prefix backend` | Aplica migraciones pendientes |
| `npm run db:migrate:status --prefix backend` | Muestra qué migraciones faltan |

### Crear una migración nueva (sin Docker)

`prisma migrate dev` necesita una base "sombra"; sin Docker, se genera el SQL comparando la
base de desarrollo con el esquema:

```bash
cd backend
mkdir prisma/migrations/<AAAAMMDDhhmmss>_<nombre>
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script \
  > prisma/migrations/<AAAAMMDDhhmmss>_<nombre>/migration.sql
# Revisa el SQL (agrega RLS a las tablas nuevas) y luego:
npm run db:migrate:deploy
```

## Despliegue en Vercel

Un solo proyecto de Vercel sirve el front y la API (`vercel.json`). Variables a definir en
Vercel → Settings → Environment Variables:

| Variable | Dónde se usa |
|---|---|
| `NG_APP_SUPABASE_URL`, `NG_APP_SUPABASE_PUBLISHABLE_KEY`, `NG_APP_GOOGLE_AUTH_ENABLED` | Build del front (públicas) |
| `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET` (opcional) | API (secretas) |
| `NODE_ENV=production` | API |

Las migraciones **no** corren en el deploy: se aplican aparte con `db:migrate:deploy`
apuntando a la base de producción. En Supabase de producción, agrega el dominio de Vercel a
Site URL y Redirect URLs.

> El plan Hobby de Vercel no permite uso comercial. Para lanzar Apaña al público se necesita Pro.

## Estado

**Fase 1 (base)**: autenticación, navegación, sistema de diseño, dashboard con estados vacíos,
perfil y preferencias, exportación y eliminación de cuenta, bitácora de auditoría.
Los módulos (Finanzas, Agenda, Personas, Compras, Vehículos, Salud) llegan en las fases siguientes.
