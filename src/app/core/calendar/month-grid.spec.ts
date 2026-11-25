import { describe, expect, it } from 'vitest';
import { monthGrid } from './month-grid';

describe('grilla del mes', () => {
  it('parte el lunes y completa semanas con días de los meses vecinos', () => {
    // Noviembre 2026 empieza domingo: la primera semana va del lunes 26-oct al domingo 1-nov.
    const weeks = monthGrid('2026-11');
    expect(weeks).toHaveLength(6);
    expect(weeks[0]![0]).toMatchObject({ date: '2026-10-26', inMonth: false, weekday: 1 });
    expect(weeks[0]![6]).toMatchObject({ date: '2026-11-01', inMonth: true, weekday: 0 });
    expect(weeks.at(-1)!.at(-1)).toMatchObject({ date: '2026-12-06', inMonth: false });
  });

  it('un febrero que calza justo ocupa 4 semanas', () => {
    // Febrero 2027 empieza lunes y tiene 28 días.
    const weeks = monthGrid('2027-02');
    expect(weeks).toHaveLength(4);
    expect(weeks.flat().every((day) => day.inMonth)).toBe(true);
  });
});
