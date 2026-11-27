import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { day, optionalText, positiveMoney, text } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditAction, AuditRepository } from '../audit/audit.repository.js';
import { MONTH_RE, monthOf, todayIn } from '../finance/finance.dates.js';
import type { FinanceRepository } from '../finance/finance.repository.js';
import { toJson } from '../finance/finance.routes.js';
import { SUPPORTED_CURRENCIES } from '../finance/finance.types.js';
import { ensureProfile } from '../profile/profile.routes.js';
import type { ProfileRepository } from '../profile/profile.repository.js';
import { billAmountIn, billDueIn, billEstimate, billStatus, nextUnpaidDue, paymentFor } from './bills.math.js';
import { BILL_EVERY_MONTHS, BILL_KINDS, type BillRecord, type BillsRepository } from './bills.repository.js';

export interface BillsRoutesDeps {
  bills: BillsRepository;
  finance: FinanceRepository;
  profiles: ProfileRepository;
  audit: AuditRepository;
  now?: () => Date;
}

const month = z.string().regex(MONTH_RE, 'Mes inválido');
const idParams = z.object({ id: z.uuid() });
const paymentParams = z.object({ id: z.uuid(), period: month });
const listQuery = z.object({ month: month.optional() });

const everyMonths = z
  .number()
  .int()
  .refine((value) => (BILL_EVERY_MONTHS as readonly number[]).includes(value), 'Frecuencia inválida')
  .transform((value) => value as (typeof BILL_EVERY_MONTHS)[number]);

const createBody = z.object({
  name: text(80),
  kind: z.enum(BILL_KINDS),
  company: optionalText(60),
  amount: positiveMoney,
  currency: z.enum(SUPPORTED_CURRENCIES).default('CLP'),
  dueDay: z.number().int().min(1).max(31),
  everyMonths: everyMonths.default(1),
  /** Primer mes en que vence; por defecto, el mes actual. */
  startMonth: month.optional(),
  accountId: z.uuid().nullable().optional(),
  autopay: z.boolean().default(false),
  active: z.boolean().default(true),
  notes: optionalText(500),
});
const updateBody = z
  .object({
    name: text(80),
    kind: z.enum(BILL_KINDS),
    company: optionalText(60),
    amount: positiveMoney,
    currency: z.enum(SUPPORTED_CURRENCIES),
    dueDay: z.number().int().min(1).max(31),
    everyMonths,
    startMonth: month,
    accountId: z.uuid().nullable(),
    autopay: z.boolean(),
    active: z.boolean(),
    notes: optionalText(500),
  })
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), 'Sin cambios');
const paymentBody = z.object({ amount: positiveMoney, paidOn: day });

/** Cómo queda una cuenta en un mes: vencimiento, pago, estado y monto esperado. */
export function billView(bill: BillRecord, target: string, today: string) {
  return {
    ...bill,
    estimate: billEstimate(bill),
    dueDate: billDueIn(bill, target),
    payment: paymentFor(bill, target),
    status: bill.active ? billStatus(bill, target, today) : null,
    nextDue: nextUnpaidDue(bill, today),
  };
}

/** Cuentas fijas: agua, luz, internet… con el pago de cada mes. */
export const billsRoutes: FastifyPluginAsyncZod<BillsRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);
  const now = deps.now ?? (() => new Date());

  const context = async (request: Parameters<typeof currentUser>[0]) => {
    const user = currentUser(request);
    const profile = await ensureProfile(deps, user);
    return { user, profile, today: todayIn(profile.preferences.timezone, now()) };
  };

  const audit = (userId: string, action: AuditAction, entityType: string, entityId: string, fields?: string[]) =>
    deps.audit.record({ userId, action, entityType, entityId, ...(fields ? { metadata: { fields } } : {}) });

  const requireBill = async (userId: string, id: string) => {
    const bill = await deps.bills.find(userId, id);
    if (!bill) throw notFound('No encontramos esa cuenta fija');
    return bill;
  };

  /** El medio de pago tiene que ser una cuenta propia. */
  const checkAccount = async (userId: string, accountId: string | null | undefined) => {
    if (accountId && !(await deps.finance.findAccount(userId, accountId))) throw notFound('No encontramos esa cuenta');
  };

  app.get('/', { schema: { querystring: listQuery } }, async (request) => {
    const { user, profile, today } = await context(request);
    const target = request.query.month ?? monthOf(today);
    const bills = await deps.bills.list(user.id);
    const currency = profile.preferences.currency;

    // Totales del mes en la moneda principal: lo esperado, lo pagado y lo que falta.
    let expected = 0n;
    let paid = 0n;
    for (const bill of bills) {
      if (bill.currency !== currency) continue;
      const share = billAmountIn(bill, target);
      if (!share) continue;
      expected += share.amount;
      if (share.paid) paid += share.amount;
    }

    return toJson({
      month: target,
      today,
      currency,
      totals: { expected, paid, pending: expected - paid },
      bills: bills.map((bill) => billView(bill, target, today)),
    });
  });

  app.post('/', { schema: { body: createBody } }, async (request, reply) => {
    const { user, today } = await context(request);
    const { accountId, company, notes, startMonth, ...rest } = request.body;
    await checkAccount(user.id, accountId);
    const bill = await deps.bills.create(user.id, {
      ...rest,
      company: company ?? null,
      notes: notes ?? null,
      accountId: accountId ?? null,
      startMonth: startMonth ?? monthOf(today),
    });
    await audit(user.id, 'finance.bill.created', 'bill', bill.id);
    return reply.status(201).send(toJson(billView(bill, monthOf(today), today)));
  });

  app.patch('/:id', { schema: { params: idParams, body: updateBody } }, async (request) => {
    const { user, today } = await context(request);
    await requireBill(user.id, request.params.id);
    await checkAccount(user.id, request.body.accountId);
    const changes = Object.fromEntries(Object.entries(request.body).filter(([, value]) => value !== undefined));
    const updated = await deps.bills.update(user.id, request.params.id, changes);
    if (!updated) throw notFound('No encontramos esa cuenta fija');
    // Solo los nombres de los campos: nunca montos ni empresas.
    await audit(user.id, 'finance.bill.updated', 'bill', updated.id, Object.keys(changes).sort());
    return toJson(billView(updated, monthOf(today), today));
  });

  app.delete('/:id', { schema: { params: idParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.bills.delete(user.id, request.params.id))) throw notFound('No encontramos esa cuenta fija');
    await audit(user.id, 'finance.bill.deleted', 'bill', request.params.id);
    return reply.status(204).send();
  });

  // --- Pago de un mes ---------------------------------------------------------------
  app.put('/:id/payments/:period', { schema: { params: paymentParams, body: paymentBody } }, async (request) => {
    const { user, today } = await context(request);
    const { id, period } = request.params;
    const bill = await requireBill(user.id, id);
    if (billDueIn(bill, period) === null) throw badRequest('Esta cuenta no vence ese mes');
    await deps.bills.setPayment(user.id, bill.id, { period, ...request.body });
    await audit(user.id, 'finance.bill.payment.recorded', 'bill', bill.id);
    return toJson(billView(await requireBill(user.id, bill.id), period, today));
  });

  app.delete('/:id/payments/:period', { schema: { params: paymentParams } }, async (request) => {
    const { user, today } = await context(request);
    const { id, period } = request.params;
    await requireBill(user.id, id);
    if (!(await deps.bills.deletePayment(user.id, id, period))) throw notFound('Ese mes no tiene un pago anotado');
    await audit(user.id, 'finance.bill.payment.deleted', 'bill', id);
    return toJson(billView(await requireBill(user.id, id), period, today));
  });
};
