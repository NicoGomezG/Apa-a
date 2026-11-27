import { convertToClp, type ExchangeRate } from '../../lib/exchange-rates.js';
import {
  addDays,
  addMonths,
  cardCycleFor,
  installmentDueIn,
  monthOf,
  nextSubscriptionCharge,
  subscriptionChargeIn,
} from './finance.dates.js';
import type {
  AccountRecord,
  Category,
  InstallmentPlanRecord,
  StatementRecord,
  SubscriptionRecord,
  TransactionRecord,
} from './finance.types.js';

export const BASE_MONTHS = 4;
export const UPCOMING_DAYS = 30;

export interface SummaryInput {
  /** Mes consultado ('YYYY-MM'). */
  month: string;
  /** Hoy en la zona horaria del usuario ('YYYY-MM-DD'). */
  today: string;
  /** Moneda principal: los totales se calculan solo en esta moneda. */
  currency: string;
  accounts: AccountRecord[];
  /** Debe cubrir el mes consultado y los ciclos abiertos de las tarjetas. */
  transactions: TransactionRecord[];
  plans: InstallmentPlanRecord[];
  subscriptions: SubscriptionRecord[];
  statements: StatementRecord[];
  /**
   * Tipos de cambio a la moneda principal (hoy solo a CLP). Las suscripciones en esas monedas
   * se suman convertidas al gasto base; las demás se informan aparte.
   */
  rates?: Map<string, ExchangeRate>;
}

export interface UpcomingPayment {
  date: string;
  type: 'card' | 'subscription';
  label: string;
  amount: bigint;
  currency: string;
  /** true si el monto es una estimación (ciclo de tarjeta aún sin facturar). */
  estimated: boolean;
  accountId: string | null;
}

/** Lo que una compra en cuotas aporta a un mes. */
export interface InstallmentInMonth {
  planId: string;
  accountId: string;
  description: string;
  number: number;
  count: number;
  amount: bigint;
  currency: string;
  category: Category | null;
}

export function installmentsIn(plans: InstallmentPlanRecord[], month: string): InstallmentInMonth[] {
  const result: InstallmentInMonth[] = [];
  for (const plan of plans) {
    const due = installmentDueIn(plan, month);
    if (!due) continue;
    result.push({
      planId: plan.id,
      accountId: plan.accountId,
      description: plan.description,
      number: due.number,
      count: plan.installmentCount,
      amount: due.amount,
      currency: plan.currency,
      category: plan.category,
    });
  }
  return result;
}

const between = (day: string, from: string, to: string) => day >= from && day <= to;

/**
 * Gasto de un conjunto de movimientos: solo `expense` (los traspasos entre cuentas
 * propias y los pagos de tarjeta no son gasto nuevo). Un gasto positivo es una
 * devolución y resta.
 */
function spentOf(transactions: TransactionRecord[]): bigint {
  return transactions.filter((tx) => tx.kind === 'expense').reduce((sum, tx) => sum - tx.amount, 0n);
}

