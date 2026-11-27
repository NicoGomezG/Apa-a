// Modelos de Finanzas tal como llegan de la API. El dinero viene como string
// (unidad mínima, con signo) para no perder precisión: se opera con BigInt.

export const ACCOUNT_KINDS = ['checking', 'savings', 'credit_card', 'cash', 'other'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const TRANSACTION_KINDS = ['expense', 'income', 'transfer', 'card_payment'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const CATEGORIES = [
  'supermercado',
  'comida',
  'transporte',
  'hogar',
  'salud',
  'entretencion',
  'compras',
  'suscripciones',
  'educacion',
  'viajes',
  'transferencias',
  'comisiones',
  'ingresos',
  'otros',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CURRENCIES = ['CLP', 'USD', 'EUR'] as const;
export type Frequency = 'monthly' | 'yearly';

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  checking: 'Cuenta corriente',
  savings: 'Cuenta vista o ahorro',
  credit_card: 'Tarjeta de crédito',
  cash: 'Efectivo',
  other: 'Otra',
};

export const ACCOUNT_KIND_ICONS: Record<AccountKind, string> = {
  checking: 'fa-building-columns',
  savings: 'fa-piggy-bank',
  credit_card: 'fa-credit-card',
  cash: 'fa-money-bill-wave',
  other: 'fa-wallet',
};

export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  transfer: 'Entre mis cuentas',
  card_payment: 'Pago de tarjeta o línea',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  supermercado: 'Supermercado',
  comida: 'Comida y restaurantes',
  transporte: 'Transporte',
  hogar: 'Hogar y servicios',
  salud: 'Salud',
  entretencion: 'Entretención',
  compras: 'Compras',
  suscripciones: 'Suscripciones',
  educacion: 'Educación',
  viajes: 'Viajes',
  transferencias: 'Transferencias a terceros',
  comisiones: 'Comisiones, intereses y seguros',
  ingresos: 'Ingresos',
  otros: 'Otros',
};

export const CATEGORY_ICONS: Record<Category, string> = {
  supermercado: 'fa-basket-shopping',
  comida: 'fa-utensils',
  transporte: 'fa-bus',
  hogar: 'fa-house-chimney',
  salud: 'fa-kit-medical',
  entretencion: 'fa-ticket',
  compras: 'fa-bag-shopping',
  suscripciones: 'fa-repeat',
  educacion: 'fa-graduation-cap',
  viajes: 'fa-plane',
  transferencias: 'fa-right-left',
  comisiones: 'fa-percent',
  ingresos: 'fa-arrow-trend-up',
  otros: 'fa-circle-question',
};

export const categoryLabel = (category: string | null) =>
  CATEGORY_LABELS[(category ?? 'otros') as Category] ?? CATEGORY_LABELS.otros;
export const categoryIcon = (category: string | null) =>
  CATEGORY_ICONS[(category ?? 'otros') as Category] ?? CATEGORY_ICONS.otros;

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  institution: string | null;
  last4: string | null;
  currency: string;
  creditLimit: string | null;
  billingDay: number | null;
  paymentDay: number | null;
  createdAt: string;
}

export interface AccountPayload {
  name: string;
  kind: AccountKind;
  institution: string | null;
  last4: string | null;
  currency?: string;
  creditLimit: string | null;
  billingDay: number | null;
  paymentDay: number | null;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: string;
  currency: string;
  kind: TransactionKind;
  category: Category | null;
  source: 'manual' | 'import';
}

export interface TransactionPayload {
  accountId: string;
  date: string;
  description: string;
  amount: string;
  kind: TransactionKind;
  category: Category | null;
}

export interface InstallmentPlan {
  id: string;
  accountId: string;
  description: string;
  purchaseDate: string;
  originalAmount: string;
  totalAmount: string;
  installmentCount: number;
  installmentAmount: string;
  firstDueMonth: string;
  currency: string;
  category: Category | null;
  status: {
    paidCount: number;
    remaining: string;
    next: { number: number; month: string; amount: string } | null;
    lastMonth: string;
    finished: boolean;
  };
}

export interface Subscription {
  id: string;
  name: string;
  amount: string;
  currency: string;
  frequency: Frequency;
  startDate: string;
  accountId: string | null;
  category: Category | null;
  active: boolean;
  email: string | null;
  notes: string | null;
}

export interface SubscriptionPayload {
  name: string;
  amount: string;
  currency: string;
  frequency: Frequency;
  startDate: string;
  accountId: string | null;
  category: Category | null;
  active: boolean;
  email: string | null;
  notes: string | null;
}

export interface Statement {
  id: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  totalBilled: string;
  minimumPayment: string;
  currency: string;
}

export interface UpcomingPayment {
  date: string;
  type: 'card' | 'subscription' | 'bill';
  label: string;
  amount: string;
  currency: string;
  estimated: boolean;
  accountId: string | null;
}

