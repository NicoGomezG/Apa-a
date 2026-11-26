import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { day, money, optionalEmail, optionalText, positiveMoney, text } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditAction, AuditRepository } from '../audit/audit.repository.js';
import { toJson } from '../finance/finance.routes.js';
import { SUPPORTED_CURRENCIES } from '../finance/finance.types.js';
import { ensureProfile } from '../profile/profile.routes.js';
import type { ProfileRepository } from '../profile/profile.repository.js';
import type { PeopleRepository } from './people.repository.js';
import { RELATIONSHIPS, type ContactInput, type ExpenseInput, type GroupDetail } from './people.types.js';
import { computeBalances, computeSplit, simplifyDebts, SplitError, type SplitInput } from './split.math.js';

export interface PeopleRoutesDeps {
  people: PeopleRepository;
  profiles: ProfileRepository;
  audit: AuditRepository;
  now?: () => Date;
}

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const LIMITS = { participants: 30, items: 100 } as const;

const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

// --- Esquemas -----------------------------------------------------------------

const daysInMonth = (month: number) => new Date(Date.UTC(2000, month, 0)).getUTCDate(); // 2000: bisiesto, admite 29-feb

const contactFields = {
  name: text(80),
  nickname: optionalText(40),
  birthDay: z.number().int().min(1).max(31).nullable().optional(),
  birthMonth: z.number().int().min(1).max(12).nullable().optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  phone: optionalText(30).refine((value) => !value || /^[+\d\s()-]{6,30}$/.test(value), 'Teléfono inválido'),
  email: optionalEmail,
  relationship: z.enum(RELATIONSHIPS).nullable().optional(),
  notes: optionalText(500),
};

