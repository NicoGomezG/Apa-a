// Salud fase B: recambios (lentes de contacto…) cada N días y medicamentos cada N horas.
import { daysBetween } from './salud.models';

export type TrackerKind = 'replacement' | 'medication';
export type TrackerEventKind = 'changed' | 'taken' | 'skipped';

export interface HealthTrackerEvent {
  id: string;
  kind: TrackerEventKind;
  /** Recambio: día en que se cambió. */
  day: string | null;
  /** Medicamento: n.º de toma desde la primera (0, 1, 2…). */
  doseNumber: number | null;
  createdAt: string;
}

export interface HealthTracker {
  id: string;
  kind: TrackerKind;
  name: string;
  everyDays: number | null;
  everyHours: number | null;
  /** 'HH:MM', hora local de la primera toma. */
  startTime: string | null;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  /** Los más recientes primero (el servidor manda los últimos 60). */
  events: HealthTrackerEvent[];
}

export type HealthTrackerPayload =
  | { kind: 'replacement'; name: string; everyDays: number; startDate: string; notes: string }
  | {
      kind: 'medication';
      name: string;
      everyHours: number;
      startTime: string;
      startDate: string;
      endDate: string | null;
      notes: string;
    };

/** Recambios frecuentes: un toque llena nombre y días. */
export const REPLACEMENT_PRESETS: { name: string; days: number; icon: string }[] = [
  { name: 'Lentes de contacto mensuales', days: 30, icon: 'fa-eye' },
  { name: 'Lentes de contacto quincenales', days: 15, icon: 'fa-eye' },
  { name: 'Estuche de lentes', days: 90, icon: 'fa-box' },
  { name: 'Cepillo de dientes', days: 90, icon: 'fa-tooth' },
  { name: 'Filtro de agua', days: 180, icon: 'fa-filter' },
];

export const HOUR_OPTIONS = [4, 6, 8, 12, 24];
export const DURATION_OPTIONS = [3, 5, 7, 10, 14];

export function replacementIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('lente') || lower.includes('ojo')) return 'fa-eye';
  if (lower.includes('cepillo') || lower.includes('dient')) return 'fa-tooth';
  if (lower.includes('filtro')) return 'fa-filter';
  return REPLACEMENT_PRESETS.find((item) => item.name === name)?.icon ?? 'fa-rotate';
}

// --- Fechas y horas -------------------------------------------------------------------

const MINUTES_PER_DAY = 1440;
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
const fromDayNumber = (value: number) => new Date(value * 86_400_000).toISOString().slice(0, 10);

export function addDays(day: string, count: number): string {
  return fromDayNumber(dayNumber(day) + count);
}

export const timeToMinute = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
};
export const minuteToTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Día y minuto del día (hora de reloj) en una zona horaria. */
export function localNow(timeZone: string, now = new Date()): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Instante "de reloj" en minutos (sin zona): sirve para comparar y contar horas de reloj. */
const clock = (day: string, minute: number) => dayNumber(day) * MINUTES_PER_DAY + minute;

// --- Recambios -----------------------------------------------------------------------

export type ReplacementStatus = 'late' | 'due' | 'soon' | 'ok' | 'notStarted';

export interface ReplacementView {
  /** Último cambio registrado, o null si aún no se marca ninguno. */
  lastChange: HealthTrackerEvent | null;
  /** Desde cuándo corre el ciclo actual. */
  since: string;
  nextChange: string;
  /** Días hasta el próximo cambio (negativo = atrasado). */
  daysLeft: number;
  /** 0 a 1: cuánto del ciclo ya pasó. */
  progress: number;
  status: ReplacementStatus;
}

/** Días antes del cambio en que se avisa "se acerca". */
export const REPLACEMENT_SOON_DAYS = 3;

export function replacementView(tracker: HealthTracker, today: string): ReplacementView {
  const everyDays = tracker.everyDays ?? 1;
  const lastChange =
    tracker.events
      .filter((event) => event.kind === 'changed' && event.day)
      .sort((a, b) => b.day!.localeCompare(a.day!))[0] ?? null;
  const since = lastChange?.day && lastChange.day > tracker.startDate ? lastChange.day : tracker.startDate;
  const nextChange = addDays(since, everyDays);
  const daysLeft = daysBetween(today, nextChange);
  const elapsed = daysBetween(since, today);
  const progress = Math.min(1, Math.max(0, elapsed / everyDays));
  let status: ReplacementStatus;
  if (today < tracker.startDate) status = 'notStarted';
  else if (daysLeft < 0) status = 'late';
  else if (daysLeft === 0) status = 'due';
  else status = daysLeft <= Math.min(REPLACEMENT_SOON_DAYS, everyDays - 1) ? 'soon' : 'ok';
  return { lastChange, since, nextChange, daysLeft, progress, status };
}