export interface FinanceSummary {
  month: string;
  today: string;
  currency: string;
  spent: {
    total: string;
    installments: string;
    income: string;
    byCategory: { category: string; amount: string }[];
    byAccount: { accountId: string; amount: string }[];
  };
  installments: {
    planId: string;
    accountId: string;
    description: string;
    number: number;
    count: number;
    amount: string;
    currency: string;
    category: Category | null;
  }[];
  /** `subscriptions` ya incluye lo convertido desde otras monedas (`converted`). */
  base: { month: string; subscriptions: string; converted: string; bills: string; installments: string; total: string }[];
  /** Suscripciones del mes en otra moneda; `converted` = equivalente en pesos, null si no hubo tipo de cambio. */
  foreignSubscriptions: {
    currency: string;
    amount: string;
    converted: string | null;
    /** Pesos por unidad × 1.000.000 y fecha del valor publicado. */
    rate: { micros: string; date: string } | null;
  }[];
  cards: {
    accountId: string;
    name: string;
    institution: string | null;
    last4: string | null;
    currency: string;
    creditLimit: string | null;
    cycle: {
      start: string;
      end: string;
      dueDate: string;
      purchases: string;
      installments: string;
      total: string;
    } | null;
    lastStatement: Statement | null;
  }[];
  upcoming: UpcomingPayment[];
}

export interface ImportPayload {
  accountId: string;
  movements: { date: string; description: string; amount: string; kind: TransactionKind; category: Category | null }[];
  installments: {
    description: string;
    purchaseDate: string;
    originalAmount: string;
    totalAmount: string;
    installmentCount: number;
    installmentAmount: string;
    currentNumber: number;
    currentDueMonth: string;
    category: Category | null;
  }[];
  statement: {
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    totalBilled: string;
    minimumPayment: string;
  } | null;
}

export interface ImportResult {
  transactionsCreated: number;
  transactionsSkipped: number;
  plansCreated: number;
  plansSkipped: number;
  statement: 'created' | 'updated' | null;
}

export type PaymentStatus = 'paid' | 'pending' | 'unconfirmed';

export interface CalendarPayment {
  key: string;
  date: string;
  type: 'card' | 'subscription' | 'bill';
  label: string;
  amount: string | null;
  currency: string;
  estimated: boolean;
  accountId: string | null;
  subscriptionId: string | null;
  billId: string | null;
  status: PaymentStatus;
  matchedTransaction: { id: string; date: string } | null;
  installments: FinanceSummary['installments'];
}

export interface FinanceCalendar {
  month: string;
  today: string;
  payments: CalendarPayment[];
}

// --- Lista base de tarjetas y cuentas --------------------------------------------

export interface AccountPreset {
  key: string;
  name: string;
  kind: AccountKind;
  institution: string;
}

/** Medios de pago comunes en Chile, para crear la cuenta con un clic. */
export const ACCOUNT_PRESETS: AccountPreset[] = [
  { key: 'cmr-credito', name: 'CMR crédito', kind: 'credit_card', institution: 'Banco Falabella' },
  { key: 'santander-credito', name: 'Santander crédito', kind: 'credit_card', institution: 'Santander' },
  { key: 'banco-chile', name: 'Banco de Chile', kind: 'checking', institution: 'Banco de Chile' },
  { key: 'bancoestado-debito', name: 'BancoEstado débito', kind: 'savings', institution: 'BancoEstado' },
  { key: 'banco-chile-credito', name: 'Banco de Chile crédito', kind: 'credit_card', institution: 'Banco de Chile' },
  { key: 'santander-debito', name: 'Santander débito', kind: 'checking', institution: 'Santander' },
  { key: 'mach', name: 'MACH', kind: 'savings', institution: 'MACH' },
  { key: 'mercadopago', name: 'Mercado Pago', kind: 'savings', institution: 'Mercado Pago' },
];

const normalizeName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Cuentas de la lista base que la persona todavía no tiene (comparando por nombre). */
export function missingPresets(accounts: Pick<Account, 'name'>[]): AccountPreset[] {
  const names = new Set(accounts.map((account) => normalizeName(account.name)));
  return ACCOUNT_PRESETS.filter((preset) => !names.has(normalizeName(preset.name)));
}

export function presetPayload(preset: AccountPreset): AccountPayload {
  return {
    name: preset.name,
    kind: preset.kind,
    institution: preset.institution,
    last4: null,
    creditLimit: null,
    billingDay: null,
    paymentDay: null,
  };
}

/** Tipo de cambio a CLP. Valores en pesos por unidad × 1.000.000 (texto, para no perder precisión). */
export interface ExchangeRate {
  currency: string;
  micros: string;
  date: string;
  previous?: { micros: string; date: string };
}

// --- Deudas (me deben / debo) -------------------------------------------------------

export type DebtDirection = 'owed_to_me' | 'i_owe';

