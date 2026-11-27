import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { day, optionalText, text } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditRepository } from '../audit/audit.repository.js';
import {
  type HealthTrackerInput,
  type HealthTrackerRecord,
  type HealthTrackersRepository,
  timeToMinute,
} from './health.trackers.repository.js';

export interface HealthTrackersRoutesDeps {
  healthTrackers: HealthTrackersRepository;
  audit: AuditRepository;
}

const dayNumber = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;

/**
 * Última toma de un tratamiento con término (n.º desde 0), o null si no tiene término.
 * Las tomas van cada N horas de reloj desde el día y hora de inicio, hasta el fin del último día.
 * Mismo cálculo que `doseCount` en `features/salud/trackers.models.ts`.
 */
export function lastDoseNumber(
  tracker: Pick<HealthTrackerRecord, 'everyHours' | 'startTime' | 'startDate' | 'endDate'>,
): number | null {
  if (!tracker.endDate || !tracker.everyHours || !tracker.startTime) return null;
  const minutes = (dayNumber(tracker.endDate) - dayNumber(tracker.startDate)) * 1440 + 1439 - timeToMinute(tracker.startTime);
  return Math.floor(minutes / (tracker.everyHours * 60));
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
const everyDays = z.number().int().min(1).max(730);
const everyHours = z.number().int().min(1).max(168);

const replacementBody = z.object({
  kind: z.literal('replacement'),
  name: text(80),
  everyDays,
  startDate: day,
  notes: optionalText(500),
});
const medicationBody = z.object({
  kind: z.literal('medication'),
  name: text(80),
  everyHours,
  startTime: time,
  startDate: day,
  endDate: day.nullable().optional(),
  notes: optionalText(500),
});
const createBody = z.discriminatedUnion('kind', [replacementBody, medicationBody]);
const updateBody = z
  .object({
    name: text(80),
    everyDays,
    everyHours,
    startTime: time,
    startDate: day,
    endDate: day.nullable(),
    notes: optionalText(500),
  })
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), 'Sin cambios');

const idParams = z.object({ id: z.uuid() });
const eventParams = z.object({ id: z.uuid(), eventId: z.uuid() });
const doseParams = z.object({ id: z.uuid(), dose: z.coerce.number().int().min(0).max(1_000_000) });
const changeBody = z.object({ day });
const doseBody = z.object({ status: z.enum(['taken', 'skipped']) });

