// Feriados legales nacionales de Chile, calculados por año según la ley:
// fijos, Semana Santa, los que se corren a lunes (Ley 19.668), el de las Iglesias
// Evangélicas (Ley 20.299), los "sándwich" de Fiestas Patrias (Ley 20.215) y el
// Día de los Pueblos Indígenas en el solsticio de invierno (Ley 21.357).
// No incluye feriados regionales ni los de elecciones, que se fijan cada vez por ley.

export interface Holiday {
  /** 'YYYY-MM-DD' */
  date: string;
  name: string;
  /** Irrenunciable para el comercio (Ley 19.973). */
  irrenunciable: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

/** Día de la semana (0 = domingo) de un día del calendario, sin zonas horarias. */
export function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function shift(year: number, month: number, day: number, delta: number): string {
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return date.toISOString().slice(0, 10);
}

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/**
 * Ley 19.668: si cae martes, miércoles o jueves se corre al lunes de esa semana;
 * si cae viernes, al lunes siguiente. Lunes, sábado y domingo se mantienen.
 */
function mondayRule(year: number, month: number, day: number): string {
  const dow = weekday(year, month, day);
  if (dow >= 2 && dow <= 4) return shift(year, month, day, -(dow - 1));
  if (dow === 5) return shift(year, month, day, 3);
  return iso(year, month, day);
}

/** Ley 20.299: si el 31 de octubre cae martes, se corre al viernes 27; si cae miércoles, al viernes 2 de noviembre. */
function evangelicalDay(year: number): string {
  const dow = weekday(year, 10, 31);
  if (dow === 2) return iso(year, 10, 27);
  if (dow === 3) return iso(year, 11, 2);
  return iso(year, 10, 31);
}

// Solsticio de invierno austral en hora de Chile continental (UTC-4 en junio).
const SOLSTICE_DAY: Record<number, number> = {
  2021: 21, 2022: 21, 2023: 21, 2024: 20, 2025: 20, 2026: 21, 2027: 21, 2028: 20,
  2029: 20, 2030: 21, 2031: 21, 2032: 20, 2033: 20, 2034: 21, 2035: 21,
};

/** Día del solsticio de junio. Fuera de la tabla se aproxima con el año medio trópico. */
export function juneSolsticeDay(year: number): number {
  const known = SOLSTICE_DAY[year];
  if (known) return known;
  // Solsticio de 2000: 21-jun 01:48 UTC. Avanza ~365,2422 días por año.
  const base = Date.UTC(2000, 5, 21, 1, 48);
  const instant = base + (year - 2000) * 365.24219 * 86_400_000 - 4 * 3_600_000;
  return new Date(instant).getUTCDate();
}

const cache = new Map<number, Holiday[]>();

export function chileanHolidays(year: number): Holiday[] {
  const cached = cache.get(year);
  if (cached) return cached;

  const list: Holiday[] = [];
  const add = (date: string, name: string, irrenunciable = false) => list.push({ date, name, irrenunciable });

  const easter = easterSunday(year);
  const [ey, em, ed] = easter.split('-').map(Number) as [number, number, number];

  add(iso(year, 1, 1), 'Año Nuevo', true);
  add(shift(ey, em, ed, -2), 'Viernes Santo');
  add(shift(ey, em, ed, -1), 'Sábado Santo');
  add(iso(year, 5, 1), 'Día Nacional del Trabajo', true);
  add(iso(year, 5, 21), 'Día de las Glorias Navales');
  if (year >= 2021) add(iso(year, 6, juneSolsticeDay(year)), 'Día Nacional de los Pueblos Indígenas');
  add(mondayRule(year, 6, 29), 'San Pedro y San Pablo');
  add(iso(year, 7, 16), 'Día de la Virgen del Carmen');
  add(iso(year, 8, 15), 'Asunción de la Virgen');
  if (weekday(year, 9, 17) === 1) add(iso(year, 9, 17), 'Fiestas Patrias (feriado adicional)');
  add(iso(year, 9, 18), 'Independencia Nacional', true);
  add(iso(year, 9, 19), 'Día de las Glorias del Ejército', true);
  if (weekday(year, 9, 20) === 5) add(iso(year, 9, 20), 'Fiestas Patrias (feriado adicional)');
  add(mondayRule(year, 10, 12), 'Encuentro de Dos Mundos');
  add(evangelicalDay(year), 'Día de las Iglesias Evangélicas y Protestantes');
  add(iso(year, 11, 1), 'Día de Todos los Santos');
  add(iso(year, 12, 8), 'Inmaculada Concepción');
  add(iso(year, 12, 25), 'Navidad', true);

  list.sort((a, b) => a.date.localeCompare(b.date));
  cache.set(year, list);
  return list;
}

/** Feriados de un mes ('YYYY-MM'), indexados por día. */
export function holidaysInMonth(month: string): Map<string, Holiday> {
  const year = Number(month.slice(0, 4));
  const result = new Map<string, Holiday>();
  for (const holiday of chileanHolidays(year)) {
    if (holiday.date.startsWith(month)) result.set(holiday.date, holiday);
  }
  return result;
}

/** Próximo feriado desde `today` (inclusive). */
export function nextHoliday(today: string): Holiday | null {
  const year = Number(today.slice(0, 4));
  for (const candidate of [...chileanHolidays(year), ...chileanHolidays(year + 1)]) {
    if (candidate.date >= today) return candidate;
  }
  return null;
}
