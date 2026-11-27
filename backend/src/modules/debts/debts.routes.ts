import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { day, optionalText, positiveMoney } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditAction, AuditRepository } from '../audit/audit.repository.js';
import { toJson } from '../finance/finance.routes.js';
import { SUPPORTED_CURRENCIES } from '../finance/finance.types.js';
import type { PeopleRepository } from '../people/people.repository.js';
import { DEBT_DIRECTIONS, type DebtRecord, type DebtsRepository } from './debts.repository.js';

export interface DebtsRoutesDeps {
  debts: DebtsRepository;
  people: PeopleRepository;
  audit: AuditRepository;
}

const idParams = z.object({ id: z.uuid() });
const paymentParams = z.object({ id: z.uuid(), paymentId: z.uuid() });

const createBody = z.object({
  direction: z.enum(DEBT_DIRECTIONS),
  contactId: z.uuid().nullable().optional(),
  personName: optionalText(80),
  description: optionalText(200),
  amount: positiveMoney,
  currency: z.enum(SUPPORTED_CURRENCIES).default('CLP'),
  date: day,
});
const updateBody = createBody
  .omit({ direction: true, currency: true })
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), 'Sin cambios');
const paymentBody = z.object({ amount: positiveMoney, date: day });

/** Saldo y estado de una deuda a partir de sus abonos. */
export function debtView(debt: DebtRecord) {
  const paid = debt.payments.reduce((sum, payment) => sum + payment.amount, 0n);
  const pending = debt.amount - paid > 0n ? debt.amount - paid : 0n;
  const lastPayment = debt.payments.at(-1) ?? null;
  return {
    ...debt,
    paid,
    pending,
    status: pending === 0n ? ('paid' as const) : ('pending' as const),
    lastPaymentDate: lastPayment?.date ?? null,
    /** Fecha del abono que dejó la deuda en cero. */
    paidAt: pending === 0n ? (lastPayment?.date ?? null) : null,
  };
}

/** Deudas: quién te debe y a quién le debes, con abonos. */
export const debtsRoutes: FastifyPluginAsyncZod<DebtsRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);

  const audit = (userId: string, action: AuditAction, entityType: string, entityId: string) =>
    deps.audit.record({ userId, action, entityType, entityId });

  const requireDebt = async (userId: string, id: string) => {
    const debt = await deps.debts.find(userId, id);
    if (!debt) throw notFound('No encontramos esa deuda');
    return debt;
  };

  /** Nombre a guardar: el escrito o, si no hay, el del contacto (que debe ser propio). */
  const resolvePerson = async (userId: string, contactId: string | null | undefined, personName: string | null | undefined) => {
    if (contactId) {
      const contact = await deps.people.findContact(userId, contactId);
      if (!contact) throw notFound('No encontramos ese contacto');
      return personName ?? contact.name;
    }
    return personName ?? null;
  };

  app.get('/', async (request) => {
    const user = currentUser(request);
    return toJson((await deps.debts.list(user.id)).map(debtView));
  });

  app.post('/', { schema: { body: createBody } }, async (request, reply) => {
    const user = currentUser(request);
    const { contactId, personName, description, ...rest } = request.body;
    const name = await resolvePerson(user.id, contactId, personName);
    if (!name) throw badRequest('Indica quién es la persona');
    const debt = await deps.debts.create(user.id, {
      ...rest,
      contactId: contactId ?? null,
      personName: name,
      description: description ?? null,
    });
    await audit(user.id, 'finance.debt.created', 'debt', debt.id);
    return reply.status(201).send(toJson(debtView(debt)));
  });

  app.patch('/:id', { schema: { params: idParams, body: updateBody } }, async (request) => {
    const user = currentUser(request);
    const debt = await requireDebt(user.id, request.params.id);
    const { contactId, personName, amount, date, description } = request.body;

    const changes: Parameters<DebtsRepository['update']>[2] = {};
    if (contactId !== undefined) {
      changes.contactId = contactId;
      if (contactId) changes.personName = await resolvePerson(user.id, contactId, personName) ?? debt.personName;
    }
    if (personName !== undefined) {
      if (personName === null) throw badRequest('Indica quién es la persona');
      changes.personName = personName;
    }
    if (description !== undefined) changes.description = description;
    if (date !== undefined) {
      if (debt.payments.some((payment) => payment.date < date)) {
        throw badRequest('Hay abonos anteriores a esa fecha');
      }
      changes.date = date;
    }
    if (amount !== undefined) {
      if (amount < debtView(debt).paid) throw badRequest('El monto no puede ser menor que lo ya abonado');
      changes.amount = amount;
    }

    const updated = await deps.debts.update(user.id, debt.id, changes);
    if (!updated) throw notFound('No encontramos esa deuda');
    // Solo los nombres de los campos: nunca montos ni nombres de personas.
    await deps.audit.record({
      userId: user.id,
      action: 'finance.debt.updated',
      entityType: 'debt',
      entityId: debt.id,
      metadata: { fields: Object.keys(changes).sort() },
    });
    return toJson(debtView(updated));
  });

  app.delete('/:id', { schema: { params: idParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.debts.delete(user.id, request.params.id))) throw notFound('No encontramos esa deuda');
    await audit(user.id, 'finance.debt.deleted', 'debt', request.params.id);
    return reply.status(204).send();
  });

  // --- Abonos -----------------------------------------------------------------------
  app.post('/:id/payments', { schema: { params: idParams, body: paymentBody } }, async (request, reply) => {
    const user = currentUser(request);
    const debt = await requireDebt(user.id, request.params.id);
    const { amount, date } = request.body;
    const { pending } = debtView(debt);
    if (pending === 0n) throw badRequest('Esta deuda ya está pagada');
    if (amount > pending) throw badRequest('El abono es mayor que lo que queda por pagar');
    if (date < debt.date) throw badRequest('El abono no puede ser anterior a la deuda');
    const payment = await deps.debts.addPayment(user.id, debt.id, { amount, date });
    await audit(user.id, 'finance.debt.payment.created', 'debt_payment', payment.id);
    const updated = await requireDebt(user.id, debt.id);
    return reply.status(201).send(toJson(debtView(updated)));
  });

  app.delete('/:id/payments/:paymentId', { schema: { params: paymentParams } }, async (request) => {
    const user = currentUser(request);
    await requireDebt(user.id, request.params.id);
    if (!(await deps.debts.deletePayment(user.id, request.params.id, request.params.paymentId))) {
      throw notFound('No encontramos ese abono');
    }
    await audit(user.id, 'finance.debt.payment.deleted', 'debt_payment', request.params.paymentId);
    return toJson(debtView(await requireDebt(user.id, request.params.id)));
  });
};