const createContactBody = z.object(contactFields);
const updateContactBody = z
  .object(contactFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Sin cambios');

/** Valida que el cumpleaños sea un día real; el año solo tiene sentido con día y mes. */
function checkBirthday(contact: Pick<ContactInput, 'birthDay' | 'birthMonth' | 'birthYear'>, currentYear: number): void {
  const { birthDay, birthMonth, birthYear } = contact;
  if ((birthDay === null) !== (birthMonth === null)) throw badRequest('Indica el día y el mes del cumpleaños');
  if (birthDay !== null && birthMonth !== null && birthDay > daysInMonth(birthMonth)) {
    throw badRequest('Ese día no existe en ese mes');
  }
  if (birthYear !== null) {
    if (birthDay === null) throw badRequest('Indica el día y el mes además del año');
    if (birthYear > currentYear) throw badRequest('El año de nacimiento no puede ser futuro');
    if (birthDay === 29 && birthMonth === 2 && !isLeap(birthYear)) throw badRequest('Ese año no tuvo 29 de febrero');
  }
}

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const groupParams = z.object({ groupId: z.uuid() });
const groupChildParams = z.object({ groupId: z.uuid(), id: z.uuid() });
const idParams = z.object({ id: z.uuid() });

const participantBody = z.object({ name: text(80), contactId: z.uuid().nullable().optional() });

const createGroupBody = z.object({
  name: text(80),
  date: day.nullable().optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).default('CLP'),
  participants: z.array(participantBody).max(LIMITS.participants - 1).default([]),
});
const updateGroupBody = z
  .object({ name: text(80), date: day.nullable() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Sin cambios');

const expenseBody = z.object({
  description: text(120),
  date: day,
  payerId: z.uuid(),
  mode: z.enum(['equal', 'exact', 'items']),
  tipPercent: z.number().int().min(0).max(30).default(0),
  amount: positiveMoney.optional(),
  participantIds: z.array(z.uuid()).max(LIMITS.participants).optional(),
  exact: z
    .array(z.object({ participantId: z.uuid(), amount: money }))
    .max(LIMITS.participants)
    .optional(),
  items: z
    .array(
      z.object({
        description: text(120),
        quantity: z.number().int().min(1).max(99).default(1),
        unitPrice: positiveMoney,
        participantIds: z.array(z.uuid()).min(1).max(LIMITS.participants),
      }),
    )
    .max(LIMITS.items)
    .optional(),
});

const settlementBody = z
  .object({ fromId: z.uuid(), toId: z.uuid(), amount: positiveMoney, date: day })
  .refine((value) => value.fromId !== value.toId, 'Quien paga y quien recibe deben ser distintos');

// --- Respuestas ------------------------------------------------------------------

/** Grupo con saldos y transferencias sugeridas. */
export function groupView(detail: GroupDetail) {
  const balances = computeBalances(detail);
  return {
    ...detail,
    totalSpent: detail.expenses.reduce((sum, expense) => sum + expense.total, 0n),
    balances,
    transfers: simplifyDebts(balances),
  };
}

/** Versión para el enlace de invitados: sin datos de contacto ni el propio código. */
export function publicGroupView(detail: GroupDetail) {
  const view = groupView(detail);
  return {
    group: { name: detail.group.name, date: detail.group.date, currency: detail.group.currency },
    participants: detail.participants.map(({ id, name }) => ({ id, name })),
    expenses: view.expenses.map(({ id, description, date, payerId, mode, subtotal, tipPercent, tip, total, items, shares }) => ({
      id,
      description,
      date,
      payerId,
      mode,
      subtotal,
      tipPercent,
      tip,
      total,
      items,
      shares,
    })),
    settlements: view.settlements.map(({ id, fromId, toId, amount, date }) => ({ id, fromId, toId, amount, date })),
    totalSpent: view.totalSpent,
    balances: view.balances,
    transfers: view.transfers,
  };
}

// --- Rutas -----------------------------------------------------------------------

export const peopleRoutes: FastifyPluginAsyncZod<PeopleRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);
  const now = deps.now ?? (() => new Date());

  const audit = (userId: string, action: AuditAction, entityType: string, entityId: string, fields?: string[]) =>
    deps.audit.record({ userId, action, entityType, entityId, ...(fields ? { metadata: { fields } } : {}) });

  const loadGroup = async (userId: string, groupId: string) => {
    const detail = await deps.people.getGroup(userId, groupId);
    if (!detail) throw notFound('No encontramos ese grupo');
    return detail;
  };

  const requireContact = async (userId: string, contactId: string | null | undefined) => {
    if (contactId && !(await deps.people.findContact(userId, contactId))) throw notFound('No encontramos ese contacto');
  };

  // --- Contactos ---------------------------------------------------------------
  app.get('/contacts', async (request) => {
    const user = currentUser(request);
    return toJson(await deps.people.listContacts(user.id));
  });

  app.post('/contacts', { schema: { body: createContactBody } }, async (request, reply) => {
    const user = currentUser(request);
    const body = request.body;
    const data: ContactInput = {
      name: body.name,
      nickname: body.nickname ?? null,
      birthDay: body.birthDay ?? null,
      birthMonth: body.birthMonth ?? null,
      birthYear: body.birthYear ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      relationship: body.relationship ?? null,
      notes: body.notes ?? null,
    };
    checkBirthday(data, now().getUTCFullYear());
    const contact = await deps.people.createContact(user.id, data);
    await audit(user.id, 'people.contact.created', 'contact', contact.id);
    return reply.status(201).send(toJson(contact));
  });

  app.patch('/contacts/:id', { schema: { params: idParams, body: updateContactBody } }, async (request) => {
    const user = currentUser(request);
    const existing = await deps.people.findContact(user.id, request.params.id);
    if (!existing) throw notFound('No encontramos ese contacto');
    checkBirthday({ ...existing, ...request.body } as ContactInput, now().getUTCFullYear());
    const contact = await deps.people.updateContact(user.id, request.params.id, request.body);
    if (!contact) throw notFound('No encontramos ese contacto');
    await audit(user.id, 'people.contact.updated', 'contact', contact.id, Object.keys(request.body));
    return toJson(contact);
  });

  app.delete('/contacts/:id', { schema: { params: idParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.people.deleteContact(user.id, request.params.id))) throw notFound('No encontramos ese contacto');
    await audit(user.id, 'people.contact.deleted', 'contact', request.params.id);
    return reply.status(204).send();
  });

  // --- Grupos ------------------------------------------------------------------
  app.get('/groups', async (request) => {
    const user = currentUser(request);
    const groups = await deps.people.listGroups(user.id);
    return toJson(
      groups.map((detail) => {
        const view = groupView(detail);
        const me = detail.participants.find((participant) => participant.isMe);
        return {
          ...detail.group,
          shared: detail.group.shareToken !== null,
          shareToken: undefined,
          participants: detail.participants.map(({ id, name, isMe }) => ({ id, name, isMe })),
          expenseCount: detail.expenses.length,
          totalSpent: view.totalSpent,
          myBalance: me ? (view.balances.find((item) => item.participantId === me.id)?.balance ?? 0n) : null,
          settled: view.transfers.length === 0,
        };
      }),
    );
  });

  app.post('/groups', { schema: { body: createGroupBody } }, async (request, reply) => {
    const user = currentUser(request);
    const body = request.body;
    for (const participant of body.participants) await requireContact(user.id, participant.contactId);
    const profile = await ensureProfile(deps, user);
    const detail = await deps.people.createGroup(
      user.id,
      { name: body.name, date: body.date ?? null, currency: body.currency },
      [
        { name: profile.displayName?.trim() || 'Yo', contactId: null, isMe: true },
        ...body.participants.map((participant) => ({ name: participant.name, contactId: participant.contactId ?? null, isMe: false })),
      ],
    );
    await audit(user.id, 'people.group.created', 'split_group', detail.group.id);
    return reply.status(201).send(toJson(groupView(detail)));
  });

  app.get('/groups/:groupId', { schema: { params: groupParams } }, async (request) => {
    const user = currentUser(request);
    return toJson(groupView(await loadGroup(user.id, request.params.groupId)));
  });

  app.patch('/groups/:groupId', { schema: { params: groupParams, body: updateGroupBody } }, async (request) => {
    const user = currentUser(request);
    const group = await deps.people.updateGroup(user.id, request.params.groupId, request.body);
    if (!group) throw notFound('No encontramos ese grupo');
    await audit(user.id, 'people.group.updated', 'split_group', group.id, Object.keys(request.body));
    return toJson(group);
  });

  app.delete('/groups/:groupId', { schema: { params: groupParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.people.deleteGroup(user.id, request.params.groupId))) throw notFound('No encontramos ese grupo');
    await audit(user.id, 'people.group.deleted', 'split_group', request.params.groupId);
    return reply.status(204).send();
  });

  // --- Enlace para invitados ---------------------------------------------------
  app.post('/groups/:groupId/share', { schema: { params: groupParams } }, async (request) => {
    const user = currentUser(request);
    // 24 bytes aleatorios = 192 bits: imposible de adivinar. Crear uno nuevo invalida el anterior.
    const token = randomBytes(24).toString('base64url');
    const group = await deps.people.updateGroup(user.id, request.params.groupId, { shareToken: token });
    if (!group) throw notFound('No encontramos ese grupo');
    await audit(user.id, 'people.share.enabled', 'split_group', group.id);
    return { token };
  });

  app.delete('/groups/:groupId/share', { schema: { params: groupParams } }, async (request, reply) => {
    const user = currentUser(request);
    const group = await deps.people.updateGroup(user.id, request.params.groupId, { shareToken: null });
    if (!group) throw notFound('No encontramos ese grupo');
    await audit(user.id, 'people.share.disabled', 'split_group', group.id);
    return reply.status(204).send();
  });

  // --- Participantes -----------------------------------------------------------
  app.post('/groups/:groupId/participants', { schema: { params: groupParams, body: participantBody } }, async (request, reply) => {
    const user = currentUser(request);
    const detail = await loadGroup(user.id, request.params.groupId);
    if (detail.participants.length >= LIMITS.participants) throw badRequest(`Máximo ${LIMITS.participants} personas por grupo`);
    await requireContact(user.id, request.body.contactId);
    const participant = await deps.people.addParticipant(user.id, detail.group.id, {
      name: request.body.name,
      contactId: request.body.contactId ?? null,
      isMe: false,
    });
    await audit(user.id, 'people.participant.added', 'split_participant', participant.id);
    return reply.status(201).send(toJson(participant));
  });

  app.patch(
    '/groups/:groupId/participants/:id',
    { schema: { params: groupChildParams, body: participantBody.partial() } },
    async (request) => {
      const user = currentUser(request);
      await requireContact(user.id, request.body.contactId);
      const participant = await deps.people.updateParticipant(user.id, request.params.groupId, request.params.id, request.body);
      if (!participant) throw notFound('No encontramos a esa persona en el grupo');
      await audit(user.id, 'people.participant.updated', 'split_participant', participant.id, Object.keys(request.body));
      return toJson(participant);
    },
  );

  app.delete('/groups/:groupId/participants/:id', { schema: { params: groupChildParams } }, async (request, reply) => {
    const user = currentUser(request);
    const detail = await loadGroup(user.id, request.params.groupId);
    const id = request.params.id;
    const participant = detail.participants.find((item) => item.id === id);
    if (!participant) throw notFound('No encontramos a esa persona en el grupo');
    if (participant.isMe) throw conflict('No puedes quitarte de tu propio grupo');
    const used =
      detail.expenses.some(
        (expense) =>
          expense.payerId === id ||
          expense.shares.some((share) => share.participantId === id) ||
          expense.items.some((item) => item.participantIds.includes(id)),
      ) || detail.settlements.some((settlement) => settlement.fromId === id || settlement.toId === id);
    if (used) throw conflict('Esta persona tiene gastos o pagos en el grupo. Quítala de esos gastos primero.');
    await deps.people.deleteParticipant(user.id, detail.group.id, id);
    await audit(user.id, 'people.participant.deleted', 'split_participant', id);
    return reply.status(204).send();
  });

  // --- Gastos ------------------------------------------------------------------
  const buildExpense = (detail: GroupDetail, body: z.infer<typeof expenseBody>): ExpenseInput => {
    const order = detail.participants.map((participant) => participant.id);
    if (!order.includes(body.payerId)) throw badRequest('Quien pagó no está en el grupo');
    const items = (body.items ?? []).map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.unitPrice * BigInt(item.quantity),
      participantIds: [...new Set(item.participantIds)],
    }));
    const input: SplitInput = {
      mode: body.mode,
      order,
      amount: body.amount,
      participantIds: body.participantIds,
      exact: body.exact,
      items,
      tipPercent: body.tipPercent,
    };
    let result;
    try {
      result = computeSplit(input);
    } catch (error) {
      if (error instanceof SplitError) throw badRequest(error.message);
      throw error;
    }
    return {
      description: body.description,
      date: body.date,
      payerId: body.payerId,
      mode: body.mode,
      subtotal: result.subtotal,
      tipPercent: body.tipPercent,
      tip: result.tip,
      total: result.total,
      items: body.mode === 'items' ? items : [],
      shares: result.shares,
    };
  };

  app.post('/groups/:groupId/expenses', { schema: { params: groupParams, body: expenseBody } }, async (request, reply) => {
    const user = currentUser(request);
    const detail = await loadGroup(user.id, request.params.groupId);
    const expense = await deps.people.createExpense(user.id, detail.group.id, buildExpense(detail, request.body));
    await audit(user.id, 'people.expense.created', 'split_expense', expense.id);
    return reply.status(201).send(toJson(expense));
  });

  app.put('/groups/:groupId/expenses/:id', { schema: { params: groupChildParams, body: expenseBody } }, async (request) => {
    const user = currentUser(request);
    const detail = await loadGroup(user.id, request.params.groupId);
    const expense = await deps.people.replaceExpense(user.id, detail.group.id, request.params.id, buildExpense(detail, request.body));
    if (!expense) throw notFound('No encontramos ese gasto');
    await audit(user.id, 'people.expense.updated', 'split_expense', expense.id);
    return toJson(expense);
  });

  app.delete('/groups/:groupId/expenses/:id', { schema: { params: groupChildParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.people.deleteExpense(user.id, request.params.groupId, request.params.id))) {
      throw notFound('No encontramos ese gasto');
    }
    await audit(user.id, 'people.expense.deleted', 'split_expense', request.params.id);
    return reply.status(204).send();
  });

  // --- Pagos entre personas ----------------------------------------------------
  app.post('/groups/:groupId/settlements', { schema: { params: groupParams, body: settlementBody } }, async (request, reply) => {
    const user = currentUser(request);
    const detail = await loadGroup(user.id, request.params.groupId);
    const ids = new Set(detail.participants.map((participant) => participant.id));
    if (!ids.has(request.body.fromId) || !ids.has(request.body.toId)) throw badRequest('Esa persona no está en el grupo');
    const settlement = await deps.people.createSettlement(user.id, detail.group.id, request.body);
    await audit(user.id, 'people.settlement.created', 'split_settlement', settlement.id);
    return reply.status(201).send(toJson(settlement));
  });

  app.delete('/groups/:groupId/settlements/:id', { schema: { params: groupChildParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.people.deleteSettlement(user.id, request.params.groupId, request.params.id))) {
      throw notFound('No encontramos ese pago');
    }
    await audit(user.id, 'people.settlement.deleted', 'split_settlement', request.params.id);
    return reply.status(204).send();
  });
};

/** Enlace de solo lectura para invitados: sin sesión, solo con el código. */
export const publicSplitRoutes: FastifyPluginAsyncZod<{ people: PeopleRepository }> = async (app, deps) => {
  app.get(
    '/splits/:token',
    {
      schema: { params: z.object({ token: z.string() }) },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Robots-Tag', 'noindex, nofollow');
      reply.header('Referrer-Policy', 'no-referrer');
      const { token } = request.params;
      const detail = SHARE_TOKEN_RE.test(token) ? await deps.people.getGroupByToken(token) : null;
      if (!detail) throw notFound('Este enlace no existe o fue desactivado');
      return toJson(publicGroupView(detail));
    },
  );
};
