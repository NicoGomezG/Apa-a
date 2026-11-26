import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditRepository } from '../audit/audit.repository.js';
import { ensureProfile } from '../profile/profile.routes.js';
import type { ProfileRepository } from '../profile/profile.repository.js';
import {
  addDays,
  firstDayOf,
  firstDueMonthFrom,
  installmentAmountFor,
  isValidDay,
  lastDayOf,
  MONTH_RE,
  monthDiff,
  monthOf,
  todayIn,
  addMonths,
} from './finance.dates.js';
import type { FinanceRepository, ImportBatch } from './finance.repository.js';
import { calendarTransactionRange, computeCalendar } from './finance.calendar.js';
import { computeSummary } from './finance.summary.js';
import {
  ACCOUNT_KINDS,
  CATEGORIES,
  FREQUENCIES,
  type InstallmentPlanRecord,
  SUPPORTED_CURRENCIES,
  TRANSACTION_KINDS,
} from './finance.types.js';

export interface FinanceRoutesDeps {
  finance: FinanceRepository;
  profiles: ProfileRepository;
  audit: AuditRepository;
  /** Reloj inyectable para pruebas. */
  now?: () => Date;
}

// --- Esquemas -----------------------------------------------------------------

const MAX_MINOR_UNITS = 10n ** 15n;

/** Dinero en unidad mínima: string de dígitos o entero seguro. Nunca decimales. */
const money = z
  .union([z.string().regex(/^-?\d{1,16}$/), z.number().int().refine(Number.isSafeInteger)])
  .transform((value) => BigInt(value))
  .refine((value) => value < MAX_MINOR_UNITS && value > -MAX_MINOR_UNITS, 'Monto fuera de rango');

const positiveMoney = money.refine((value) => value > 0n, 'Debe ser mayor que cero');
const nonNegativeMoney = money.refine((value) => value >= 0n, 'No puede ser negativo');
const nonZeroMoney = money.refine((value) => value !== 0n, 'No puede ser cero');

const day = z.string().refine(isValidDay, 'Fecha inválida');
const month = z.string().regex(MONTH_RE, 'Mes inválido');
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
const category = z.enum(CATEGORIES).nullable().optional();
const dayOfMonth = z.number().int().min(1).max(31).nullable().optional();
const idParams = z.object({ id: z.uuid() });

const nonEmpty = (body: object) => Object.values(body).some((value) => value !== undefined);

const accountFields = {
  name: text(80),
  kind: z.enum(ACCOUNT_KINDS),
  institution: optionalText(60),
  last4: z
    .string()
    .regex(/^\d{4}$/, 'Usa solo los últimos 4 dígitos')
    .nullable()
    .optional(),
  creditLimit: nonNegativeMoney.nullable().optional(),
  billingDay: dayOfMonth,
  paymentDay: dayOfMonth,
};
const createAccountBody = z.object({ ...accountFields, currency: z.enum(SUPPORTED_CURRENCIES).default('CLP') });
const updateAccountBody = z.object(accountFields).partial().refine(nonEmpty, 'Sin cambios');

const transactionFields = {
  date: day,
  description: text(200),
  amount: nonZeroMoney,
  kind: z.enum(TRANSACTION_KINDS),
  category,
};
const createTransactionBody = z.object({ accountId: z.uuid(), ...transactionFields });
const updateTransactionBody = z.object(transactionFields).partial().refine(nonEmpty, 'Sin cambios');
const transactionQuery = z.object({ month: month.optional(), accountId: z.uuid().optional() });

const updatePlanBody = z
  .object({ description: text(200).optional(), category })
  .refine(nonEmpty, 'Sin cambios');