// --- Medicamentos --------------------------------------------------------------------

/**
 * Cantidad de tomas de un tratamiento con término, o null si no tiene.
 * Copia de `lastDoseNumber` (+1) en `backend/src/modules/health/health.trackers.routes.ts`.
 */
export function doseCount(tracker: Pick<HealthTracker, 'everyHours' | 'startTime' | 'startDate' | 'endDate'>): number | null {
  if (!tracker.endDate || !tracker.everyHours || !tracker.startTime) return null;
  const minutes = (dayNumber(tracker.endDate) - dayNumber(tracker.startDate)) * MINUTES_PER_DAY + 1439 - timeToMinute(tracker.startTime);
  return Math.floor(minutes / (tracker.everyHours * 60)) + 1;
}

export type DoseStatus = 'taken' | 'skipped' | 'due' | 'upcoming';

export interface Dose {
  number: number;
  day: string;
  time: string;
  status: DoseStatus;
  event: HealthTrackerEvent | null;
}

/** Día y hora de la toma n.º `number`. */
export function doseAt(tracker: HealthTracker, number: number): { day: string; minute: number } {
  const total = clock(tracker.startDate, timeToMinute(tracker.startTime ?? '00:00')) + number * (tracker.everyHours ?? 24) * 60;
  return { day: fromDayNumber(Math.floor(total / MINUTES_PER_DAY)), minute: total % MINUTES_PER_DAY };
}

function doseFor(tracker: HealthTracker, number: number, now: { day: string; minute: number }): Dose {
  const at = doseAt(tracker, number);
  const event = tracker.events.find((item) => item.doseNumber === number) ?? null;
  const past = clock(at.day, at.minute) <= clock(now.day, now.minute);
  const status: DoseStatus = event ? (event.kind === 'skipped' ? 'skipped' : 'taken') : past ? 'due' : 'upcoming';
  return { number, day: at.day, time: minuteToTime(at.minute), status, event };
}

/** Tomas de un día (de 00:00 a 23:59), dentro del tratamiento. */
export function dosesOn(tracker: HealthTracker, day: string, now: { day: string; minute: number }): Dose[] {
  if (!tracker.everyHours || !tracker.startTime) return [];
  const step = tracker.everyHours * 60;
  const start = clock(tracker.startDate, timeToMinute(tracker.startTime));
  const first = Math.max(0, Math.ceil((clock(day, 0) - start) / step));
  const total = doseCount(tracker);
  const last = Math.min(Math.floor((clock(day, MINUTES_PER_DAY - 1) - start) / step), total === null ? Infinity : total - 1);
  const doses: Dose[] = [];
  for (let number = first; number <= last; number += 1) doses.push(doseFor(tracker, number, now));
  return doses;
}

/** Próxima toma sin marcar desde ahora (o null si el tratamiento terminó). */
export function nextDose(tracker: HealthTracker, now: { day: string; minute: number }): Dose | null {
  if (!tracker.everyHours || !tracker.startTime) return null;
  const step = tracker.everyHours * 60;
  const start = clock(tracker.startDate, timeToMinute(tracker.startTime));
  const number = Math.max(0, Math.ceil((clock(now.day, now.minute) - start) / step));
  const total = doseCount(tracker);
  if (total !== null && number >= total) return null;
  return doseFor(tracker, number, now);
}

export type MedicationPhase = 'notStarted' | 'active' | 'finished';

export function medicationPhase(tracker: HealthTracker, today: string): MedicationPhase {
  if (today < tracker.startDate) return 'notStarted';
  if (tracker.endDate && today > tracker.endDate) return 'finished';
  return 'active';
}

/** "Día 3 de 7" (o solo "Día 3" si no tiene término). */
export function treatmentDay(tracker: HealthTracker, today: string): { day: number; of: number | null } {
  return {
    day: daysBetween(tracker.startDate, today) + 1,
    of: tracker.endDate ? daysBetween(tracker.startDate, tracker.endDate) + 1 : null,
  };
}

export function everyHoursLabel(hours: number): string {
  if (hours === 24) return 'Una vez al día';
  if (hours === 12) return 'Cada 12 horas';
  if (hours % 24 === 0) return `Cada ${hours / 24} días`;
  return hours === 1 ? 'Cada 1 hora' : `Cada ${hours} horas`;
}

export function everyDaysLabel(days: number): string {
  if (days === 1) return 'Todos los días';
  if (days === 7) return 'Cada semana';
  if (days === 30) return 'Cada 30 días';
  return `Cada ${days} días`;
}
