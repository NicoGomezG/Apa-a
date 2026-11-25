import { describe, expect, it } from 'vitest';
import {
  addMonths,
  cardCycleFor,
  dayInMonth,
  firstDueMonthFrom,
  installmentDueIn,
  isValidDay,
  nextSubscriptionCharge,
  subscriptionChargeIn,
  todayIn,
} from './finance.dates.js';
import { computeSummary, installmentsIn } from './finance.summary.js';
import type {
  AccountRecord,
  InstallmentPlanRecord,
  StatementRecord,
  SubscriptionRecord,
  TransactionRecord,
} from './finance.types.js';

const created = new Date('2026-11-01T00:00:00Z');

const plan = (data: Partial<InstallmentPlanRecord> & Pick<InstallmentPlanRecord, 'totalAmount' | 'installmentCount' | 'installmentAmount' | 'firstDueMonth'>): InstallmentPlanRecord => ({
  id: `plan-${Math.random()}`,
  accountId: 'card',
  description: 'Compra',
  purchaseDate: '2026-09-01',
  originalAmount: data.totalAmount,
  lastInstallmentAmount: null,
  currency: 'CLP',
  category: null,
  createdAt: created,
  ...data,
});

const sumDue = (plans: InstallmentPlanRecord[], month: string) =>
  installmentsIn(plans, month).reduce((sum, item) => sum + item.amount, 0n);

describe('fechas', () => {
  it('suma meses cruzando el año', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2027-01', -2)).toBe('2026-11');
  });

  it('ajusta el día al último del mes', () => {
    expect(dayInMonth('2027-02', 31)).toBe('2027-02-28');
    expect(dayInMonth('2028-02', 30)).toBe('2028-02-29');
  });

  it('valida días reales', () => {
    expect(isValidDay('2026-11-25')).toBe(true);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('25/11/2026')).toBe(false);
  });

  it('calcula el día de hoy en la zona del usuario, no en UTC', () => {
    // 02:00 UTC del 26 = 23:00 del 25 en Santiago (UTC-3).
    expect(todayIn('America/Santiago', new Date('2026-11-26T02:00:00Z'))).toBe('2026-11-25');
  });
});

describe('cuotas (cuadran con las tablas de los bancos)', () => {
  // Estado de cuenta CMR, pagar hasta 05/12/2026.
  const cmr = [
    plan({ totalAmount: 169_500n, installmentCount: 6, installmentAmount: 28_250n, firstDueMonth: firstDueMonthFrom('2026-12', 3) }),
    plan({ totalAmount: 27_503n, installmentCount: 3, installmentAmount: 9_167n, firstDueMonth: firstDueMonthFrom('2026-12', 2) }),
    plan({ totalAmount: 54_990n, installmentCount: 3, installmentAmount: 18_330n, firstDueMonth: firstDueMonthFrom('2026-12', 3) }),
    // H&M: el banco cobró 19.250 en la 3/3 (no ajustó el redondeo); el estado de cuenta lo muestra.
    plan({ totalAmount: 57_746n, installmentCount: 3, installmentAmount: 19_250n, lastInstallmentAmount: 19_250n, firstDueMonth: firstDueMonthFrom('2026-12', 3) }),
  ];

  it('CMR: las cuotas de diciembre suman lo que cobró el banco', () => {
    // 18.330 + 19.250 + 28.250 + 9.167 = 74.997 (el resto del total son compras al contado y comisión).
    expect(sumDue(cmr, '2026-12')).toBe(74_997n);
  });

  it('si el banco informó la última cuota, se usa ese valor', () => {
    expect(installmentDueIn(cmr[3]!, '2026-12')?.amount).toBe(19_250n);
  });

  it('CMR: vencimientos de enero, febrero y marzo', () => {
    expect(sumDue(cmr, '2027-01')).toBe(37_419n);
    expect(sumDue(cmr, '2027-02')).toBe(28_250n);
    expect(sumDue(cmr, '2027-03')).toBe(28_250n);
    expect(sumDue(cmr, '2027-04')).toBe(0n);
  });

  it('la última cuota ajusta el redondeo: total − (N−1) × cuota', () => {
    const wevo = cmr[1]!;
    expect(installmentDueIn(wevo, '2026-12')?.amount).toBe(9_167n);
    expect(installmentDueIn(wevo, '2027-01')).toEqual({ number: 3, month: '2027-01', amount: 9_169n });
  });

  // Estado de cuenta Santander, pagar hasta 10/12/2026. Su tabla rotula por mes de
  // facturación ("diciembre" = se paga en enero).
  const santander = [
    plan({ totalAmount: 27_440n, installmentCount: 3, installmentAmount: 9_147n, firstDueMonth: firstDueMonthFrom('2026-12', 2) }),
    plan({ totalAmount: 92_933n, installmentCount: 3, installmentAmount: 30_978n, firstDueMonth: firstDueMonthFrom('2026-12', 1) }),
    plan({ totalAmount: 31_184n, installmentCount: 3, installmentAmount: 10_395n, firstDueMonth: firstDueMonthFrom('2026-12', 1) }),
  ];

  it('Santander: cuotas del mes y de los dos siguientes', () => {
    expect(sumDue(santander, '2026-12')).toBe(9_147n + 30_978n + 10_395n);
    expect(sumDue(santander, '2027-01')).toBe(50_519n);
    expect(sumDue(santander, '2027-02')).toBe(41_371n);
    expect(sumDue(santander, '2027-03')).toBe(0n);
  });
});

