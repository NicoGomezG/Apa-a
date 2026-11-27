# CLAUDE.md — Apaña

Plataforma de gestión personal (finanzas, suscripciones, agenda, personas, compras, vehículos,
salud). Ver `README.md` para stack, puesta en marcha y despliegue.

> **Este archivo se mantiene vivo.** Al terminar cada cambio (feature, fix, migración, decisión),
> actualiza las secciones afectadas: *Estado*, *Mapa del código*, *Trampas conocidas*,
> *Pendientes* y agrega una línea en *Historial*. Corto y verificable: nada que se deduzca
> leyendo el código, solo lo que ahorra tiempo o evita errores.

## Reglas de trabajo

- Rama de trabajo: **`main`**, directo (sin ramas ni PR por ahora).
- Una fase a la vez. Cambios estructurales: proponer plan y esperar OK.
- Al terminar: correr pruebas y builds de front y back, y reportar qué quedó probado y qué no.
- Nunca afirmar que algo funciona si no se probó.
- No correr migraciones contra producción ni comandos destructivos sin permiso explícito
  (las corre la persona con `! npm run db:migrate:deploy --prefix backend`).
- No hacer push si hay migraciones sin aplicar que el código nuevo necesita: rompería producción.
- Nunca commitear cartolas, estados de cuenta ni datos reales; las pruebas usan datos inventados.

## Arquitectura

- **Front** (`src/`): Angular 21 standalone + signals, Bootstrap 5.3 con tokens propios
  (`src/styles/_tokens.scss`). Supabase se usa **solo para la sesión** (`core/supabase.ts`).
- **Back** (`backend/`): Fastify 5 + Prisma 7 + Zod. Un módulo por dominio en
  `backend/src/modules/<dominio>/` (`*.repository.ts` + `*.routes.ts` + `*.types.ts`). Las
  dependencias se inyectan en `buildApp` (`app.ts`), así las pruebas usan repositorios en memoria
  (`src/test/fakes.ts`, `src/test/fake-people.ts`). `main.ts` arma las reales.
- **Vercel**: `api/index.mjs` → `backend/dist/vercel.js`. Rutas de la API con prefijo `/api`.
  `vercel.json` reescribe `/api/:path*` → `/api?__path=…` y `vercel.ts` restaura la URL original.
- **Base**: Supabase Postgres, schema `app`. Host del pooler: `aws-1-us-west-2.pooler.supabase.com`
  (6543 = app/`DATABASE_URL`, 5432 = migraciones/`DIRECT_URL`).

## Seguridad (no negociable)

- Toda tabla nueva vive en el schema `app`, con `ENABLE ROW LEVEL SECURITY` en su migración
  (más el bloque `REVOKE` para `anon`/`authenticated`, copiar de una migración existente).
- Toda consulta filtra por `userId` tomado de `currentUser(request)`, **nunca** de un parámetro
  del cliente. Cada endpoint nuevo lleva una prueba de que el usuario B no ve lo del A.
- Única excepción sin sesión: `GET /api/public/splits/:token` (enlace de invitados, código de
  192 bits, revocable, sin datos de contacto). Cualquier ruta pública nueva necesita el mismo cuidado.
- Excepciones al filtro por dueño: `/api/people/shared/*` (grupos de otro donde el dueño te
  enlazó como amigo). Filtra por `split_participants.linked_user_id = currentUser`, nunca expone
  `contactId`, `shareToken` ni ids de cuenta, y solo deja informar pagos propios (`confirmed=false`).
  Y `/api/chats/*`: amigos (clave de la conversación armada con `currentUser` + amigo; escribir exige
  amistad vigente) y grupos (dueño o `linked_user_id`). Los mensajes nunca llevan `authorId`.
- Amigos: solo ven nombre y cumpleaños (día y mes) del otro. Nunca correo, año ni otros módulos.
- Dinero: `BigInt` en unidad mínima + `currency`. Nunca `Float`/`number` con decimales.
- Fechas: `timestamptz` para instantes, `date` para días; zona por defecto `America/Santiago`.
- La bitácora (`AuditRepository.record`) guarda acciones e identificadores, **nunca** valores
  personales, financieros ni médicos (hay pruebas que lo verifican por módulo).
- Secretos solo en `backend/.env` / Vercel. El front solo conoce la clave **publicable**.
- Al agregar un módulo con datos: sumarlo a `AccountRepository.deleteAllData` y a `/me/export`.
- Archivos (boletas, documentos): subida directa a Supabase Storage con URL firmada; nunca a
  través de la función (límite de payload de Vercel ~4,5 MB). Las cartolas se leen en el
  navegador y **no** se guardan: solo los datos.

