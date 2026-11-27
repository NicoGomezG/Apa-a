import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { birthdayFields, checkBirthday } from '../../lib/birthday.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { day, money, optionalEmail, optionalPhone, optionalText, positiveMoney, text } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditAction, AuditRepository } from '../audit/audit.repository.js';
import type { FriendsRepository } from '../friends/friends.repository.js';
import { toJson } from '../finance/finance.routes.js';
import { SUPPORTED_CURRENCIES } from '../finance/finance.types.js';
import { ensureProfile } from '../profile/profile.routes.js';
import type { ProfileRepository } from '../profile/profile.repository.js';
import type { PeopleRepository } from './people.repository.js';
import { RELATIONSHIPS, type ContactInput, type ExpenseInput, type GroupDetail } from './people.types.js';
import { computeBalances, computeSplit, simplifyDebts, SplitError, type SplitInput } from './split.math.js';

export interface PeopleRoutesDeps {
  people: PeopleRepository;
  friends: FriendsRepository;
  profiles: ProfileRepository;
  audit: AuditRepository;
  now?: () => Date;
}

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const LIMITS = { participants: 30, items: 100 } as const;
/** Entre un recordatorio de pago y el siguiente al mismo amigo. */
export const REMINDER_COOLDOWN_MS = 20 * 60 * 60 * 1000;

export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

// --- Esquemas -----------------------------------------------------------------

const contactFields = {
  name: text(80),
  nickname: optionalText(40),
  ...birthdayFields,
  phone: optionalPhone,
  email: optionalEmail,
  relationship: z.enum(RELATIONSHIPS).nullable().optional(),
  notes: optionalText(500),
};

const createContactBody = z.object(contactFields);
const updateContactBody = z
  .object(contactFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Sin cambios');

const groupParams = z.object({ groupId: z.uuid() });
const groupChildParams = z.object({ groupId: z.uuid(), id: z.uuid() });
const idParams = z.object({ id: z.uuid() });

const participantBody = z.object({
  name: text(80),
  contactId: z.uuid().nullable().optional(),
  /** Amigo con cuenta en Apaña: verá el grupo y podrá informar pagos. */
  friendId: z.uuid().nullable().optional(),
});

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

/** Grupo con saldos y transferencias sugeridas. Los pagos sin confirmar no cuentan. */
export function groupView(detail: GroupDetail) {
  const balances = computeBalances({ ...detail, settlements: detail.settlements.filter((settlement) => settlement.confirmed) });
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
    settlements: view.settlements
      .filter((settlement) => settlement.confirmed)
      .map(({ id, fromId, toId, amount, date }) => ({ id, fromId, toId, amount, date })),
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

  /** Solo se enlaza a amigos, y cada amigo una vez por grupo. */
  const requireFriend = async (userId: string, friendId: string | null | undefined, taken: (string | null)[] = []) => {
    if (!friendId) return;
    if (!(await deps.friends.areFriends(userId, friendId))) throw notFound('No encontramos a ese amigo');
    if (taken.includes(friendId)) throw conflict('Ese amigo ya está en el grupo');
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
          participants: detail.participants.map(({ id, name, isMe, linkedUserId }) => ({ id, name, isMe, linkedUserId })),
          expenseCount: detail.expenses.length,
          pendingPayments: detail.settlements.filter((settlement) => !settlement.confirmed).length,
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
    const friendIds: string[] = [];
    for (const participant of body.participants) {
      await requireContact(user.id, participant.contactId);
      await requireFriend(user.id, participant.friendId, friendIds);
      if (participant.friendId) friendIds.push(participant.friendId);
    }
    const profile = await ensureProfile(deps, user);
    const detail = await deps.people.createGroup(
      user.id,
      { name: body.name, date: body.date ?? null, currency: body.currency },
      [
        { name: profile.displayName?.trim() || 'Yo', contactId: null, isMe: true, linkedUserId: null },
        ...body.participants.map((participant) => ({
          name: participant.name,
          contactId: participant.contactId ?? null,
          isMe: false,
          linkedUserId: participant.friendId ?? null,
        })),
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
    await requireFriend(user.id, request.body.friendId, detail.participants.map((item) => item.linkedUserId));
    const participant = await deps.people.addParticipant(user.id, detail.group.id, {
      name: request.body.name,
      contactId: request.body.contactId ?? null,
      isMe: false,
      linkedUserId: request.body.friendId ?? null,
    });
    await audit(user.id, 'people.participant.added', 'split_participant', participant.id);
    return reply.status(201).send(toJson(participant));
  });

  app.patch(
    '/groups/:groupId/participants/:id',
    { schema: { params: groupChildParams, body: participantBody.partial() } },
    async (request) => {
      const user = currentUser(request);
      const detail = await loadGroup(user.id, request.params.groupId);
      const current = detail.participants.find((item) => item.id === request.params.id);
      if (!current) throw notFound('No encontramos a esa persona en el grupo');
      const { friendId, ...rest } = request.body;
      await requireContact(user.id, rest.contactId);
      if (friendId !== undefined) {
        if (current.isMe && friendId) throw badRequest('No puedes enlazarte a ti mismo con un amigo');
        await requireFriend(
          user.id,
          friendId,
          detail.participants.filter((item) => item.id !== current.id).map((item) => item.linkedUserId),
        );
      }
      const changes = {
        ...rest,
        ...(friendId !== undefined && friendId !== current.linkedUserId ? { linkedUserId: friendId, remindedAt: null } : {}),
      };
      const participant = await deps.people.updateParticipant(user.id, detail.group.id, current.id, changes);
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
    const settlement = await deps.people.createSettlement(user.id, detail.group.id, {
      ...request.body,
      confirmed: true,
      reportedBy: null,
    });
    await audit(user.id, 'people.settlement.created', 'split_settlement', settlement.id);
    return reply.status(201).send(toJson(settlement));
  });

  /** Confirma un pago que informó un amigo: desde ahora cuenta en los saldos. */
  app.post('/groups/:groupId/settlements/:id/confirm', { schema: { params: groupChildParams } }, async (request) => {
    const user = currentUser(request);
    const settlement = await deps.people.confirmSettlement(user.id, request.params.groupId, request.params.id);
    if (!settlement) throw notFound('No encontramos ese pago por confirmar');
    await audit(user.id, 'people.settlement.confirmed', 'split_settlement', settlement.id);
    return toJson(settlement);
  });

  // --- Recordatorio de pago a un amigo -----------------------------------------
  app.post('/groups/:groupId/participants/:id/remind', { schema: { params: groupChildParams } }, async (request) => {
    const user = currentUser(request);
    const detail = await loadGroup(user.id, request.params.groupId);
    const participant = detail.participants.find((item) => item.id === request.params.id);
    if (!participant) throw notFound('No encontramos a esa persona en el grupo');
    if (!participant.linkedUserId) throw badRequest('Solo puedes recordarle a un amigo con cuenta en Apaña');
    const balance = groupView(detail).balances.find((item) => item.participantId === participant.id)?.balance ?? 0n;
    if (balance >= 0n) throw conflict('Esta persona no tiene deudas en el grupo');
    const sentAt = now();
    if (participant.remindedAt && sentAt.getTime() - participant.remindedAt.getTime() < REMINDER_COOLDOWN_MS) {
      throw conflict('Ya le recordaste hace poco. Puedes volver a hacerlo mañana.');
    }
    const updated = await deps.people.updateParticipant(user.id, detail.group.id, participant.id, { remindedAt: sentAt });
    await audit(user.id, 'people.reminder.sent', 'split_participant', participant.id);
    return toJson(updated);
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