export interface DebtPayment {
  id: string;
  amount: string;
  date: string;
}

export interface Debt {
  id: string;
  direction: DebtDirection;
  contactId: string | null;
  personName: string;
  description: string | null;
  amount: string;
  currency: string;
  /** Desde cuándo se debe. */
  date: string;
  payments: DebtPayment[];
  paid: string;
  pending: string;
  status: 'pending' | 'paid';
  lastPaymentDate: string | null;
  /** Fecha del abono que dejó la deuda en cero. */
  paidAt: string | null;
}

export interface DebtPayload {
  direction: DebtDirection;
  contactId: string | null;
  personName: string | null;
  description: string | null;
  amount: string;
  currency: string;
  date: string;
}

// --- Cuentas fijas (agua, luz, internet…) -------------------------------------------

export const BILL_KINDS = [
  { key: 'agua', label: 'Agua', icon: 'fa-droplet' },
  { key: 'luz', label: 'Luz', icon: 'fa-bolt' },
  { key: 'gas', label: 'Gas', icon: 'fa-fire-flame-simple' },
  { key: 'internet', label: 'Internet', icon: 'fa-wifi' },
  { key: 'celular', label: 'Celular', icon: 'fa-mobile-screen' },
  { key: 'gastos_comunes', label: 'Gastos comunes', icon: 'fa-building' },
  { key: 'arriendo', label: 'Arriendo o dividendo', icon: 'fa-house' },
  { key: 'seguro', label: 'Seguro', icon: 'fa-shield-halved' },
  { key: 'educacion', label: 'Colegio o jardín', icon: 'fa-graduation-cap' },
  { key: 'tag', label: 'TAG / autopista', icon: 'fa-road' },
  { key: 'salud', label: 'Plan de salud', icon: 'fa-heart-pulse' },
  { key: 'otra', label: 'Otra', icon: 'fa-file-invoice-dollar' },
] as const;
export type BillKind = (typeof BILL_KINDS)[number]['key'];

export const BILL_EVERY_MONTHS = [
  { value: 1, label: 'Todos los meses' },
  { value: 2, label: 'Cada 2 meses' },
  { value: 12, label: 'Una vez al año' },
] as const;
export type BillEveryMonths = (typeof BILL_EVERY_MONTHS)[number]['value'];

/** Ícono de un pago según su tipo (tarjeta, suscripción o cuenta fija). */
export function paymentIcon(type: 'card' | 'subscription' | 'bill'): string {
  return type === 'card' ? 'fa-credit-card' : type === 'bill' ? 'fa-file-invoice-dollar' : 'fa-repeat';
}

export const PAYMENT_TYPE_LABELS = { card: 'Pago de tarjeta', subscription: 'Suscripción', bill: 'Cuenta fija' } as const;
export const PAYMENT_SHORT_LABELS = { card: 'Tarjeta', subscription: 'Suscripción', bill: 'Cuenta fija' } as const;

export function billKindIcon(kind: string): string {
  return BILL_KINDS.find((item) => item.key === kind)?.icon ?? 'fa-file-invoice-dollar';
}

export function billKindLabel(kind: string): string {
  return BILL_KINDS.find((item) => item.key === kind)?.label ?? 'Otra';
}

export interface BillPayment {
  id: string;
  /** 'YYYY-MM' */
  period: string;
  amount: string;
  paidOn: string;
}

/** paid: pagada este mes · pending: aún no vence · overdue: venció y no está anotada. */
export type BillStatus = 'paid' | 'pending' | 'overdue';

export interface Bill {
  id: string;
  name: string;
  kind: BillKind;
  company: string | null;
  /** Monto estimado que anotó la persona. */
  amount: string;
  currency: string;
  dueDay: number;
  everyMonths: BillEveryMonths;
  /** 'YYYY-MM' */
  startMonth: string;
  accountId: string | null;
  autopay: boolean;
  active: boolean;
  notes: string | null;
  /** Pagos, del más reciente al más antiguo. */
  payments: BillPayment[];
  /** Promedio de los últimos 3 pagos, o el monto anotado si aún no hay pagos. */
  estimate: string;
  /** Vencimiento en el mes consultado (null si ese mes no vence). */
  dueDate: string | null;
  payment: BillPayment | null;
  status: BillStatus | null;
  nextDue: { period: string; date: string } | null;
}

export interface BillPayload {
  name: string;
  kind: BillKind;
  company: string | null;
  amount: string;
  currency: string;
  dueDay: number;
  everyMonths: BillEveryMonths;
  startMonth?: string;
  accountId: string | null;
  autopay: boolean;
  active: boolean;
  notes: string | null;
}

export interface BillsMonth {
  month: string;
  today: string;
  currency: string;
  /** Moneda principal: lo esperado del mes (pagado o estimado), lo pagado y lo que falta. */
  totals: { expected: string; paid: string; pending: string };
  bills: Bill[];
}