const subscriptionFields = {
  name: text(80),
  amount: positiveMoney,
  currency: z.enum(SUPPORTED_CURRENCIES).default('CLP'),
  frequency: z.enum(FREQUENCIES),
  startDate: day,
  accountId: z.uuid().nullable().optional(),
  category,
  active: z.boolean().default(true),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((value) => (value === '' ? null : value.toLowerCase()))
    .refine((value) => value === null || z.email().safeParse(value).success, 'Correo inválido')
    .nullable()
    .optional(),
  notes: optionalText(500),
};
const createSubscriptionBody = z.object(subscriptionFields);
const updateSubscriptionBody = z
  .object({
    name: subscriptionFields.name,
    amount: subscriptionFields.amount,
    currency: z.enum(SUPPORTED_CURRENCIES),
    frequency: subscriptionFields.frequency,
    startDate: subscriptionFields.startDate,
    accountId: subscriptionFields.accountId,
    category,
    active: z.boolean(),
    email: subscriptionFields.email,
    notes: subscriptionFields.notes,
  })
  .partial()
  .refine(nonEmpty, 'Sin cambios');

export const IMPORT_LIMITS = { movements: 3000, installments: 500 } as const;

const importBody = z.object({
  accountId: z.uuid(),
  movements: z
    .array(z.object({ ...transactionFields }))
    .max(IMPORT_LIMITS.movements)
    .default([]),
  installments: z
    .array(
      z
        .object({
          description: text(200),
          purchaseDate: day,
          originalAmount: positiveMoney,
          totalAmount: positiveMoney,
          installmentCount: z.number().int().min(1).max(72),
          installmentAmount: positiveMoney,
          /** Número de la cuota que figura en el estado de cuenta… */
          currentNumber: z.number().int().min(1).max(72),
          /** …y el mes en que esa cuota se paga. */
          currentDueMonth: month,
          category,
        })
        .refine((item) => item.currentNumber <= item.installmentCount, 'Cuota fuera de rango'),
    )
    .max(IMPORT_LIMITS.installments)
    .default([]),
  statement: z
    .object({
      periodStart: day,
      periodEnd: day,
      dueDate: day,
      totalBilled: money,
      minimumPayment: nonNegativeMoney,
    })
    .refine((s) => s.periodStart <= s.periodEnd && s.periodEnd <= s.dueDate, 'Fechas del estado de cuenta inconsistentes')
    .nullable()
    .optional(),
});

const summaryQuery = z.object({ month: month.optional() });

// --- Utilidades ----------------------------------------------------------------

/** Convierte BigInt → string (JSON no soporta BigInt). */
export function toJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  }
  return value;
}

