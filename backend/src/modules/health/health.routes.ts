import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { day, optionalText, text } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditRepository } from '../audit/audit.repository.js';
import { type HealthRepository, type HealthVisitInput, REPEAT_MONTHS } from './health.repository.js';

export interface HealthRoutesDeps {
  health: HealthRepository;
  audit: AuditRepository;
}

/**
 * Suma meses a un día 'YYYY-MM-DD'. Si el mes destino es más corto, queda en su último día
 * (31 de enero + 1 mes = 28 o 29 de febrero).
 */
export function addMonths(date: string, months: number): string {
  const [year, month, dayOfMonth] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(dayOfMonth, lastDay));
  return target.toISOString().slice(0, 10);
}

const repeatMonths = z
  .number()
  .int()
  .refine((value) => (REPEAT_MONTHS as readonly number[]).includes(value), 'Repetir en 1, 6 o 12 meses')
  .nullable()
  .optional();

const visitFields = {
  specialty: text(60),
  professional: optionalText(80),
  place: optionalText(120),
  visitDate: day,
  /** Si viene sin nextDate, el próximo control se calcula desde la fecha de la consulta. */
  repeatMonths,
  nextDate: day.nullable().optional(),
  notes: optionalText(1000),
};

const idParams = z.object({ id: z.uuid() });
const createBody = z.object({
  ...visitFields,
  /** "Ya fui": la consulta anterior cuyo control se cumple con esta. */
  completesVisitId: z.uuid().optional(),
});
const updateBody = z
  .object({ ...visitFields, nextDone: z.boolean() })
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), 'Sin cambios');

/** Salud: consultas con especialistas y próximos controles. */
export const healthRoutes: FastifyPluginAsyncZod<HealthRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);

  // Solo acción e id: nunca especialidad, profesional, notas ni fechas (son datos médicos).
  const audit = (userId: string, action: 'health.visit.created' | 'health.visit.deleted', id: string) =>
    deps.audit.record({ userId, action, entityType: 'health_visit', entityId: id });

  /** Próximo control: el elegido a mano, o el calculado con "repetir en". */
  const resolveNext = (visitDate: string, months: number | null, nextDate: string | null | undefined) => {
    const next = nextDate !== undefined ? nextDate : months ? addMonths(visitDate, months) : null;
    if (next && next < visitDate) throw badRequest('El próximo control no puede ser antes de la consulta');
    return next;
  };

  app.get('/visits', async (request) => {
    const user = currentUser(request);
    return deps.health.listVisits(user.id);
  });

  app.post('/visits', { schema: { body: createBody } }, async (request, reply) => {
    const user = currentUser(request);
    const { completesVisitId, ...body } = request.body;
    const previous = completesVisitId ? await deps.health.findVisit(user.id, completesVisitId) : null;
    if (completesVisitId && !previous) throw notFound('No encontramos esa consulta');

    const months = body.repeatMonths ?? null;
    const visit = await deps.health.createVisit(user.id, {
      specialty: body.specialty,
      professional: body.professional ?? null,
      place: body.place ?? null,
      visitDate: body.visitDate,
      repeatMonths: months,
      nextDate: resolveNext(body.visitDate, months, body.nextDate),
      nextDone: false,
      notes: body.notes ?? null,
    });
    if (previous) await deps.health.updateVisit(user.id, previous.id, { nextDone: true });
    await audit(user.id, 'health.visit.created', visit.id);
    return reply.status(201).send(visit);
  });

  app.patch('/visits/:id', { schema: { params: idParams, body: updateBody } }, async (request) => {
    const user = currentUser(request);
    const current = await deps.health.findVisit(user.id, request.params.id);
    if (!current) throw notFound('No encontramos esa consulta');

    const body = request.body;
    const changes: Partial<HealthVisitInput> = {};
    for (const key of ['specialty', 'professional', 'place', 'visitDate', 'notes', 'nextDone'] as const) {
      if (body[key] !== undefined) (changes as Record<string, unknown>)[key] = body[key];
    }
    if (body.repeatMonths !== undefined) changes.repeatMonths = body.repeatMonths;

    // Recalcular el próximo control si cambió la fecha o "repetir en" y no se eligió a mano.
    const visitDate = changes.visitDate ?? current.visitDate;
    const months = changes.repeatMonths !== undefined ? changes.repeatMonths : current.repeatMonths;
    if (body.nextDate !== undefined) {
      changes.nextDate = resolveNext(visitDate, months, body.nextDate);
    } else if (body.repeatMonths !== undefined || (body.visitDate !== undefined && current.repeatMonths)) {
      changes.nextDate = resolveNext(visitDate, months, undefined);
    } else if (current.nextDate && current.nextDate < visitDate) {
      throw badRequest('El próximo control no puede ser antes de la consulta');
    }
    // Un control nuevo vuelve a quedar pendiente.
    if (changes.nextDate !== undefined && changes.nextDate !== current.nextDate && body.nextDone === undefined) {
      changes.nextDone = false;
    }

    const visit = await deps.health.updateVisit(user.id, current.id, changes);
    if (!visit) throw notFound('No encontramos esa consulta');
    await deps.audit.record({
      userId: user.id,
      action: 'health.visit.updated',
      entityType: 'health_visit',
      entityId: current.id,
      metadata: { fields: Object.keys(changes).sort() },
    });
    return visit;
  });

  app.delete('/visits/:id', { schema: { params: idParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.health.deleteVisit(user.id, request.params.id))) throw notFound('No encontramos esa consulta');
    await audit(user.id, 'health.visit.deleted', request.params.id);
    return reply.status(204).send();
  });
};
