// Tipos del módulo de finanzas. Montos en BigInt (unidad mínima, con signo:
// negativo = sale plata, positivo = entra). Días como 'YYYY-MM-DD' y meses como 'YYYY-MM'.

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

export const FREQUENCIES = ['monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const SUPPORTED_CURRENCIES = ['CLP', 'USD', 'EUR'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export interface AccountRecord {
  id: string;
  name: string;
  kind: AccountKind;
  institution: string | null;
  last4: string | null;
  currency: string;
  creditLimit: bigint | null;
  billingDay: number | null;
  paymentDay: number | null;
  createdAt: Date;
}

export type AccountInput = Omit<AccountRecord, 'id' | 'createdAt'>;

export interface TransactionRecord {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: bigint;
  currency: string;
  kind: TransactionKind;
  category: Category | null;
  source: 'manual' | 'import';
  createdAt: Date;
}

export interface TransactionInput {
  accountId: string;
  date: string;
  description: string;
  amount: bigint;
  currency: string;
  kind: TransactionKind;
  category: Category | null;
}

export type TransactionChanges = Partial<Omit<TransactionInput, 'accountId' | 'currency'>>;

export interface InstallmentPlanRecord {
  id: string;
  accountId: string;
  description: string;
  purchaseDate: string;
  originalAmount: bigint;
  totalAmount: bigint;
  installmentCount: number;
  installmentAmount: bigint;
  /** Valor real de la última cuota si el banco lo informó; si no, se calcula. */
  lastInstallmentAmount: bigint | null;
  /** Mes en que se paga la cuota 1 ('YYYY-MM'). */
  firstDueMonth: string;
  currency: string;
  category: Category | null;
  createdAt: Date;
}

export type InstallmentPlanInput = Omit<InstallmentPlanRecord, 'id' | 'createdAt'>;

export interface StatementRecord {
  id: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  totalBilled: bigint;
  minimumPayment: bigint;
  currency: string;
}

export type StatementInput = Omit<StatementRecord, 'id'>;

export interface SubscriptionRecord {
  id: string;
  name: string;
  amount: bigint;
  currency: string;
  frequency: Frequency;
  startDate: string;
  accountId: string | null;
  category: Category | null;
  active: boolean;
  /** Correo de la cuenta del servicio. Dato personal: nunca va a la bitácora. */
  email: string | null;
  notes: string | null;
  createdAt: Date;
}

export type SubscriptionInput = Omit<SubscriptionRecord, 'id' | 'createdAt'>;