export function normalizeDescription(description: string): string {
  return description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Huella de cada movimiento importado. Dos movimientos idénticos el mismo día
 * (ej. dos pasajes de metro) se distinguen por su orden de aparición en el archivo,
 * así reimportar la misma cartola no los duplica ni los pierde.
 */
export function movementKeys(movements: { date: string; amount: bigint; description: string }[]): string[] {
  const seen = new Map<string, number>();
  return movements.map((movement) => {
    const base = `${movement.date}|${movement.amount}|${normalizeDescription(movement.description)}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return sha256(`${base}|${occurrence}`);
  });
}

export function planKey(plan: { purchaseDate: string; description: string; totalAmount: bigint; installmentCount: number }) {
  return sha256(
    `${plan.purchaseDate}|${normalizeDescription(plan.description)}|${plan.totalAmount}|${plan.installmentCount}`,
  );
}

/** Estado de una compra en cuotas respecto del mes actual. */
function planStatus(plan: InstallmentPlanRecord, currentMonth: string) {
  const elapsed = monthDiff(plan.firstDueMonth, currentMonth);
  const paidCount = Math.min(Math.max(elapsed, 0), plan.installmentCount);
  let remaining = 0n;
  for (let number = paidCount + 1; number <= plan.installmentCount; number += 1) {
    remaining += installmentAmountFor(plan, number);
  }
  const nextNumber = paidCount + 1;
  const next =
    nextNumber <= plan.installmentCount
      ? {
          number: nextNumber,
          month: addMonths(plan.firstDueMonth, nextNumber - 1),
          amount: installmentAmountFor(plan, nextNumber),
        }
      : null;
  const lastMonth = addMonths(plan.firstDueMonth, plan.installmentCount - 1);
  return { paidCount, remaining, next, lastMonth, finished: next === null };
}

// --- Rutas ---------------------------------------------------------------------

export const financeRoutes: FastifyPluginAsyncZod<FinanceRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);
  const now = deps.now ?? (() => new Date());

  const today = async (request: Parameters<typeof currentUser>[0]) => {
    const user = currentUser(request);
    const profile = await ensureProfile(deps, user);
    return { user, profile, today: todayIn(profile.preferences.timezone, now()) };
  };

  const requireAccount = async (userId: string, accountId: string) => {
    const account = await deps.finance.findAccount(userId, accountId);
    if (!account) throw notFound('No encontramos esa cuenta');
    return account;
  };

  // --- Cuentas ----------------------------------------------------------------
  app.get('/accounts', async (request) => {
    const user = currentUser(request);
    return toJson(await deps.finance.listAccounts(user.id));
  });

  app.post('/accounts', { schema: { body: createAccountBody } }, async (request, reply) => {
    const user = currentUser(request);
    const body = request.body;
    const account = await deps.finance.createAccount(user.id, {
      name: body.name,
      kind: body.kind,
      institution: body.institution ?? null,
      last4: body.last4 ?? null,
      currency: body.currency,
      creditLimit: body.creditLimit ?? null,
      billingDay: body.billingDay ?? null,
      paymentDay: body.paymentDay ?? null,
    });
    await deps.audit.record({
      userId: user.id,
      action: 'finance.account.created',
      entityType: 'financial_account',
      entityId: account.id,
    });
    return reply.status(201).send(toJson(account));
  });

  app.patch('/accounts/:id', { schema: { params: idParams, body: updateAccountBody } }, async (request) => {
    const user = currentUser(request);
    const account = await deps.finance.updateAccount(user.id, request.params.id, request.body);
    if (!account) throw notFound('No encontramos esa cuenta');
    await deps.audit.record({
      userId: user.id,
      action: 'finance.account.updated',
      entityType: 'financial_account',
      entityId: account.id,
      metadata: { fields: Object.keys(request.body) },
    });
    return toJson(account);
  });

  app.delete('/accounts/:id', { schema: { params: idParams } }, async (request, reply) => {
    const user = currentUser(request);
    const deleted = await deps.finance.deleteAccount(user.id, request.params.id);
    if (!deleted) throw notFound('No encontramos esa cuenta');
    await deps.audit.record({
      userId: user.id,
      action: 'finance.account.deleted',
      entityType: 'financial_account',
      entityId: request.params.id,
    });
    return reply.status(204).send();
  });

  // --- Movimientos -------------------------------------------------------------
  app.get('/transactions', { schema: { querystring: transactionQuery } }, async (request) => {
    const { user, today: todayDay } = await today(request);
    const target = request.query.month ?? monthOf(todayDay);
    const transactions = await deps.finance.listTransactions(user.id, {
      from: firstDayOf(target),
      to: lastDayOf(target),
      accountId: request.query.accountId,
    });
    return toJson({ month: target, transactions });
  });

  app.post('/transactions', { schema: { body: createTransactionBody } }, async (request, reply) => {
    const user = currentUser(request);
    const account = await requireAccount(user.id, request.body.accountId);
    const transaction = await deps.finance.createTransaction(user.id, {
      ...request.body,
      category: request.body.category ?? null,
      currency: account.currency,
    });
    await deps.audit.record({
      userId: user.id,
      action: 'finance.transaction.created',
      entityType: 'transaction',
      entityId: transaction.id,
    });
    return reply.status(201).send(toJson(transaction));
  });

  app.patch('/transactions/:id', { schema: { params: idParams, body: updateTransactionBody } }, async (request) => {
    const user = currentUser(request);
    const transaction = await deps.finance.updateTransaction(user.id, request.params.id, request.body);
    if (!transaction) throw notFound('No encontramos ese movimiento');
    await deps.audit.record({
      userId: user.id,
      action: 'finance.transaction.updated',
      entityType: 'transaction',
      entityId: transaction.id,
      metadata: { fields: Object.keys(request.body) },
    });
    return toJson(transaction);
  });

  app.delete('/transactions/:id', { schema: { params: idParams } }, async (request, reply) => {
    const user = currentUser(request);
    const deleted = await deps.finance.deleteTransaction(user.id, request.params.id);
    if (!deleted) throw notFound('No encontramos ese movimiento');
    await deps.audit.record({
      userId: user.id,
      action: 'finance.transaction.deleted',
      entityType: 'transaction',
      entityId: request.params.id,
    });
    return reply.status(204).send();
  });

  // --- Compras en cuotas ---------------------------------------------------------
  app.get('/installments', async (request) => {
    const { user, today: todayDay } = await today(request);
    const plans = await deps.finance.listInstallmentPlans(user.id);
    const currentMonth = monthOf(todayDay);
    return toJson(plans.map((plan) => ({ ...plan, status: planStatus(plan, currentMonth) })));
  });

  app.patch('/installments/:id', { schema: { params: idParams, body: updatePlanBody } }, async (request) => {
    const { user, today: todayDay } = await today(request);
    const plan = await deps.finance.updateInstallmentPlan(user.id, request.params.id, request.body);
    if (!plan) throw notFound('No encontramos esa compra en cuotas');
    await deps.audit.record({
      userId: user.id,
      action: 'finance.installment.updated',
      entityType: 'installment_plan',
      entityId: plan.id,
      metadata: { fields: Object.keys(request.body) },
    });
    return toJson({ ...plan, status: planStatus(plan, monthOf(todayDay)) });
  });

  app.delete('/installments/:id', { schema: { params: idParams } }, async (request, reply) => {
    const user = currentUser(request);
    const deleted = await deps.finance.deleteInstallmentPlan(user.id, request.params.id);
    if (!deleted) throw notFound('No encontramos esa compra en cuotas');
    await deps.audit.record({
      userId: user.id,
      action: 'finance.installment.deleted',
      entityType: 'installment_plan',
      entityId: request.params.id,
    });
    return reply.status(204).send();
  });

  // --- Suscripciones -------------------------------------------------------------
  app.get('/subscriptions', async (request) => {
    const user = currentUser(request);
    return toJson(await deps.finance.listSubscriptions(user.id));
  });

  app.post('/subscriptions', { schema: { body: createSubscriptionBody } }, async (request, reply) => {
    const user = currentUser(request);
    const body = request.body;
    if (body.accountId) await requireAccount(user.id, body.accountId);
    const subscription = await deps.finance.createSubscription(user.id, {
      ...body,
      accountId: body.accountId ?? null,
      category: body.category ?? 'suscripciones',
      email: body.email ?? null,
      notes: body.notes ?? null,
    });
    await deps.audit.record({
      userId: user.id,
      action: 'finance.subscription.created',
      entityType: 'subscription',
      entityId: subscription.id,
    });
    return reply.status(201).send(toJson(subscription));
  });

  app.patch(
    '/subscriptions/:id',
    { schema: { params: idParams, body: updateSubscriptionBody } },
    async (request) => {
      const user = currentUser(request);
      if (request.body.accountId) await requireAccount(user.id, request.body.accountId);
      const subscription = await deps.finance.updateSubscription(user.id, request.params.id, request.body);
      if (!subscription) throw notFound('No encontramos esa suscripción');
      await deps.audit.record({
        userId: user.id,
        action: 'finance.subscription.updated',
        entityType: 'subscription',
        entityId: subscription.id,
        metadata: { fields: Object.keys(request.body) },
      });
      return toJson(subscription);
    },
  );

  app.delete('/subscriptions/:id', { schema: { params: idParams } }, async (request, reply) => {
    const user = currentUser(request);
    const deleted = await deps.finance.deleteSubscription(user.id, request.params.id);
    if (!deleted) throw notFound('No encontramos esa suscripción');
    await deps.audit.record({
      userId: user.id,
      action: 'finance.subscription.deleted',
      entityType: 'subscription',
      entityId: request.params.id,
    });
    return reply.status(204).send();
  });

  // --- Importación de cartolas y estados de cuenta --------------------------------
  // El archivo se lee en el navegador; aquí solo llegan los datos ya extraídos.
  app.post(
    '/imports',
    { schema: { body: importBody }, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request) => {
      const user = currentUser(request);
      const body = request.body;
      const account = await requireAccount(user.id, body.accountId);
      if (body.statement && account.kind !== 'credit_card') {
        throw badRequest('Los estados de cuenta solo se pueden importar en una tarjeta de crédito');
      }

      const keys = movementKeys(body.movements);
      const batch: ImportBatch = {
        transactions: body.movements.map((movement, index) => ({
          ...movement,
          accountId: account.id,
          currency: account.currency,
          category: movement.category ?? null,
          dedupeKey: keys[index]!,
        })),
        plans: body.installments.map((item) => ({
          accountId: account.id,
          description: item.description,
          purchaseDate: item.purchaseDate,
          originalAmount: item.originalAmount,
          totalAmount: item.totalAmount,
          installmentCount: item.installmentCount,
          installmentAmount: item.installmentAmount,
          // Si este estado de cuenta trae la última cuota, su valor es el que cobró el banco.
          lastInstallmentAmount: item.currentNumber === item.installmentCount ? item.installmentAmount : null,
          firstDueMonth: firstDueMonthFrom(item.currentDueMonth, item.currentNumber),
          currency: account.currency,
          category: item.category ?? null,
          dedupeKey: planKey(item),
        })),
        statement: body.statement ? { ...body.statement, accountId: account.id, currency: account.currency } : null,
      };

      const result = await deps.finance.importBatch(user.id, account.id, batch);

      // El primer estado de cuenta enseña el ciclo de la tarjeta (día de cierre y de pago).
      if (body.statement && (account.billingDay === null || account.paymentDay === null)) {
        await deps.finance.updateAccount(user.id, account.id, {
          billingDay: account.billingDay ?? Number(body.statement.periodEnd.slice(8, 10)),
          paymentDay: account.paymentDay ?? Number(body.statement.dueDate.slice(8, 10)),
        });
      }

      await deps.audit.record({
        userId: user.id,
        action: 'finance.import.completed',
        entityType: 'financial_account',
        entityId: account.id,
        // Solo conteos: nunca montos ni descripciones.
        metadata: {
          transactionsCreated: result.transactionsCreated,
          transactionsSkipped: result.transactionsSkipped,
          plansCreated: result.plansCreated,
          statement: result.statement ?? 'none',
        },
      });
      return result;
    },
  );

  // --- Resumen ----------------------------------------------------------------------
  app.get('/summary', { schema: { querystring: summaryQuery } }, async (request) => {
    const { user, profile, today: todayDay } = await today(request);
    const target = request.query.month ?? monthOf(todayDay);

    // Rango que cubre el mes pedido y los ciclos abiertos de las tarjetas (±40 días de hoy).
    const from = [firstDayOf(target), addDays(todayDay, -40)].sort()[0]!;
    const to = [lastDayOf(target), addDays(todayDay, 40)].sort()[1]!;

    const [accounts, transactions, plans, subscriptions, statements] = await Promise.all([
      deps.finance.listAccounts(user.id),
      deps.finance.listTransactions(user.id, { from, to }),
      deps.finance.listInstallmentPlans(user.id),
      deps.finance.listSubscriptions(user.id),
      deps.finance.listStatements(user.id),
    ]);

    return toJson(
      computeSummary({
        month: target,
        today: todayDay,
        currency: profile.preferences.currency,
        accounts,
        transactions,
        plans,
        subscriptions,
        statements,
      }),
    );
  });

  // --- Agenda: pagos del mes ------------------------------------------------------
  app.get('/calendar', { schema: { querystring: summaryQuery } }, async (request) => {
    const { user, today: todayDay } = await today(request);
    const target = request.query.month ?? monthOf(todayDay);
    const range = calendarTransactionRange(target, todayDay);

    const [accounts, transactions, plans, subscriptions, statements] = await Promise.all([
      deps.finance.listAccounts(user.id),
      deps.finance.listTransactions(user.id, range),
      deps.finance.listInstallmentPlans(user.id),
      deps.finance.listSubscriptions(user.id),
      deps.finance.listStatements(user.id),
    ]);

    return toJson({
      month: target,
      today: todayDay,
      payments: computeCalendar({ month: target, today: todayDay, accounts, transactions, plans, subscriptions, statements }),
    });
  });
};
