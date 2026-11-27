import type { PrismaClient } from '../../generated/prisma/client.js';

// Salud fase B: recambios (cada N días) y medicamentos (cada N horas). Todo filtra por el userId dueño.

export type TrackerKind = 'replacement' | 'medication';
export type TrackerEventKind = 'changed' | 'taken' | 'skipped';

/** Eventos recientes que acompañan a cada seguimiento (suficiente para la vista de hoy e historial corto). */
export const RECENT_EVENTS = 60;

export interface HealthTrackerEventRecord {
  id: string;
  kind: TrackerEventKind;
  /** Recambio: día en que se cambió, 'YYYY-MM-DD'. */
  day: string | null;
  /** Medicamento: n.º de toma desde la primera (0, 1, 2…). */
  doseNumber: number | null;
  createdAt: Date;
}

export interface HealthTrackerRecord {
  id: string;
  kind: TrackerKind;
  name: string;
  everyDays: number | null;
  everyHours: number | null;
  /** Medicamento: hora de la primera toma, 'HH:MM' (hora local). */
  startTime: string | null;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: Date;
  /** Los más recientes primero (máximo RECENT_EVENTS). */
  events: HealthTrackerEventRecord[];
}

export type HealthTrackerInput = Omit<HealthTrackerRecord, 'id' | 'createdAt' | 'events'>;

export interface HealthTrackersRepository {
  /** Con `allEvents` trae todos los eventos (exportación); si no, los RECENT_EVENTS más recientes. */
  listTrackers(userId: string, allEvents?: boolean): Promise<HealthTrackerRecord[]>;
  findTracker(userId: string, id: string): Promise<HealthTrackerRecord | null>;
  createTracker(userId: string, data: HealthTrackerInput): Promise<HealthTrackerRecord>;
  /** `clearDoses` borra las tomas marcadas (cambió el horario y los números de toma ya no calzan). */
  updateTracker(
    userId: string,
    id: string,
    changes: Partial<Omit<HealthTrackerInput, 'kind'>>,
    clearDoses: boolean,
  ): Promise<HealthTrackerRecord | null>;
  deleteTracker(userId: string, id: string): Promise<boolean>;
  /** Registra "Los cambié" ese día (si ya estaba, no duplica). */
  addChange(userId: string, trackerId: string, day: string): Promise<void>;
  /** Marca una toma como tomada u omitida (reemplaza la marca anterior). */
  setDose(userId: string, trackerId: string, doseNumber: number, kind: 'taken' | 'skipped'): Promise<void>;
  deleteEvent(userId: string, trackerId: string, eventId: string): Promise<boolean>;
}

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
export const minuteToTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const timeToMinute = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
};

export function createPrismaHealthTrackersRepository(prisma: PrismaClient): HealthTrackersRepository {
  const include = { events: { orderBy: [{ createdAt: 'desc' as const }], take: RECENT_EVENTS } };
  type Row = Awaited<ReturnType<typeof prisma.healthTracker.findFirstOrThrow<{ include: typeof include }>>>;

  const fromRow = (row: Row): HealthTrackerRecord => ({
    id: row.id,
    kind: row.kind as TrackerKind,
    name: row.name,
    everyDays: row.everyDays,
    everyHours: row.everyHours,
    startTime: row.startMinute === null ? null : minuteToTime(row.startMinute),
    startDate: toDay(row.startDate),
    endDate: row.endDate ? toDay(row.endDate) : null,
    notes: row.notes,
    createdAt: row.createdAt,
    events: row.events.map((event) => ({
      id: event.id,
      kind: event.kind as TrackerEventKind,
      day: event.day ? toDay(event.day) : null,
      doseNumber: event.doseNumber,
      createdAt: event.createdAt,
    })),
  });

  const toData = (data: Partial<HealthTrackerInput>) => {
    const { startTime, startDate, endDate, ...rest } = data;
    return {
      ...rest,
      ...(startTime !== undefined ? { startMinute: startTime === null ? null : timeToMinute(startTime) } : {}),
      ...(startDate !== undefined ? { startDate: toDate(startDate) } : {}),
      ...(endDate !== undefined ? { endDate: endDate === null ? null : toDate(endDate) } : {}),
    };
  };

  const findTracker = async (userId: string, id: string) => {
    const row = await prisma.healthTracker.findFirst({ where: { id, userId }, include });
    return row ? fromRow(row) : null;
  };

  return {
    async listTrackers(userId, allEvents = false) {
      const rows = await prisma.healthTracker.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }],
        include: allEvents ? { events: { orderBy: [{ createdAt: 'desc' as const }] } } : include,
      });
      return rows.map(fromRow);
    },

    findTracker,

    async createTracker(userId, data) {
      const row = await prisma.healthTracker.create({
        data: { ...toData(data), kind: data.kind, name: data.name, startDate: toDate(data.startDate), userId },
        include,
      });
      return fromRow(row);
    },

    async updateTracker(userId, id, changes, clearDoses) {
      const count = await prisma.$transaction(async (tx) => {
        if (clearDoses) await tx.healthTrackerEvent.deleteMany({ where: { userId, trackerId: id, doseNumber: { not: null } } });
        return (await tx.healthTracker.updateMany({ where: { id, userId }, data: toData(changes) })).count;
      });
      return count > 0 ? findTracker(userId, id) : null;
    },

    async deleteTracker(userId, id) {
      const { count } = await prisma.healthTracker.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    async addChange(userId, trackerId, day) {
      await prisma.healthTrackerEvent.upsert({
        where: { trackerId_day: { trackerId, day: toDate(day) } },
        create: { userId, trackerId, kind: 'changed', day: toDate(day) },
        update: {},
      });
    },

    async setDose(userId, trackerId, doseNumber, kind) {
      await prisma.healthTrackerEvent.upsert({
        where: { trackerId_doseNumber: { trackerId, doseNumber } },
        create: { userId, trackerId, kind, doseNumber },
        update: { kind },
      });
    },

    async deleteEvent(userId, trackerId, eventId) {
      const { count } = await prisma.healthTrackerEvent.deleteMany({ where: { id: eventId, trackerId, userId } });
      return count > 0;
    },
  };
}
