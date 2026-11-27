import type { PrismaClient } from '../../generated/prisma/client.js';

// Salud: consultas con especialistas y su próximo control. Todo filtra por el userId dueño.

export const REPEAT_MONTHS = [1, 6, 12] as const;

export interface HealthVisitRecord {
  id: string;
  specialty: string;
  professional: string | null;
  place: string | null;
  /** 'YYYY-MM-DD' */
  visitDate: string;
  repeatMonths: number | null;
  /** Próximo control, 'YYYY-MM-DD'. */
  nextDate: string | null;
  /** Ya se registró la consulta de ese control. */
  nextDone: boolean;
  notes: string | null;
  createdAt: Date;
}

export type HealthVisitInput = Omit<HealthVisitRecord, 'id' | 'createdAt'>;

export interface HealthRepository {
  listVisits(userId: string): Promise<HealthVisitRecord[]>;
  findVisit(userId: string, id: string): Promise<HealthVisitRecord | null>;
  createVisit(userId: string, data: HealthVisitInput): Promise<HealthVisitRecord>;
  updateVisit(userId: string, id: string, changes: Partial<HealthVisitInput>): Promise<HealthVisitRecord | null>;
  deleteVisit(userId: string, id: string): Promise<boolean>;
}

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

export function createPrismaHealthRepository(prisma: PrismaClient): HealthRepository {
  type Row = Awaited<ReturnType<typeof prisma.healthVisit.findFirstOrThrow>>;
  const fromRow = (row: Row): HealthVisitRecord => ({
    id: row.id,
    specialty: row.specialty,
    professional: row.professional,
    place: row.place,
    visitDate: toDay(row.visitDate),
    repeatMonths: row.repeatMonths,
    nextDate: row.nextDate ? toDay(row.nextDate) : null,
    nextDone: row.nextDone,
    notes: row.notes,
    createdAt: row.createdAt,
  });

  const toData = (data: Partial<HealthVisitInput>) => {
    const { visitDate, nextDate, ...rest } = data;
    return {
      ...rest,
      ...(visitDate !== undefined ? { visitDate: toDate(visitDate) } : {}),
      ...(nextDate !== undefined ? { nextDate: nextDate === null ? null : toDate(nextDate) } : {}),
    };
  };

  const findVisit = async (userId: string, id: string) => {
    const row = await prisma.healthVisit.findFirst({ where: { id, userId } });
    return row ? fromRow(row) : null;
  };

  return {
    async listVisits(userId) {
      const rows = await prisma.healthVisit.findMany({
        where: { userId },
        orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
      });
      return rows.map(fromRow);
    },

    findVisit,

    async createVisit(userId, data) {
      const { visitDate, ...rest } = toData(data);
      return fromRow(await prisma.healthVisit.create({ data: { ...rest, specialty: data.specialty, visitDate: visitDate!, userId } }));
    },

    async updateVisit(userId, id, changes) {
      const { count } = await prisma.healthVisit.updateMany({ where: { id, userId }, data: toData(changes) });
      return count > 0 ? findVisit(userId, id) : null;
    },

    async deleteVisit(userId, id) {
      const { count } = await prisma.healthVisit.deleteMany({ where: { id, userId } });
      return count > 0;
    },
  };
}
