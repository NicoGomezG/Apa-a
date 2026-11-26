import { describe, expect, it } from 'vitest';
import { birthdaysInMonth, daysUntilLabel, nextBirthday, upcomingBirthdays } from './birthdays';

const person = (id: string, birthDay: number | null, birthMonth: number | null, birthYear: number | null = null) => ({
  id,
  name: id,
  birthDay,
  birthMonth,
  birthYear,
});

describe('cumpleaños', () => {
  it('calcula el próximo, los días que faltan y la edad que cumple', () => {
    expect(nextBirthday(person('cami', 3, 12, 1994), '2026-11-25')).toMatchObject({ date: '2026-12-03', daysUntil: 8, turns: 32 });
    // Ya pasó este año: el próximo es el del año siguiente.
    expect(nextBirthday(person('ana', 10, 1), '2026-11-25')).toMatchObject({ date: '2027-01-10', daysUntil: 46, turns: null });
    expect(nextBirthday(person('hoy', 25, 11), '2026-11-25')?.daysUntil).toBe(0);
    expect(nextBirthday(person('sin', null, null), '2026-11-25')).toBeNull();
  });

  it('el 29 de febrero se celebra el 28 en años no bisiestos', () => {
    expect(nextBirthday(person('bisiesto', 29, 2, 2000), '2027-01-01')?.date).toBe('2027-02-28');
    expect(nextBirthday(person('bisiesto', 29, 2, 2000), '2028-01-01')?.date).toBe('2028-02-29');
  });

  it('lista los próximos ordenados y agrupa los del mes', () => {
    const people = [person('a', 3, 12), person('b', 26, 11), person('c', 1, 6)];
    expect(upcomingBirthdays(people, '2026-11-25', 30).map((item) => item.person.id)).toEqual(['b', 'a']);
    const december = birthdaysInMonth(people, '2026-12');
    expect([...december.keys()]).toEqual(['2026-12-03']);
  });

  it('textos de días', () => {
    expect(daysUntilLabel(0)).toBe('hoy');
    expect(daysUntilLabel(1)).toBe('mañana');
    expect(daysUntilLabel(8)).toBe('en 8 días');
  });
});
