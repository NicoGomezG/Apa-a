// Salud: consultas con especialistas y próximos controles.

export interface HealthVisit {
  id: string;
  specialty: string;
  professional: string | null;
  place: string | null;
  /** 'YYYY-MM-DD' (puede ser futuro: hora agendada). */
  visitDate: string;
  repeatMonths: RepeatMonths | null;
  nextDate: string | null;
  nextDone: boolean;
  notes: string | null;
  createdAt: string;
}

export type RepeatMonths = 1 | 6 | 12;

export interface HealthVisitPayload {
  specialty: string;
  professional: string;
  place: string;
  visitDate: string;
  repeatMonths: RepeatMonths | null;
  /** undefined = que lo calcule el servidor desde repeatMonths. */
  nextDate?: string | null;
  notes: string;
  completesVisitId?: string;
}

/** Especialidades base (también se puede escribir otra). */
export const SPECIALTIES: { name: string; icon: string }[] = [
  { name: 'Medicina general', icon: 'fa-stethoscope' },
  { name: 'Oftalmología', icon: 'fa-eye' },
  { name: 'Pediatría', icon: 'fa-baby' },
  { name: 'Odontología', icon: 'fa-tooth' },
  { name: 'Dermatología', icon: 'fa-hand-dots' },
  { name: 'Ginecología', icon: 'fa-venus' },
  { name: 'Traumatología', icon: 'fa-bone' },
  { name: 'Cardiología', icon: 'fa-heart-pulse' },
  { name: 'Otorrinolaringología', icon: 'fa-ear-listen' },
  { name: 'Psicología', icon: 'fa-brain' },
  { name: 'Nutrición', icon: 'fa-apple-whole' },
  { name: 'Kinesiología', icon: 'fa-person-walking' },
];

export const specialtyIcon = (name: string) => SPECIALTIES.find((item) => item.name === name)?.icon ?? 'fa-user-doctor';

export const REPEAT_OPTIONS: { value: RepeatMonths; label: string }[] = [
  { value: 1, label: '1 mes' },
  { value: 6, label: '6 meses' },
  { value: 12, label: '1 año' },
];

/** Días para considerar que un control "se acerca". */
export const SOON_DAYS = 30;

export type ControlStatus = 'late' | 'soon' | 'ok';

export const CONTROL_STATUS_LABELS: Record<ControlStatus, string> = {
  late: 'Atrasado',
  soon: 'Se acerca',
  ok: 'Al día',
};

/**
 * Suma meses a un día 'YYYY-MM-DD'; si el mes destino es más corto, queda en su último día.
 * Copia de `addMonths` en `backend/src/modules/health/health.routes.ts`: si cambias una, cambia la otra.
 */
export function addMonths(date: string, months: number): string {
  const [year, month, dayOfMonth] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(dayOfMonth, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Días de `from` a `to` (negativo si `to` ya pasó). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function controlStatus(nextDate: string, today: string): ControlStatus {
  const days = daysBetween(today, nextDate);
  if (days < 0) return 'late';
  return days <= SOON_DAYS ? 'soon' : 'ok';
}

export function relativeDays(days: number): string {
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === -1) return 'ayer';
  return days > 0 ? `en ${days} días` : `hace ${-days} días`;
}

/** Controles pendientes (con fecha y sin "Ya fui"), del más próximo al más lejano. */
export function pendingControls(visits: HealthVisit[]): (HealthVisit & { nextDate: string })[] {
  return visits
    .filter((visit): visit is HealthVisit & { nextDate: string } => visit.nextDate !== null && !visit.nextDone)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}