## Diseño

- Español de Chile, tuteo estándar. Formatos: `core/format/format.ts` (CLP, fechas por zona).
- Base monocromática estilo shadcn/ui (tokens en `_tokens.scss`): canvas `#f5f5f5`, tarjetas
  blancas con hairline `#e5e5e5` + sombra sutil, barra lateral `#fafafa`, acción principal negra
  (`btn-primary` = `#171717`), `btn-outline-primary` = borde hairline, inputs con relleno gris.
  Tipografía Geist (`@fontsource-variable/geist`), cuerpo 14px, títulos peso 600 con tracking negativo.
- Radios: 18px botones/inputs/badges, 24px tarjetas/modales, 10px anidados, 6px pequeños.
- Texto secundario = `$apana-ink-soft` (`#525252`); nunca más claro que `$apana-mid` (`#737373`,
  solo placeholders).
- Color solo como acento: cada módulo tiene el suyo (`$apana-modules`, CSS `--apana-module-<clave>`)
  para íconos, avatares y detalles pequeños; pestañas/toggles activos van en negro. Verde/rojo solo
  para estados. Sin degradados.
- Responsivo siempre: móvil (barra inferior), tablet, escritorio (barra lateral).
- Estados vacíos honestos: nunca cifras de ejemplo en el dashboard.
- Rojo de domingos/feriados = `--bs-danger` (`#e7000b`, también destructivo/errores).

## Estado (actualizar al cerrar cada cambio)

| Módulo | Estado | Dónde |
|---|---|---|
| Base (auth, perfil, export, borrar cuenta, bitácora) | ✅ | `modules/profile`, `account`, `audit` |
| Finanzas: cuentas, movimientos, cuotas, estados de cuenta, suscripciones (correo + notas), resumen, importación BCh/CMR/Santander | ✅ | `modules/finance`, `features/finanzas` |
| Agenda: calendario, feriados CL, pagos del mes con estado pagado/por pagar/sin confirmar, cumpleaños | ✅ | `features/agenda`, `core/calendar`, `GET /finance/calendar` |
| Personas: contactos + cumpleaños, gastos compartidos (iguales / montos / ítems de boleta, propina 10 %), saldos, pagos, enlace invitados | ✅ (sin probar en navegador) | `modules/people`, `features/personas`, `features/public` |
| Personas etapa 3: amigos (invitación por enlace o QR), cumpleaños propio, grupos compartidos con amigos (ven, informan pagos, el dueño confirma, recordatorio) | ✅ (sin probar en navegador) | `modules/friends`, `people.shared.routes.ts`, `features/personas/amigos.ts`, `compartido-conmigo.ts`, `unirse.ts` |
| Finanzas → Deudas: me deben / debo, con abonos, días sin pagar y fecha de pago | ✅ (sin probar en navegador; migración pendiente) | `modules/debts` (`/finance/debts`), `features/finanzas/deudas.*` |
| Chat: entre amigos (ex amigos = solo lectura) y por grupo de gastos, no leídos en la navegación | ✅ (sin probar en navegador; migración pendiente) | `modules/chat`, `features/personas/chat-thread.ts`, `mensajes.ts`, `chat.service.ts` |
| Compras, Vehículos, Salud | ⏳ | `layout/navigation.ts` → `UPCOMING_MODULES` |

## Mapa del código (lo que no es obvio)

- Lectores de cartolas: `src/app/features/finanzas/import/` (un archivo por banco; PDF con
  pdfjs-dist 6 lazy, Excel con SheetJS desde el CDN). Dedupe por SHA-256 en `movementKeys`/`planKey`.
- Regla de cuotas: última cuota = total − (N−1)×cuota salvo que el banco informe la N/N
  (`lastInstallmentAmount`). Mes de la cuota n = mes del vencimiento del estado de cuenta.
- Gasto del mes = `expense` por fecha + cuotas que vencen ese mes. `transfer` y `card_payment` no son gasto.
- Gasto base: las suscripciones en USD/EUR se suman convertidas a CLP con el dólar/euro observado
  (`lib/exchange-rates.ts`, API pública mindicador.cl, caché 6 h, timeout 3 s; si cae, usa el último
  valor o deja la suscripción fuera del total y lo dice). Tipo de cambio como entero ×1e6, nunca float.
  Solo cuando la moneda principal es CLP; los meses siguientes usan el valor de hoy. El mismo valor se
  muestra en el apartado "Tipo de cambio" (`features/finanzas/tipo-cambio.ts`, al final del Resumen).
