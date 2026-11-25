import { describe, expect, it } from 'vitest';
import { chileanHolidays, easterSunday, holidaysInMonth, juneSolsticeDay, nextHoliday } from './holidays-cl';

const dates = (year: number) => chileanHolidays(year).map((holiday) => holiday.date);

describe('feriados de Chile', () => {
  it('calcula el domingo de Pascua', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
  });

  it('2023: corre San Pedro y Encuentro al lunes, y el 31-oct (martes) al viernes 27', () => {
    const list = dates(2023);
    expect(list).toContain('2023-06-26');
    expect(list).toContain('2023-10-09');
    expect(list).toContain('2023-10-27');
    expect(list).not.toContain('2023-10-31');
  });

  it('2024: viernes 20 de septiembre y feriados en sábado que no se mueven', () => {
    const list = dates(2024);
    expect(list).toEqual([
      '2024-01-01',
      '2024-03-29',
      '2024-03-30',
      '2024-05-01',
      '2024-05-21',
      '2024-06-20',
      '2024-06-29',
      '2024-07-16',
      '2024-08-15',
      '2024-09-18',
      '2024-09-19',
      '2024-09-20',
      '2024-10-12',
      '2024-10-31',
      '2024-11-01',
      '2024-12-08',
      '2024-12-25',
    ]);
  });

  it('2026: calendario completo', () => {
    expect(dates(2026)).toEqual([
      '2026-01-01',
      '2026-04-03',
      '2026-04-04',
      '2026-05-01',
      '2026-05-21',
      '2026-06-21',
      '2026-06-29',
      '2026-07-16',
      '2026-08-15',
      '2026-09-18',
      '2026-09-19',
      '2026-10-12',
      '2026-10-31',
      '2026-11-01',
      '2026-12-08',
      '2026-12-25',
    ]);
  });

  it('2018: el 31-oct (miércoles) se corre al viernes 2 de noviembre', () => {
    expect(dates(2018)).toContain('2018-11-02');
  });

  it('2029: el lunes 17 de septiembre es feriado adicional', () => {
    expect(dates(2029)).toContain('2029-09-17');
  });

  it('solsticio fuera de la tabla con la aproximación', () => {
    expect([20, 21]).toContain(juneSolsticeDay(2040));
  });

  it('marca los irrenunciables y busca el próximo feriado', () => {
    const december = holidaysInMonth('2026-12');
    expect(december.get('2026-12-25')).toMatchObject({ name: 'Navidad', irrenunciable: true });
    expect(december.get('2026-12-08')?.irrenunciable).toBe(false);
    expect(nextHoliday('2026-11-25')?.date).toBe('2026-12-08');
    expect(nextHoliday('2026-12-26')?.date).toBe('2027-01-01');
  });
});
