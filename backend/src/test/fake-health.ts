import type { HealthRepository, HealthVisitRecord } from '../modules/health/health.repository.js';
import {
  type HealthTrackerEventRecord,
  type HealthTrackerRecord,
  type HealthTrackersRepository,
  RECENT_EVENTS,
} from '../modules/health/health.trackers.repository.js';

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

  type StoredTracker = Omit<HealthTrackerRecord, 'events'> & { userId: string };
  type StoredEvent = HealthTrackerEventRecord & { userId: string; trackerId: string };
  const trackers: StoredTracker[] = [];
  const events: StoredEvent[] = [];

  const withEvents = ({ userId: _userId, ...tracker }: StoredTracker, all = false): HealthTrackerRecord => {
    // Más recientes primero (orden de inserción inverso).
    const own = events
      .filter((event) => event.trackerId === tracker.id)
      .reverse()
      .map(({ userId: _u, trackerId: _t, ...event }) => ({ ...event }));
    return { ...tracker, events: all ? own : own.slice(0, RECENT_EVENTS) };
  };
  const ownedTracker = (userId: string, id: string) => trackers.find((item) => item.id === id && item.userId === userId);
  const removeEvents = (match: (event: StoredEvent) => boolean) => {
    for (let i = events.length - 1; i >= 0; i -= 1) if (match(events[i]!)) events.splice(i, 1);
  };

  const trackersRepo: HealthTrackersRepository = {
    async listTrackers(userId, allEvents = false) {
      return trackers.filter((item) => item.userId === userId).map((item) => withEvents(item, allEvents));
    },
    async findTracker(userId, id) {
      const tracker = ownedTracker(userId, id);
      return tracker ? withEvents(tracker) : null;
    },
    async createTracker(userId, data) {
      const tracker = { ...data, id: nextId(), userId, createdAt: created };
      trackers.push(tracker);
      return withEvents(tracker);
    },
    async updateTracker(userId, id, changes, clearDoses) {
      const tracker = ownedTracker(userId, id);
      if (!tracker) return null;
      if (clearDoses) removeEvents((event) => event.trackerId === id && event.doseNumber !== null);
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) (tracker as Record<string, unknown>)[key] = value;
      }
      return withEvents(tracker);
    },
    async deleteTracker(userId, id) {
      const index = trackers.findIndex((item) => item.id === id && item.userId === userId);
      if (index < 0) return false;
      trackers.splice(index, 1);
      removeEvents((event) => event.trackerId === id);
      return true;
    },
    async addChange(userId, trackerId, day) {
      if (events.some((event) => event.trackerId === trackerId && event.day === day)) return;
      events.push({ id: nextId(), userId, trackerId, kind: 'changed', day, doseNumber: null, createdAt: created });
    },
    async setDose(userId, trackerId, doseNumber, kind) {
      const existing = events.find((event) => event.trackerId === trackerId && event.doseNumber === doseNumber);
      if (existing) existing.kind = kind;
      else events.push({ id: nextId(), userId, trackerId, kind, day: null, doseNumber, createdAt: created });
    },
    async deleteEvent(userId, trackerId, eventId) {
      const index = events.findIndex((event) => event.id === eventId && event.trackerId === trackerId && event.userId === userId);
      if (index < 0) return false;
      events.splice(index, 1);
      return true;
    },
  };

  return {
    repo,
    trackersRepo,
    visits,
    trackers,
    events,
    clearUser(userId: string) {
      for (let i = visits.length - 1; i >= 0; i -= 1) if (visits[i]!.userId === userId) visits.splice(i, 1);
      for (let i = trackers.length - 1; i >= 0; i -= 1) if (trackers[i]!.userId === userId) trackers.splice(i, 1);
      removeEvents((event) => event.userId === userId);
    },
  };
}