describe('ciclo de facturación de tarjetas', () => {
  it('CMR (cierra el 19, paga el 5)', () => {
    expect(cardCycleFor('2026-11-25', 19, 5)).toEqual({ start: '2026-11-20', end: '2026-12-19', dueDate: '2027-01-05' });
    expect(cardCycleFor('2026-11-19', 19, 5)).toEqual({ start: '2026-10-20', end: '2026-11-19', dueDate: '2026-12-05' });
  });

  it('Santander (cierra el 24, paga el 10)', () => {
    expect(cardCycleFor('2026-11-25', 24, 10)).toEqual({ start: '2026-11-25', end: '2026-12-24', dueDate: '2027-01-10' });
  });

  it('cierre a fin de mes en meses cortos', () => {
    expect(cardCycleFor('2027-02-10', 31, 15)).toEqual({ start: '2027-02-01', end: '2027-02-28', dueDate: '2027-03-15' });
  });
});

describe('suscripciones', () => {
  const monthly = { startDate: '2026-01-31', frequency: 'monthly' as const };
  const yearly = { startDate: '2026-03-15', frequency: 'yearly' as const };

  it('cobra cada mes desde su inicio, ajustando el día', () => {
    expect(subscriptionChargeIn(monthly, '2025-12')).toBeNull();
    expect(subscriptionChargeIn(monthly, '2027-02')).toBe('2027-02-28');
  });

  it('las anuales solo en su mes', () => {
    expect(subscriptionChargeIn(yearly, '2027-03')).toBe('2027-03-15');
    expect(subscriptionChargeIn(yearly, '2027-04')).toBeNull();
  });

  it('calcula el próximo cobro', () => {
    expect(nextSubscriptionCharge(monthly, '2026-11-25')).toBe('2026-11-30');
    expect(nextSubscriptionCharge(yearly, '2026-11-25')).toBe('2027-03-15');
    expect(nextSubscriptionCharge({ startDate: '2027-01-10', frequency: 'monthly' }, '2026-11-25')).toBe('2027-01-10');
  });
});

