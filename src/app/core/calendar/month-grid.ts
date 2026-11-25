import { weekday } from './holidays-cl';

export interface GridDay {
  /** 'YYYY-MM-DD' */
  date: string;
  day: number;
  /** false para los días del mes anterior o siguiente que completan la semana. */
  inMonth: boolean;
  /** 0 = domingo … 6 = sábado */
  weekday: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Semanas (lunes a domingo, como se usa en Chile) que cubren un mes 'YYYY-MM'. */
export function monthGrid(month: string): GridDay[][] {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const firstWeekday = weekday(year, monthNumber, 1);
  const offset = (firstWeekday + 6) % 7; // días desde el lunes
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;

  const weeks: GridDay[][] = [];
  for (let cell = 0; cell < totalCells; cell += 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, 1 - offset + cell));
    const day: GridDay = {
      date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthNumber - 1,
      weekday: date.getUTCDay(),
    };
    if (cell % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]!.push(day);
  }
  return weeks;
}

export const WEEKDAY_LABELS = [
  { short: 'Lun', long: 'lunes' },
  { short: 'Mar', long: 'martes' },
  { short: 'Mié', long: 'miércoles' },
  { short: 'Jue', long: 'jueves' },
  { short: 'Vie', long: 'viernes' },
  { short: 'Sáb', long: 'sábado' },
  { short: 'Dom', long: 'domingo' },
];
