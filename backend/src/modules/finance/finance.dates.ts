// Aritmética de días y meses sobre strings ('YYYY-MM-DD' / 'YYYY-MM'), sin zonas
// horarias de por medio: un `date` de Postgres es un día del calendario, no un instante.

import type { Frequency, InstallmentPlanRecord, SubscriptionRecord } from './finance.types.js';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (value: number) => String(value).padStart(2, '0');

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** Suma meses a 'YYYY-MM'. */
export function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Cantidad de meses de `from` a `to` (positivo si `to` es posterior). */
export function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/** Día `day` del mes, ajustado al último día si el mes es más corto (31 → 30/28). */
export function dayInMonth(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

export function addDays(day: string, count: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + count));
  return date.toISOString().slice(0, 10);
}

export function firstDayOf(month: string): string {
  return `${month}-01`;
}

export function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${pad(daysInMonth(y, m))}`;
}

/** Día de hoy ('YYYY-MM-DD') en una zona horaria. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// --- Cuotas -----------------------------------------------------------------

export interface InstallmentDue {
  number: number;
  month: string;
  amount: bigint;
}

/**
 * Valor de la cuota `number` (1..N). Todas valen `installmentAmount` salvo la
 * última, que ajusta el redondeo: total − (N−1) × cuota. Es la regla que usan
 * CMR y Santander en sus tablas de "vencimientos próximos meses".
 */
export function installmentAmountFor(
  plan: Pick<InstallmentPlanRecord, 'totalAmount' | 'installmentCount' | 'installmentAmount'> &
    Partial<Pick<InstallmentPlanRecord, 'lastInstallmentAmount'>>,
  number: number,
): bigint {
  if (number < plan.installmentCount) return plan.installmentAmount;
  if (plan.lastInstallmentAmount) return plan.lastInstallmentAmount;
  const last = plan.totalAmount - plan.installmentAmount * BigInt(plan.installmentCount - 1);
  return last > 0n ? last : plan.installmentAmount;
}

/** La cuota que se paga en `month`, si la hay. */
export function installmentDueIn(
  plan: Pick<InstallmentPlanRecord, 'firstDueMonth' | 'totalAmount' | 'installmentCount' | 'installmentAmount'> &
    Partial<Pick<InstallmentPlanRecord, 'lastInstallmentAmount'>>,
  month: string,
): InstallmentDue | null {
  const number = monthDiff(plan.firstDueMonth, month) + 1;
  if (number < 1 || number > plan.installmentCount) return null;
  return { number, month, amount: installmentAmountFor(plan, number) };
}

/** Mes de la cuota 1 a partir de una cuota `number` que vence en `dueMonth`. */
export function firstDueMonthFrom(dueMonth: string, number: number): string {
  return addMonths(dueMonth, -(number - 1));
}

// --- Suscripciones ----------------------------------------------------------

/** Día de cobro de la suscripción en `month`, o null si ese mes no se cobra. */
export function subscriptionChargeIn(
  subscription: Pick<SubscriptionRecord, 'startDate' | 'frequency'>,
  month: string,
): string | null {
  const startMonth = monthOf(subscription.startDate);
  const diff = monthDiff(startMonth, month);
  if (diff < 0) return null;
  if (subscription.frequency === 'yearly' && diff % 12 !== 0) return null;
  return dayInMonth(month, Number(subscription.startDate.slice(8, 10)));
}

/** Próximo cobro en o después de `today`. */
export function nextSubscriptionCharge(
  subscription: Pick<SubscriptionRecord, 'startDate' | 'frequency'>,
  today: string,
): string {
  if (subscription.startDate >= today) return subscription.startDate;
  const step = subscription.frequency === 'yearly' ? 12 : 1;
  let month = monthOf(today);
  for (let i = 0; i < 24; i += 1) {
    const charge = subscriptionChargeIn(subscription, month);
    if (charge && charge >= today) return charge;
    month = addMonths(month, 1);
  }
  // Inalcanzable con step ≤ 12, pero se deja un valor razonable.
  return dayInMonth(addMonths(monthOf(today), step), Number(subscription.startDate.slice(8, 10)));
}

/** Monto mensual equivalente (anual / 12, redondeado hacia abajo). */
export function monthlyEquivalent(amount: bigint, frequency: Frequency): bigint {
  return frequency === 'yearly' ? amount / 12n : amount;
}

// --- Ciclo de facturación de tarjetas --------------------------------------

export interface CardCycle {
  start: string;
  end: string;
  dueDate: string;
}

/** Ciclo de facturación abierto en `today`, según el día de cierre y el de pago. */
export function cardCycleFor(today: string, billingDay: number, paymentDay: number): CardCycle {
  let end = dayInMonth(monthOf(today), billingDay);
  if (end < today) end = dayInMonth(addMonths(monthOf(today), 1), billingDay);
  const previousEnd = dayInMonth(addMonths(monthOf(end), -1), billingDay);
  const start = addDays(previousEnd, 1);
  let dueDate = dayInMonth(monthOf(end), paymentDay);
  if (dueDate <= end) dueDate = dayInMonth(addMonths(monthOf(end), 1), paymentDay);
  return { start, end, dueDate };
}
