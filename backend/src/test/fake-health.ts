import type { HealthRepository, HealthVisitRecord } from '../modules/health/health.repository.js';

/** Consultas de salud en memoria, con las mismas reglas de pertenencia que el repositorio real. */
export function createFakeHealth() {
  let sequence = 0;
  const nextId = () => `00000000-0000-7000-a0e0-${String((sequence += 1)).padStart(12, '0')}`;
  const created = new Date('2026-12-01T12:00:00Z');
  const visits: (HealthVisitRecord & { userId: string })[] = [];

  const strip = ({ userId: _userId, ...visit }: HealthVisitRecord & { userId: string }): HealthVisitRecord => ({ ...visit });
  const owned = (userId: string, id: string) => visits.find((visit) => visit.id === id && visit.userId === userId);

  const repo: HealthRepository = {
    async listVisits(userId) {
      return visits
        .filter((visit) => visit.userId === userId)
        .sort((a, b) => b.visitDate.localeCompare(a.visitDate))
        .map(strip);
    },
    async findVisit(userId, id) {
      const visit = owned(userId, id);
      return visit ? strip(visit) : null;
    },
    async createVisit(userId, data) {
      const visit = { ...data, id: nextId(), userId, createdAt: created };
      visits.push(visit);
      return strip(visit);
    },
    async updateVisit(userId, id, changes) {
      const visit = owned(userId, id);
      if (!visit) return null;
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) (visit as Record<string, unknown>)[key] = value;
      }
      return strip(visit);
    },
    async deleteVisit(userId, id) {
      const index = visits.findIndex((visit) => visit.id === id && visit.userId === userId);
      if (index < 0) return false;
      visits.splice(index, 1);
      return true;
    },
  };

  return {
    repo,
    visits,
    clearUser(userId: string) {
      for (let i = visits.length - 1; i >= 0; i -= 1) if (visits[i]!.userId === userId) visits.splice(i, 1);
    },
  };
}
