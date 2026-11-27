import { describe, expect, it } from 'vitest';
import {
  addDays,
  doseAt,
  doseCount,
  dosesOn,
  everyHoursLabel,
  type HealthTracker,
  type HealthTrackerEvent,
  localNow,
  medicationPhase,
  nextDose,
  replacementView,
  treatmentDay,
} from './trackers.models';

const tracker = (data: Partial<HealthTracker>): HealthTracker => ({
  id: 't1',
  kind: 'replacement',
  name: 'Lentes de contacto mensuales',
  everyDays: 30,
  everyHours: null,
  startTime: null,
  startDate: '2026-11-01',
  endDate: null,
  notes: null,
  createdAt: '2026-11-01T12:00:00Z',
  events: [],
  ...data,
});

const event = (data: Partial<HealthTrackerEvent>): HealthTrackerEvent => ({
  id: `e${Math.random()}`,
  kind: 'changed',
  day: null,
  doseNumber: null,
  createdAt: '2026-11-01T12:00:00Z',
  ...data,
});

const medication = (data: Partial<HealthTracker> = {}) =>
  tracker({
    kind: 'medication',
    name: 'Amoxicilina',
    everyDays: null,
    everyHours: 8,
    startTime: '08:00',
    startDate: '2026-12-01',
    endDate: '2026-12-07',
    ...data,
  });

describe('recambios', () => {
  it('cuenta desde el inicio si no hay cambios, y desde el último cambio si lo hay', () => {
    const fresh = replacementView(tracker({}), '2026-11-20');
    expect(fresh).toMatchObject({ lastChange: null, since: '2026-11-01', nextChange: '2026-12-01', daysLeft: 11, status: 'ok' });

    const changed = tracker({ events: [event({ day: '2026-11-10' }), event({ day: '2026-11-25' })] });
    expect(replacementView(changed, '2026-11-27')).toMatchObject({ since: '2026-11-25', nextChange: '2026-12-25', daysLeft: 28 });
  });

  it('avisa cuando se acerca, toca hoy o está atrasado', () => {
    const lenses = tracker({});
    expect(replacementView(lenses, '2026-11-28').status).toBe('soon');
    expect(replacementView(lenses, '2026-12-01').status).toBe('due');
    expect(replacementView(lenses, '2026-12-04')).toMatchObject({ status: 'late', daysLeft: -3, progress: 1 });
    expect(replacementView(lenses, '2026-10-30').status).toBe('notStarted');
    // Un recambio diario no queda siempre en "se acerca".
    expect(replacementView(tracker({ everyDays: 1 }), '2026-11-01').status).toBe('ok');
  });
});

describe('medicamentos', () => {
  it('ubica cada toma en su día y hora, cruzando la medianoche', () => {
    const med = medication();
    expect(doseAt(med, 0)).toEqual({ day: '2026-12-01', minute: 480 });
    expect(doseAt(med, 2)).toEqual({ day: '2026-12-02', minute: 0 });
    expect(doseAt(med, 19)).toEqual({ day: '2026-12-07', minute: 960 });
    expect(doseCount(med)).toBe(20);
    expect(doseCount(medication({ endDate: null }))).toBeNull();
  });

  it('lista las tomas del día con su estado', () => {
    const med = medication({ events: [event({ kind: 'taken', doseNumber: 2 }), event({ kind: 'skipped', doseNumber: 3 })] });
    const doses = dosesOn(med, '2026-12-02', { day: '2026-12-02', minute: 17 * 60 });
    expect(doses.map((dose) => [dose.number, dose.time, dose.status])).toEqual([
      [2, '00:00', 'taken'],
      [3, '08:00', 'skipped'],
      [4, '16:00', 'due'],
    ]);
    // El primer día parte a la hora de inicio; el último termina en la última toma.
    expect(dosesOn(med, '2026-12-01', { day: '2026-12-01', minute: 0 }).map((dose) => dose.time)).toEqual(['08:00', '16:00']);
    expect(dosesOn(med, '2026-12-07', { day: '2026-12-01', minute: 0 }).map((dose) => dose.status)).toEqual(['upcoming', 'upcoming', 'upcoming']);
    expect(dosesOn(med, '2026-12-08', { day: '2026-12-08', minute: 0 })).toEqual([]);
    expect(dosesOn(med, '2026-11-30', { day: '2026-11-30', minute: 0 })).toEqual([]);
  });

  it('con intervalos que no dividen el día, las horas van corriendo', () => {
    const med = medication({ everyHours: 10, startTime: '20:00', endDate: null });
    expect(dosesOn(med, '2026-12-02', { day: '2026-12-02', minute: 0 }).map((dose) => dose.time)).toEqual(['06:00', '16:00']);
  });

  it('próxima toma y fase del tratamiento', () => {
    const med = medication();
    expect(nextDose(med, { day: '2026-12-01', minute: 9 * 60 })).toMatchObject({ number: 1, time: '16:00' });
    expect(nextDose(med, { day: '2026-11-30', minute: 0 })).toMatchObject({ number: 0, day: '2026-12-01' });
    expect(nextDose(med, { day: '2026-12-07', minute: 17 * 60 })).toBeNull();
    expect(medicationPhase(med, '2026-11-30')).toBe('notStarted');
    expect(medicationPhase(med, '2026-12-07')).toBe('active');
    expect(medicationPhase(med, '2026-12-08')).toBe('finished');
    expect(treatmentDay(med, '2026-12-03')).toEqual({ day: 3, of: 7 });
    expect(everyHoursLabel(8)).toBe('Cada 8 horas');
    expect(everyHoursLabel(24)).toBe('Una vez al día');
    expect(everyHoursLabel(48)).toBe('Cada 2 días');
  });
});

describe('fechas', () => {
  it('suma días y lee la hora local de una zona', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(localNow('America/Santiago', new Date('2026-12-01T15:30:00Z'))).toEqual({ day: '2026-12-01', minute: 12 * 60 + 30 });
    expect(localNow('America/Santiago', new Date('2026-12-02T02:10:00Z'))).toEqual({ day: '2026-12-01', minute: 23 * 60 + 10 });
  });
});
