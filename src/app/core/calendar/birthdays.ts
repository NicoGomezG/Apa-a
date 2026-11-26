// Cumpleaños a partir de día/mes (y año opcional). Son días del calendario, sin zonas horarias.

export interface BirthdayPerson {
  id: string;
  name: string;
  nickname?: string | null;
  birthDay: number | null;
  birthMonth: number | null;
  birthYear: number | null;
}

export interface UpcomingBirthday<T extends BirthdayPerson = BirthdayPerson> {
  person: T;
  /** 'YYYY-MM-DD' del próximo cumpleaños. */
  date: string;
  /** Días que faltan (0 = hoy). */
  daysUntil: number;
  /** Años que cumple; null si no se conoce el año. */
  turns: number | null;
}

const pad = (value: number) => String(value).padStart(2, '0');
const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const dayNumber = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Fecha del cumpleaños en un año. El 29 de febrero se celebra el 28 en años no bisiestos. */
export function birthdayIn(person: BirthdayPerson, year: number): string | null {
  if (!person.birthDay || !person.birthMonth) return null;
  const day = person.birthMonth === 2 && person.birthDay === 29 && !isLeap(year) ? 28 : person.birthDay;
  return `${year}-${pad(person.birthMonth)}-${pad(day)}`;
}

/** Próximo cumpleaños desde `today` (inclusive). */
export function nextBirthday<T extends BirthdayPerson>(person: T, today: string): UpcomingBirthday<T> | null {
  const year = Number(today.slice(0, 4));
  let date = birthdayIn(person, year);
  if (!date) return null;
  if (date < today) date = birthdayIn(person, year + 1)!;
  const birthdayYear = Number(date.slice(0, 4));
  return {
    person,
    date,
    daysUntil: dayNumber(date) - dayNumber(today),
    turns: person.birthYear ? birthdayYear - person.birthYear : null,
  };
}

/** Cumpleaños de los próximos `days` días, del más cercano al más lejano. */
export function upcomingBirthdays<T extends BirthdayPerson>(people: T[], today: string, days: number): UpcomingBirthday<T>[] {
  return people
    .map((person) => nextBirthday(person, today))
    .filter((item): item is UpcomingBirthday<T> => item !== null && item.daysUntil <= days)
    .sort((a, b) => a.daysUntil - b.daysUntil || a.person.name.localeCompare(b.person.name));
}

/** Cumpleaños de un mes ('YYYY-MM'), indexados por día. */
export function birthdaysInMonth<T extends BirthdayPerson>(people: T[], month: string): Map<string, UpcomingBirthday<T>[]> {
  const year = Number(month.slice(0, 4));
  const result = new Map<string, UpcomingBirthday<T>[]>();
  for (const person of people) {
    const date = birthdayIn(person, year);
    if (!date || !date.startsWith(month)) continue;
    const item = { person, date, daysUntil: 0, turns: person.birthYear ? year - person.birthYear : null };
    result.set(date, [...(result.get(date) ?? []), item]);
  }
  return result;
}

/** "hoy", "mañana", "en 5 días". */
export function daysUntilLabel(days: number): string {
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} días`;
}