- Reparto de gastos: `backend/src/modules/people/split.math.ts` es la fuente de verdad. Hay una
  **copia** en `src/app/features/personas/split.math.ts` para la vista previa: si cambias uno,
  cambia el otro (las pruebas de ambos usan los mismos casos).
- Feriados: `core/calendar/holidays-cl.ts` (por ley; solsticio tabulado 2021–2035). No incluye
  regionales ni de elecciones.
- Esquemas Zod compartidos (dinero, día, texto, correo): `backend/src/lib/schemas.ts`.
- Lista base de tarjetas/cuentas (CMR, Santander, MACH…): `ACCOUNT_PRESETS` en `finance.models.ts`.
- Amistades: una fila por par con `user_a_id < user_b_id` (`orderedPair`, con CHECK en la base).
  Terminar la amistad o borrar la cuenta deshace `linked_user_id` y `friend_user_id` en ambos sentidos.
- Pagos informados por amigos: `split_settlements.confirmed=false`; `groupView` los excluye de saldos
  y el enlace público no los muestra. Recordatorio = `split_participants.reminded_at` (1 cada 20 h).
- Cumpleaños de Agenda/Inicio: `PeopleService.birthdayPeople()` junta contactos + amigos sin duplicar
  (`features/personas/friends.ts`). Validación compartida del cumpleaños: `backend/src/lib/birthday.ts`.
- Deudas: saldo, estado y `paidAt` se derivan de los abonos (`debtView` en `debts.routes.ts`), no se
  guardan. Días sin pagar = hoy − (último abono ?? fecha de la deuda), calculado en el front. El nombre
  de la persona se guarda aunque venga de un contacto (si se borra el contacto, `contact_id` queda null).
- Chat: `thread_key` = `friend:<a>:<b>` (par ordenado) o `group:<id>` (CHECK en la base). Sin tiempo
  real: el front pregunta cada 4 s con la conversación abierta (`?after=`, inclusive, se dedupe por id),
  15 s en la lista y 30 s para el contador (`ChatService.watchUnread`, en el Shell). Responder marca
  como leído. Los mensajes de grupo caen con el grupo (FK cascade); la bitácora no guarda el texto.
- QR de invitación: `qrcode` (carga diferida) genera la imagen en el navegador; nunca usar un servicio
  externo de QR (el enlace es un código de un solo uso). `qrcode`/`dijkstrajs` van en `allowedCommonJsDependencies`.
- Destino tras registrarse/Google: `core/auth/pending-redirect.ts` (localStorage), lo usa `auth-callback`.
  Registro sin confirmar correo ("Confirm email" apagado en Supabase): `signUp` trae sesión y `register.ts`
  navega directo al destino; si no trae sesión (correo ya registrado) muestra "revisa tu correo".
- Contraseña: solo se cambia desde el enlace del correo. `AuthService.recovering` se activa con el evento
  `PASSWORD_RECOVERY` (sessionStorage) y `updatePassword` lo exige; Perfil solo envía el enlace.
  El bloqueo real del lado servidor es "Secure password change" en el panel de Supabase.
- Config de Auth (Site URL, Redirect URLs, confirmación, plantillas de correo) vive solo en el panel de
  Supabase, no en el repo. Site URL = dominio de producción; si un `emailRedirectTo` no está en la lista
  de Redirect URLs, Supabase cae al Site URL.

## Trampas conocidas

- **Plantillas Angular no aceptan literales BigInt** (`0n`): usar un helper (`sign(x) > 0`).
- Variables vacías en `.env` (`CLAVE=`) cuentan como no definidas (`config/env.ts`).
- `prisma migrate dev` no sirve sin Docker: generar SQL con `prisma migrate diff` (ver README),
  agregar RLS a mano, y revisar que no haya `DROP`.
- En Windows no hay `python`; para ediciones con scripts usar `node`.
- `NODE_ENV=production` en Vercel hacía que `npm ci` omitiera devDependencies (`ng: command not found`).
  Por eso `installCommand` usa `--include=dev`. No hace falta definir `NODE_ENV` en Vercel.
- La API exige `SUPABASE_SECRET_KEY` cuando `NODE_ENV=production`: sin ella la función se cae al
  arrancar (`FUNCTION_INVOCATION_FAILED` hasta en `/api/health`).
