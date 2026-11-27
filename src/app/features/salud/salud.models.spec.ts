import { describe, expect, it } from 'vitest';
import { addMonths, controlStatus, daysBetween, type HealthVisit, pendingControls, relativeDays } from './salud.models';

const visit = (data: Partial<HealthVisit>): HealthVisit => ({
  id: 'v1',
  specialty: 'Oftalmología',
  professional: null,
  place: null,
  visitDate: '2026-06-10',
  repeatMonths: 6,
  nextDate: '2026-12-10',
  nextDone: false,
  notes: null,
  createdAt: '2026-06-10T12:00:00Z',
  ...data,
});

describe('addMonths (mismos casos que el backend)', () => {
  it('suma meses y ajusta al último día cuando el mes es más corto', () => {
    expect(addMonths('2026-06-10', 6)).toBe('2026-12-10');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 12)).toBe('2027-11-15');
  });
});

describe('estado de un control', () => {
  it('atrasado, se acerca (30 días o menos) o al día', () => {
    expect(controlStatus('2026-11-30', '2026-12-01')).toBe('late');
    expect(controlStatus('2026-12-01', '2026-12-01')).toBe('soon');
    expect(controlStatus('2026-12-31', '2026-12-01')).toBe('soon');
    expect(controlStatus('2027-01-01', '2026-12-01')).toBe('ok');
  });

  it('cuenta días y los dice en palabras', () => {
    expect(daysBetween('2026-12-01', '2026-12-10')).toBe(9);
    expect(daysBetween('2026-12-01', '2026-11-28')).toBe(-3);
    expect(relativeDays(0)).toBe('hoy');
    expect(relativeDays(1)).toBe('mañana');
    expect(relativeDays(9)).toBe('en 9 días');
    expect(relativeDays(-3)).toBe('hace 3 días');
  });
});

describe('pendingControls', () => {
  it('solo los que tienen fecha y no están hechos, del más próximo al más lejano', () => {
    const list = pendingControls([
      visit({ id: 'a', nextDate: '2027-03-01' }),
      visit({ id: 'b', nextDate: '2026-12-10' }),
      visit({ id: 'c', nextDate: null }),
      visit({ id: 'd', nextDate: '2026-12-05', nextDone: true }),
    ]);
    expect(list.map((item) => item.id)).toEqual(['b', 'a']);
  });
});
