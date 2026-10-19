# CLAUDE.md — Apaña

Plataforma de gestión personal (finanzas, suscripciones, agenda, personas, compras, vehículos,
salud). Ver `README.md` para stack, puesta en marcha y despliegue.

## Reglas de trabajo

- Rama de trabajo: **`main`**, directo (sin ramas ni PR por ahora).
- Una fase a la vez. Cambios estructurales: proponer plan y esperar OK.
- Al terminar: correr pruebas y builds de front y back, y reportar qué quedó probado y qué no.
- Nunca afirmar que algo funciona si no se probó.
- No correr migraciones contra producción ni comandos destructivos sin permiso explícito.

## Arquitectura

- **Front** (`src/`): Angular 21 standalone + signals, Bootstrap 5.3 con tokens propios
  (`src/styles/_tokens.scss`). Supabase se usa **solo para la sesión** (`core/supabase.ts`).
- **Back** (`backend/`): Fastify 5 + Prisma 7 + Zod. Un módulo por dominio en
  `backend/src/modules/<dominio>/` (`*.repository.ts` + `*.routes.ts`). Las dependencias se
  inyectan en `buildApp` (`app.ts`), así las pruebas usan repositorios en memoria
  (`src/test/fakes.ts`). `main.ts` arma las reales.
- **Vercel**: `api/index.mjs` → `backend/dist/vercel.js`. Rutas de la API con prefijo `/api`.

## Seguridad (no negociable)

- Toda tabla nueva vive en el schema `app`, con `ENABLE ROW LEVEL SECURITY` en su migración.
- Toda consulta filtra por `userId` tomado de `currentUser(request)`, **nunca** de un parámetro
  del cliente. Cada endpoint nuevo lleva una prueba de que el usuario B no ve lo del A.
- Dinero: `BigInt` en unidad mínima + `currency`. Nunca `Float`/`number` con decimales.
- Fechas: `timestamptz` para instantes, `date` para días; zona por defecto `America/Santiago`.
- La bitácora (`AuditRepository.record`) guarda acciones e identificadores, **nunca** valores
  personales, financieros ni médicos.
- Secretos solo en `backend/.env` / Vercel. El front solo conoce la clave **publicable**.
- Al agregar un módulo con datos: sumarlo a `AccountRepository.deleteAllData` y a `/me/export`.
- Archivos (boletas, documentos): subida directa a Supabase Storage con URL firmada; nunca a
  través de la función (límite de payload de Vercel ~4,5 MB).

## Diseño

- Español de Chile, tuteo estándar. Formatos: `core/format/format.ts` (CLP, fechas por zona).
- Sin texto gris: el secundario usa `$apana-ink-soft`. Cada módulo tiene su color
  (`$apana-modules`). Sin degradados.
- Responsivo siempre: móvil (barra inferior), tablet, escritorio (barra lateral).
- Estados vacíos honestos: nunca cifras de ejemplo en el dashboard.

## Comandos

```bash
npm start / npm test / npm run build          # front
npm run dev:api                               # back en local
cd backend && npm test && npm run typecheck   # back
```