export function computeSummary(input: SummaryInput) {
  const { month, today, currency } = input;
  const inCurrency = <T extends { currency: string }>(items: T[]) => items.filter((item) => item.currency === currency);

  // --- Gastado en el mes calendario -----------------------------------------
  const monthTransactions = inCurrency(input.transactions).filter((tx) => monthOf(tx.date) === month);
  const monthInstallments = inCurrency(installmentsIn(input.plans, month));

  const byCategory = new Map<string, bigint>();
  const byAccount = new Map<string, bigint>();
  const add = (map: Map<string, bigint>, key: string, amount: bigint) => map.set(key, (map.get(key) ?? 0n) + amount);

  for (const tx of monthTransactions) {
    if (tx.kind !== 'expense') continue;
    add(byCategory, tx.category ?? 'otros', -tx.amount);
    add(byAccount, tx.accountId, -tx.amount);
  }
  for (const item of monthInstallments) {
    add(byCategory, item.category ?? 'otros', item.amount);
    add(byAccount, item.accountId, item.amount);
  }

  const installmentsTotal = monthInstallments.reduce((sum, item) => sum + item.amount, 0n);
  const spentTotal = spentOf(monthTransactions) + installmentsTotal;
  const income = monthTransactions.filter((tx) => tx.kind === 'income').reduce((sum, tx) => sum + tx.amount, 0n);

  // --- Gasto base: suscripciones + cuotas, mes consultado y siguientes ------
  const activeSubscriptions = input.subscriptions.filter((sub) => sub.active);
  const rateFor = (code: string) => (currency === 'CLP' ? (input.rates?.get(code) ?? null) : null);
  /** Monto en la moneda principal: igual si ya lo está, convertido si hay tipo de cambio, null si no. */
  const inMain = (sub: SubscriptionRecord) => {
    if (sub.currency === currency) return sub.amount;
    const rate = rateFor(sub.currency);
    return rate ? convertToClp(sub.amount, sub.currency, rate) : null;
  };
  const base = Array.from({ length: BASE_MONTHS }, (_, offset) => {
    const target = addMonths(month, offset);
    let subscriptions = 0n;
    let converted = 0n;
    for (const sub of activeSubscriptions) {
      if (subscriptionChargeIn(sub, target) === null) continue;
      const amount = inMain(sub);
      if (amount === null) continue;
      subscriptions += amount;
      if (sub.currency !== currency) converted += amount;
    }
    const installments = inCurrency(installmentsIn(input.plans, target)).reduce((sum, item) => sum + item.amount, 0n);
    return { month: target, subscriptions, converted, installments, total: subscriptions + installments };
  });

  // Suscripciones del mes en otras monedas: con su equivalente si se pudo convertir.
  const foreignSubscriptions = new Map<string, bigint>();
  for (const sub of activeSubscriptions) {
    if (sub.currency === currency) continue;
    if (subscriptionChargeIn(sub, month) === null) continue;
    add(foreignSubscriptions, sub.currency, sub.amount);
  }
  const foreign = [...foreignSubscriptions].map(([code, amount]) => {
    const rate = rateFor(code);
    return {
      currency: code,
      amount,
      converted: rate ? convertToClp(amount, code, rate) : null,
      rate: rate ? { micros: rate.micros, date: rate.date } : null,
    };
  });

  // --- Tarjetas: ciclo abierto y último estado de cuenta --------------------
  const cards = input.accounts
    .filter((account) => account.kind === 'credit_card')
    .map((account) => {
      const statements = input.statements
        .filter((statement) => statement.accountId === account.id)
        .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
      const lastStatement = statements[0] ?? null;

      let cycle = null;
      if (account.billingDay && account.paymentDay) {
        const { start, end, dueDate } = cardCycleFor(today, account.billingDay, account.paymentDay);
        const purchases = spentOf(
          input.transactions.filter((tx) => tx.accountId === account.id && between(tx.date, start, end)),
        );
        const installments = installmentsIn(
          input.plans.filter((plan) => plan.accountId === account.id),
          monthOf(dueDate),
        ).reduce((sum, item) => sum + item.amount, 0n);
        cycle = { start, end, dueDate, purchases, installments, total: purchases + installments };
      }

      return {
        accountId: account.id,
        name: account.name,
        institution: account.institution,
        last4: account.last4,
        currency: account.currency,
        creditLimit: account.creditLimit,
        cycle,
        lastStatement,
      };
    });

  // --- Próximos pagos (30 días) ---------------------------------------------
  const horizon = addDays(today, UPCOMING_DAYS);
  const upcoming: UpcomingPayment[] = [];
  for (const card of cards) {
    const statement = card.lastStatement;
    const statementPending = statement !== null && between(statement.dueDate, today, horizon);
    if (statement && statementPending) {
      upcoming.push({
        date: statement.dueDate,
        type: 'card',
        label: card.name,
        amount: statement.totalBilled,
        currency: statement.currency,
        estimated: false,
        accountId: card.accountId,
      });
    }
    const cycle = card.cycle;
    const cycleAlreadyBilled = statement !== null && statement.dueDate === cycle?.dueDate;
    if (cycle && !cycleAlreadyBilled && between(cycle.dueDate, today, horizon) && cycle.total > 0n) {
      upcoming.push({
        date: cycle.dueDate,
        type: 'card',
        label: card.name,
        amount: cycle.total,
        currency: card.currency,
        estimated: true,
        accountId: card.accountId,
      });
    }
  }
  for (const sub of activeSubscriptions) {
    const next = nextSubscriptionCharge(sub, today);
    if (!between(next, today, horizon)) continue;
    upcoming.push({
      date: next,
      type: 'subscription',
      label: sub.name,
      amount: sub.amount,
      currency: sub.currency,
      estimated: false,
      accountId: sub.accountId,
    });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));

  return {
    month,
    today,
    currency,
    spent: {
      total: spentTotal,
      installments: installmentsTotal,
      income,
      byCategory: [...byCategory].map(([category, amount]) => ({ category, amount })).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0)),
      byAccount: [...byAccount].map(([accountId, amount]) => ({ accountId, amount })),
    },
    installments: monthInstallments,
    base,
    foreignSubscriptions: foreign,
    cards,
    upcoming,
  };
}

export type FinanceSummary = ReturnType<typeof computeSummary>;
