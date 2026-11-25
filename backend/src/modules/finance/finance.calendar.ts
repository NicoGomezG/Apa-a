import { addDays, cardCycleFor, dayInMonth, monthOf, subscriptionChargeIn } from './finance.dates.js';
import { installmentsIn, type InstallmentInMonth } from './finance.summary.js';
import type {
  AccountRecord,
  InstallmentPlanRecord,
  StatementRecord,
  SubscriptionRecord,
  TransactionRecord,
} from './finance.types.js';

/**
 * Pagos de un mes para la Agenda: cobros de suscripciones y vencimientos de tarjetas.
 * Cada pago se cruza con los movimientos importados para saber si ya aparece pagado.
 */

/** Ventana para encontrar el cargo de una suscripción alrededor de su día de cobro. */
export const SUBSCRIPTION_MATCH_DAYS = { before: 3, after: 7 };
/** Ventana para encontrar el pago de una tarjeta antes (o poco después) de su vencimiento. */
export const CARD_MATCH_DAYS = { before: 25, after: 5 };

export type PaymentStatus = 'paid' | 'pending' | 'unconfirmed';

export interface CalendarPayment {
  /** Identificador estable del pago: tipo, origen y fecha. */
  key: string;
  date: string;
  type: 'subscription' | 'card';
  label: string;
  /** null si no hay cómo estimarlo. */
  amount: bigint | null;
  currency: string;
  /** true si el monto es una proyección (sin estado de cuenta). */
  estimated: boolean;
  accountId: string | null;
  subscriptionId: string | null;
  /** paid: hay un movimiento que lo calza · pending: aún no vence · unconfirmed: venció y no aparece. */
  status: PaymentStatus;
  matchedTransaction: { id: string; date: string } | null;
  /** Cuotas que se pagan con este vencimiento de tarjeta. */
  installments: InstallmentInMonth[];
}

export interface CalendarInput {
  month: string;
  today: string;
  accounts: AccountRecord[];
  transactions: TransactionRecord[];
  plans: InstallmentPlanRecord[];
  subscriptions: SubscriptionRecord[];
  statements: StatementRecord[];
}

/** Rango de movimientos que necesita `computeCalendar` para el mes y el ciclo abierto. */
export function calendarTransactionRange(month: string, today: string): { from: string; to: string } {
  const first = `${month}-01`;
  const last = dayInMonth(month, 31);
  const from = [addDays(first, -CARD_MATCH_DAYS.before - 5), addDays(today, -40)].sort()[0]!;
  const to = [addDays(last, SUBSCRIPTION_MATCH_DAYS.after), addDays(today, 40)].sort()[1]!;
  return { from, to };
}

const between = (day: string, from: string, to: string) => day >= from && day <= to;

const abs = (value: bigint) => (value < 0n ? -value : value);

export function computeCalendar(input: CalendarInput): CalendarPayment[] {
  const { month, today } = input;
  const used = new Set<string>();
  const payments: CalendarPayment[] = [];

  const statusFor = (date: string, matched: TransactionRecord | undefined): PaymentStatus =>
    matched ? 'paid' : date >= today ? 'pending' : 'unconfirmed';

  const claim = (candidates: TransactionRecord[], date: string) => {
    // El más cercano a la fecha del pago, sin reutilizar un movimiento ya asignado.
    const match = candidates
      .filter((tx) => !used.has(tx.id))
      .sort((a, b) => Math.abs(dayNumber(a.date) - dayNumber(date)) - Math.abs(dayNumber(b.date) - dayNumber(date)))[0];
    if (match) used.add(match.id);
    return match;
  };

  // --- Tarjetas -------------------------------------------------------------
  for (const account of input.accounts) {
    if (account.kind !== 'credit_card') continue;
    const installments = installmentsIn(
      input.plans.filter((plan) => plan.accountId === account.id),
      month,
    );
    const installmentsTotal = installments.reduce((sum, item) => sum + item.amount, 0n);
    const statement = input.statements
      .filter((item) => item.accountId === account.id && monthOf(item.dueDate) === month)
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];

    let date: string;
    let amount: bigint | null;
    let estimated: boolean;
    if (statement) {
      date = statement.dueDate;
      amount = statement.totalBilled;
      estimated = false;
    } else if (account.paymentDay) {
      date = dayInMonth(month, account.paymentDay);
      // Ya pasó y no hay estado de cuenta: no hay nada que mostrar con honestidad.
      if (date < today) continue;
      estimated = true;
      amount = installmentsTotal;
      if (account.billingDay) {
        const cycle = cardCycleFor(today, account.billingDay, account.paymentDay);
        if (cycle.dueDate === date) {
          const purchases = input.transactions
            .filter((tx) => tx.accountId === account.id && tx.kind === 'expense' && between(tx.date, cycle.start, cycle.end))
            .reduce((sum, tx) => sum - tx.amount, 0n);
          amount = purchases + installmentsTotal;
        }
      }
      if (amount <= 0n) continue;
    } else {
      continue;
    }

    const matched =
      statement && statement.totalBilled > 0n
        ? claim(
            input.transactions.filter(
              (tx) =>
                tx.kind === 'card_payment' &&
                tx.currency === statement.currency &&
                abs(tx.amount) === statement.totalBilled &&
                between(tx.date, addDays(date, -CARD_MATCH_DAYS.before), addDays(date, CARD_MATCH_DAYS.after)),
            ),
            date,
          )
        : undefined;

    payments.push({
      key: `card:${account.id}:${date}`,
      date,
      type: 'card',
      label: account.name,
      amount,
      currency: statement?.currency ?? account.currency,
      estimated,
      accountId: account.id,
      subscriptionId: null,
      status: statusFor(date, matched),
      matchedTransaction: matched ? { id: matched.id, date: matched.date } : null,
      installments,
    });
  }

  // --- Suscripciones --------------------------------------------------------
  for (const sub of input.subscriptions) {
    if (!sub.active) continue;
    const date = subscriptionChargeIn(sub, month);
    if (!date || date < sub.startDate) continue;
    const matched = claim(
      input.transactions.filter(
        (tx) =>
          tx.kind === 'expense' &&
          tx.currency === sub.currency &&
          -tx.amount === sub.amount &&
          (sub.accountId === null || tx.accountId === sub.accountId) &&
          between(tx.date, addDays(date, -SUBSCRIPTION_MATCH_DAYS.before), addDays(date, SUBSCRIPTION_MATCH_DAYS.after)),
      ),
      date,
    );
    payments.push({
      key: `subscription:${sub.id}:${date}`,
      date,
      type: 'subscription',
      label: sub.name,
      amount: sub.amount,
      currency: sub.currency,
      estimated: false,
      accountId: sub.accountId,
      subscriptionId: sub.id,
      status: statusFor(date, matched),
      matchedTransaction: matched ? { id: matched.id, date: matched.date } : null,
      installments: [],
    });
  }

  return payments.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}
