import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { day, positiveMoney } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditRepository } from '../audit/audit.repository.js';
import { toJson } from '../finance/finance.routes.js';
import type { PeopleRepository } from './people.repository.js';
import { conflict, groupView } from './people.routes.js';
import type { SharedGroup } from './people.types.js';

// Vista del amigo: grupos de otra persona donde el dueño lo enlazó. Puede verlos e informar
// pagos; el dueño los confirma. Nunca ve datos de contacto, el enlace de invitados ni
// a qué contactos del dueño corresponde cada participante.

export interface SharedRoutesDeps {
  people: PeopleRepository;
  audit: AuditRepository;
}

/** Máximo de pagos sin confirmar que un amigo puede tener en un grupo. */
export const MAX_PENDING_REPORTS = 10;

const groupParams = z.object({ groupId: z.uuid() });
const childParams = z.object({ groupId: z.uuid(), id: z.uuid() });
const reportBody = z.object({ toId: z.uuid(), amount: positiveMoney, date: day });

/** Participante que corresponde a quien mira. */
const viewerOf = (shared: SharedGroup, userId: string) => {
  const participant = shared.detail.participants.find((item) => item.linkedUserId === userId);
  if (!participant) throw notFound('No encontramos ese grupo');
  return participant;
};

export function sharedGroupView(shared: SharedGroup, userId: string) {
  const { detail } = shared;
  const view = groupView(detail);
  const you = viewerOf(shared, userId);
  return {
    group: { id: detail.group.id, name: detail.group.name, date: detail.group.date, currency: detail.group.currency },
    ownerName: detail.participants.find((item) => item.isMe)?.name ?? null,
    youId: you.id,
    remindedAt: you.remindedAt,
    participants: detail.participants.map(({ id, name, isMe }) => ({ id, name, isOwner: isMe })),
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
    settlements: view.settlements.map(({ id, fromId, toId, amount, date, confirmed, reportedBy }) => ({
      id,
      fromId,
      toId,
      amount,
      date,
      confirmed,
      reportedByYou: reportedBy === userId,
    })),
    totalSpent: view.totalSpent,
    balances: view.balances,
    transfers: view.transfers,
  };
}

export const sharedGroupRoutes: FastifyPluginAsyncZod<SharedRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);

  const loadShared = async (userId: string, groupId: string) => {
    const shared = await deps.people.getSharedGroup(userId, groupId);
    if (!shared) throw notFound('No encontramos ese grupo');
    return shared;
  };

  app.get('/', async (request) => {
    const user = currentUser(request);
    const groups = await deps.people.listSharedGroups(user.id);
    return toJson(
      groups.map((shared) => {
        const view = sharedGroupView(shared, user.id);
        return {
          id: view.group.id,
          name: view.group.name,
          date: view.group.date,
          currency: view.group.currency,
          ownerName: view.ownerName,
          participantCount: view.participants.length,
          totalSpent: view.totalSpent,
          myBalance: view.balances.find((item) => item.participantId === view.youId)?.balance ?? 0n,
          youOwe: view.transfers.filter((transfer) => transfer.fromId === view.youId),
          remindedAt: view.remindedAt,
          pendingReports: view.settlements.filter((settlement) => settlement.reportedByYou && !settlement.confirmed).length,
        };
      }),
    );
  });

  app.get('/:groupId', { schema: { params: groupParams } }, async (request) => {
    const user = currentUser(request);
    return toJson(sharedGroupView(await loadShared(user.id, request.params.groupId), user.id));
  });

  /** El amigo informa que pagó. Queda por confirmar y no cambia los saldos hasta entonces. */
  app.post('/:groupId/settlements', { schema: { params: groupParams, body: reportBody } }, async (request, reply) => {
    const user = currentUser(request);
    const shared = await loadShared(user.id, request.params.groupId);
    const you = viewerOf(shared, user.id);
    const { toId, amount, date } = request.body;
    if (toId === you.id) throw badRequest('Elige a quién le pagaste');
    if (!shared.detail.participants.some((item) => item.id === toId)) throw badRequest('Esa persona no está en el grupo');
    const pending = shared.detail.settlements.filter((item) => item.reportedBy === user.id && !item.confirmed).length;
    if (pending >= MAX_PENDING_REPORTS) throw conflict('Tienes muchos pagos por confirmar en este grupo. Espera a que los revisen.');
    const settlement = await deps.people.createSettlement(shared.ownerId, shared.detail.group.id, {
      fromId: you.id,
      toId,
      amount,
      date,
      confirmed: false,
      reportedBy: user.id,
    });
    // La bitácora es de quien actúa (el amigo); el dueño ve el pago en su grupo.
    await deps.audit.record({ userId: user.id, action: 'people.settlement.reported', entityType: 'split_settlement', entityId: settlement.id });
    return reply.status(201).send(toJson({ ...settlement, reportedBy: undefined, reportedByYou: true }));
  });

  app.delete('/:groupId/settlements/:id', { schema: { params: childParams } }, async (request, reply) => {
    const user = currentUser(request);
    await loadShared(user.id, request.params.groupId);
    if (!(await deps.people.deleteReportedSettlement(user.id, request.params.groupId, request.params.id))) {
      throw notFound('No encontramos ese pago por confirmar');
    }
    await deps.audit.record({
      userId: user.id,
      action: 'people.settlement.withdrawn',
      entityType: 'split_settlement',
      entityId: request.params.id,
    });
    return reply.status(204).send();
  });
};