- El `tsconfig` del backend excluye `*.test.ts`: el typecheck no revisa las pruebas (vitest sí).
- `prisma migrate diff --from-config-datasource` compara con la base real (que puede ir atrasada).
  Para generar solo lo nuevo: copiar el schema antes de editarlo y usar `--from-schema <copia>`.
- `await import()` de un paquete CommonJS (`qrcode`) en el bundle solo trae `default`: los nombres
  sueltos (`const { toDataURL } = …`) llegan `undefined`. Usar `(mod.default ?? mod).fn`.
- npm 11 bloquea scripts de instalación: tras `npm ci` en `backend`, correr `npx prisma generate`.
- Tras cambiar `schema.prisma` (o hacer pull de un cambio): `npx prisma generate` en `backend` y reiniciar
  `dev:api`. Síntoma de cliente viejo: `Unknown field … for select` o `prisma.<modelo>` undefined.

## Pendientes

- Aplicar la migración `20261129000000_debts`, luego push (la del chat ya está aplicada).
- Panel de Supabase → Auth: apagar "Confirm email", Site URL = dominio de producción, agregar
  `<dominio>/auth/callback` y `<dominio>/auth/nueva-clave` a Redirect URLs, plantillas en español,
  activar "Secure password change".
- Probar el chat en navegador con dos cuentas (amigos y grupo, móvil y escritorio).
- Chat, después: aviso push/correo, borrar mensajes propios, Supabase Realtime si el sondeo queda corto.
- Probar en navegador: importación (worker de pdf.js), Agenda, Personas, el enlace público y
  amigos (invitar → aceptar con otra cuenta, incluido registro nuevo desde el enlace).
- Revisar en navegador el rediseño monocromático (todas las pantallas, móvil y escritorio).
- Recordatorios solo dentro de la app: falta aviso por correo/push.
- `SUPABASE_SECRET_KEY` vacía en `backend/.env` (sin ella no funciona eliminar cuenta; obligatoria en producción).
- Ideas acordadas para después: marcar pagos como "revisado" a mano, foto de boleta con IA,
  propina con porcentaje elegible.

## Historial (más reciente arriba, una línea por cambio)

- 2026-11-27 · Perfil: la contraseña solo se cambia con el enlace del correo.
- 2026-11-27 · Amigos: un solo enlace de invitación a la vista (reusa el sin usar; "Crear otro enlace" y anular anteriores).
- 2026-11-27 · Registro entra directo si Supabase no exige confirmar correo (invitados van al tiro a aceptar).
- 2026-11-27 · Fix QR de invitación: el import diferido de `qrcode` solo trae `default`.
- 2026-11-27 · Celular: invitaciones con botones bajo el enlace, chat al alto de la pantalla, gasto base sin scroll.
- 2026-11-27 · Finanzas → Deudas: quién me debe y a quién le debo, con abonos y días sin pagar.
- 2026-11-27 · Finanzas → Resumen: apartado "Tipo de cambio" (dólar y euro observados con variación), `GET /finance/exchange-rates`.
- 2026-11-27 · Gasto base suma suscripciones en USD/EUR convertidas al dólar/euro observado.
- 2026-11-26 · Chat entre amigos y por grupo de gastos (sondeo, no leídos, exportación y borrado de cuenta).
- 2026-11-26 · Amigos: QR de la invitación (generado en el navegador).
- 2026-11-26 · Rediseño monocromático (DESIGN.md estilo shadcn/ui, híbrido con colores de módulo), fuente Geist.
- 2026-11-25 · Amigos: invitación por enlace, cumpleaños propio compartido, grupos compartidos con pagos por confirmar y recordatorio.
- 2026-11-26 · Personas: contactos/cumpleaños, gastos compartidos estilo Tricount, enlace invitados.
- 2026-11-25 · Suscripciones con correo y notas; lista base de tarjetas; fix variables `.env` vacías.
- 2026-11-25 · Agenda: calendario con feriados CL y pagos del mes cruzados con movimientos.
- 2026-11-25 · Finanzas completa + importación de cartolas; fix "Route GET not found" en Vercel.
- 2026-10-18 · Fase 1: base de Apaña.

## Comandos

```bash
npm start / npm test / npm run build          # front
npm run dev:api                               # back en local (puerto 8080)
cd backend && npm test && npm run typecheck   # back
npm run db:migrate:status --prefix backend    # qué migraciones faltan
```
