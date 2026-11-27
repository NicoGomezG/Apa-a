import { addMonths, dayInMonth, monthDiff, monthOf } from '../finance/finance.dates.js';
import type { BillPaymentRecord, BillRecord } from './bills.repository.js';

/** Cuántos pagos recientes se promedian para estimar el próximo. */
export const ESTIMATE_PAYMENTS = 3;

type Schedule = Pick<BillRecord, 'dueDay' | 'everyMonths' | 'startMonth'>;

/** Día de vencimiento en `month` ('YYYY-MM'), o null si ese mes no vence. */
export function billDueIn(bill: Schedule, month: string): string | null {
  const diff = monthDiff(bill.startMonth, month);
  if (diff < 0 || diff % bill.everyMonths !== 0) return null;
  return dayInMonth(month, bill.dueDay);
}

/**
 * Monto esperado: el promedio de los últimos pagos (agua y luz cambian cada mes) o, si aún
 * no hay pagos, el estimado que anotó la persona. Redondeado al entero más cercano.
 */
export function billEstimate(bill: Pick<BillRecord, 'amount' | 'payments'>): bigint {
  const recent = [...bill.payments].sort((a, b) => b.period.localeCompare(a.period)).slice(0, ESTIMATE_PAYMENTS);
  if (recent.length === 0) return bill.amount;
  const count = BigInt(recent.length);
  const sum = recent.reduce((total, payment) => total + payment.amount, 0n);
  return (sum * 2n + count) / (count * 2n);
}

export function paymentFor(bill: Pick<BillRecord, 'payments'>, month: string): BillPaymentRecord | null {
  return bill.payments.find((payment) => payment.period === month) ?? null;
}

/** Lo que la cuenta aporta a un mes: lo pagado si ya se pagó, si no el estimado. */
export function billAmountIn(bill: BillRecord, month: string): { amount: bigint; paid: boolean } | null {
  if (!bill.active || billDueIn(bill, month) === null) return null;
  const payment = paymentFor(bill, month);
  return payment ? { amount: payment.amount, paid: true } : { amount: billEstimate(bill), paid: false };
}

export type BillStatus = 'paid' | 'pending' | 'overdue';

export function billStatus(bill: BillRecord, month: string, today: string): BillStatus | null {
  const due = billDueIn(bill, month);
  if (due === null) return null;
  if (paymentFor(bill, month)) return 'paid';
  return due < today ? 'overdue' : 'pending';
}

/** Próximo vencimiento sin pagar desde `today` (incluye los vencidos de este mes). */
export function nextUnpaidDue(bill: BillRecord, today: string): { period: string; date: string } | null {
  if (!bill.active) return null;
  let month = monthOf(today);
  for (let i = 0; i <= 13; i += 1) {
    const date = billDueIn(bill, month);
    if (date && !paymentFor(bill, month) && (date >= today || i === 0)) return { period: month, date };
    month = addMonths(month, 1);
  }
  return null;
}