/** Salud: recambios (lentes de contacto…) cada N días y medicamentos cada N horas. */
export const healthTrackersRoutes: FastifyPluginAsyncZod<HealthTrackersRoutesDeps> = async (app, deps) => {
  // Solo acción e id: nunca nombres de medicamentos, horarios ni notas (son datos médicos).
  type Action =
    | 'health.tracker.created'
    | 'health.tracker.deleted'
    | 'health.tracker.event.recorded'
    | 'health.tracker.event.deleted';
  const audit = (userId: string, action: Action, id: string) =>
    deps.audit.record({ userId, action, entityType: 'health_tracker', entityId: id });

  const owned = async (userId: string, id: string) => {
    const tracker = await deps.healthTrackers.findTracker(userId, id);
    if (!tracker) throw notFound('No encontramos ese seguimiento');
    return tracker;
  };
  const checkDates = (startDate: string, endDate: string | null | undefined) => {
    if (endDate && endDate < startDate) throw badRequest('El término no puede ser antes del inicio');
  };

  app.get('/trackers', async (request) => {
    const user = currentUser(request);
    return deps.healthTrackers.listTrackers(user.id);
  });

  app.post('/trackers', { schema: { body: createBody } }, async (request, reply) => {
    const user = currentUser(request);
    const body = request.body;
    const data: HealthTrackerInput =
      body.kind === 'replacement'
        ? {
            kind: 'replacement',
            name: body.name,
            everyDays: body.everyDays,
            everyHours: null,
            startTime: null,
            startDate: body.startDate,
            endDate: null,
            notes: body.notes ?? null,
          }
        : {
            kind: 'medication',
            name: body.name,
            everyDays: null,
            everyHours: body.everyHours,
            startTime: body.startTime,
            startDate: body.startDate,
            endDate: body.endDate ?? null,
            notes: body.notes ?? null,
          };
    checkDates(data.startDate, data.endDate);
    const tracker = await deps.healthTrackers.createTracker(user.id, data);
    await audit(user.id, 'health.tracker.created', tracker.id);
    return reply.status(201).send(tracker);
  });

  app.patch('/trackers/:id', { schema: { params: idParams, body: updateBody } }, async (request) => {
    const user = currentUser(request);
    const current = await owned(user.id, request.params.id);
    const body = request.body;
    const medication = current.kind === 'medication';
    if (medication && body.everyDays !== undefined) throw badRequest('Un medicamento va cada N horas, no días');
    if (!medication && (body.everyHours !== undefined || body.startTime !== undefined || body.endDate !== undefined)) {
      throw badRequest('Un recambio va cada N días, sin hora ni término');
    }

    const changes: Partial<Omit<HealthTrackerInput, 'kind'>> = {};
    for (const key of ['name', 'everyDays', 'everyHours', 'startTime', 'startDate', 'endDate', 'notes'] as const) {
      if (body[key] !== undefined) (changes as Record<string, unknown>)[key] = body[key];
    }
    checkDates(changes.startDate ?? current.startDate, changes.endDate !== undefined ? changes.endDate : current.endDate);

    // Si cambia el horario, los n.º de toma ya no corresponden a las mismas horas: se borran las marcas.
    const clearDoses =
      medication &&
      ((changes.everyHours !== undefined && changes.everyHours !== current.everyHours) ||
        (changes.startTime !== undefined && changes.startTime !== current.startTime) ||
        (changes.startDate !== undefined && changes.startDate !== current.startDate));

    const tracker = await deps.healthTrackers.updateTracker(user.id, current.id, changes, clearDoses);
    if (!tracker) throw notFound('No encontramos ese seguimiento');
    await deps.audit.record({
      userId: user.id,
      action: 'health.tracker.updated',
      entityType: 'health_tracker',
      entityId: current.id,
      metadata: { fields: Object.keys(changes).sort() },
    });
    return tracker;
  });

  app.delete('/trackers/:id', { schema: { params: idParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.healthTrackers.deleteTracker(user.id, request.params.id))) {
      throw notFound('No encontramos ese seguimiento');
    }
    await audit(user.id, 'health.tracker.deleted', request.params.id);
    return reply.status(204).send();
  });

  /** "Los cambié hoy" (o el día que se indique). */
  app.post('/trackers/:id/changes', { schema: { params: idParams, body: changeBody } }, async (request, reply) => {
    const user = currentUser(request);
    const tracker = await owned(user.id, request.params.id);
    if (tracker.kind !== 'replacement') throw badRequest('Solo los recambios se marcan como cambiados');
    if (request.body.day < tracker.startDate) throw badRequest('No puede ser antes del inicio');
    await deps.healthTrackers.addChange(user.id, tracker.id, request.body.day);
    await audit(user.id, 'health.tracker.event.recorded', tracker.id);
    return reply.status(201).send(await owned(user.id, tracker.id));
  });

  /** Marca la toma n.º `dose` como tomada u omitida. */
  app.put('/trackers/:id/doses/:dose', { schema: { params: doseParams, body: doseBody } }, async (request) => {
    const user = currentUser(request);
    const tracker = await owned(user.id, request.params.id);
    if (tracker.kind !== 'medication') throw badRequest('Solo los medicamentos tienen tomas');
    const last = lastDoseNumber(tracker);
    if (last !== null && request.params.dose > last) throw badRequest('Esa toma queda después del término');
    await deps.healthTrackers.setDose(user.id, tracker.id, request.params.dose, request.body.status);
    await audit(user.id, 'health.tracker.event.recorded', tracker.id);
    return owned(user.id, tracker.id);
  });

  /** Deshace un "Los cambié" o una toma marcada. */
  app.delete('/trackers/:id/events/:eventId', { schema: { params: eventParams } }, async (request) => {
    const user = currentUser(request);
    const tracker = await owned(user.id, request.params.id);
    if (!(await deps.healthTrackers.deleteEvent(user.id, tracker.id, request.params.eventId))) {
      throw notFound('No encontramos ese registro');
    }
    await audit(user.id, 'health.tracker.event.deleted', tracker.id);
    return owned(user.id, tracker.id);
  });
};