describe('resumen', () => {
  const account = (data: Partial<AccountRecord> & Pick<AccountRecord, 'id' | 'kind'>): AccountRecord => ({
    name: data.id,
    institution: null,
    last4: null,
    currency: 'CLP',
    creditLimit: null,
    billingDay: null,
    paymentDay: null,
    createdAt: created,
    ...data,
  });
  const tx = (data: Partial<TransactionRecord> & Pick<TransactionRecord, 'date' | 'amount' | 'kind'>): TransactionRecord => ({
    id: `tx-${Math.random()}`,
    accountId: 'bank',
    description: 'Movimiento',
    currency: 'CLP',
    category: null,
    source: 'import',
    createdAt: created,
    ...data,
  });
  const subscription = (data: Partial<SubscriptionRecord>): SubscriptionRecord => ({
    id: `sub-${Math.random()}`,
    name: 'Servicio',
    amount: 5_000n,
    currency: 'CLP',
    frequency: 'monthly',
    startDate: '2026-01-05',
    accountId: null,
    category: 'suscripciones',
    active: true,
    createdAt: created,
    ...data,
  });

  const base = {
    month: '2026-11',
    today: '2026-11-25',
    currency: 'CLP',
    accounts: [account({ id: 'bank', kind: 'checking' }), account({ id: 'card', kind: 'credit_card', billingDay: 19, paymentDay: 5 })],
    plans: [] as InstallmentPlanRecord[],
    subscriptions: [] as SubscriptionRecord[],
    statements: [] as StatementRecord[],
  };

  it('el gasto del mes no cuenta traspasos ni pagos de tarjeta, y suma las cuotas del mes', () => {
    const summary = computeSummary({
      ...base,
      plans: [plan({ totalAmount: 30_000n, installmentCount: 3, installmentAmount: 10_000n, firstDueMonth: '2026-11', category: 'compras' })],
      transactions: [
        tx({ date: '2026-11-03', amount: -20_000n, kind: 'expense', category: 'supermercado' }),
        tx({ date: '2026-11-04', amount: -5_000n, kind: 'expense', category: 'transporte', accountId: 'card' }),
        tx({ date: '2026-11-05', amount: -443_630n, kind: 'card_payment' }),
        tx({ date: '2026-11-06', amount: -50_000n, kind: 'transfer' }),
        tx({ date: '2026-11-07', amount: 1_200_000n, kind: 'income', category: 'ingresos' }),
        tx({ date: '2026-11-08', amount: 2_000n, kind: 'expense', category: 'supermercado' }), // devolución
        tx({ date: '2026-10-30', amount: -99_000n, kind: 'expense' }), // otro mes
        tx({ date: '2026-11-09', amount: -7_000n, kind: 'expense', currency: 'USD' }), // otra moneda
      ],
    });
    expect(summary.spent.total).toBe(20_000n + 5_000n - 2_000n + 10_000n);
    expect(summary.spent.installments).toBe(10_000n);
    expect(summary.spent.income).toBe(1_200_000n);
    expect(summary.spent.byCategory).toEqual([
      { category: 'supermercado', amount: 18_000n },
      { category: 'compras', amount: 10_000n },
      { category: 'transporte', amount: 5_000n },
    ]);
  });

  it('gasto base: suscripciones + cuotas del mes y los 3 siguientes', () => {
    const summary = computeSummary({
      ...base,
      transactions: [],
      plans: [plan({ totalAmount: 30_000n, installmentCount: 3, installmentAmount: 10_000n, firstDueMonth: '2026-12' })],
      subscriptions: [
        subscription({ amount: 9_000n }),
        subscription({ amount: 60_000n, frequency: 'yearly', startDate: '2026-01-15' }),
        subscription({ amount: 999n, currency: 'USD' }),
        subscription({ amount: 1_000n, active: false }),
      ],
    });
    expect(summary.base.map((row) => [row.month, row.subscriptions, row.installments, row.total])).toEqual([
      ['2026-11', 9_000n, 0n, 9_000n],
      ['2026-12', 9_000n, 10_000n, 19_000n],
      ['2027-01', 69_000n, 10_000n, 79_000n],
      ['2027-02', 9_000n, 10_000n, 19_000n],
    ]);
    expect(summary.foreignSubscriptions).toEqual([{ currency: 'USD', amount: 999n }]);
  });

  it('tarjeta: gasto del ciclo abierto, último estado y próximos pagos', () => {
    const summary = computeSummary({
      ...base,
      transactions: [
        tx({ accountId: 'card', date: '2026-11-19', amount: -3_000n, kind: 'expense' }), // ciclo anterior
        tx({ accountId: 'card', date: '2026-11-20', amount: -4_000n, kind: 'expense' }),
        tx({ accountId: 'card', date: '2026-11-24', amount: -6_000n, kind: 'expense' }),
      ],
      plans: [plan({ totalAmount: 30_000n, installmentCount: 3, installmentAmount: 10_000n, firstDueMonth: '2026-12' })],
      statements: [
        {
          id: 's1',
          accountId: 'card',
          periodStart: '2026-10-20',
          periodEnd: '2026-11-19',
          dueDate: '2026-12-05',
          totalBilled: 375_160n,
          minimumPayment: 38_850n,
          currency: 'CLP',
        },
      ],
      subscriptions: [subscription({ name: 'Música', startDate: '2026-03-01' })],
    });
    const card = summary.cards[0]!;
    expect(card.cycle).toEqual({
      start: '2026-11-20',
      end: '2026-12-19',
      dueDate: '2027-01-05',
      purchases: 10_000n,
      installments: 10_000n, // cuota 2 se paga en enero
      total: 20_000n,
    });
    expect(card.lastStatement?.totalBilled).toBe(375_160n);
    expect(summary.upcoming.map((item) => [item.date, item.label, item.amount, item.estimated])).toEqual([
      ['2026-12-01', 'Música', 5_000n, false],
      ['2026-12-05', 'card', 375_160n, false],
    ]);
  });
});
