import type { Category, TransactionKind } from '../finance.models';

export type ImportSource = 'banco-chile-cartola' | 'cmr-falabella' | 'santander-tarjeta';

export interface ParsedMovement {
  date: string;
  description: string;
  /** Unidad mínima con signo: negativo = sale plata de la cuenta (o cargo en la tarjeta). */
  amount: bigint;
  kind: TransactionKind;
  category: Category | null;
}

export interface ParsedInstallment {
  description: string;
  purchaseDate: string;
  originalAmount: bigint;
  totalAmount: bigint;
  installmentCount: number;
  installmentAmount: bigint;
  /** Cuota que aparece en este estado de cuenta (n de n/N)… */
  currentNumber: number;
  /** …y el mes en que se paga ('YYYY-MM'). */
  currentDueMonth: string;
  category: Category | null;
}

export interface ParsedStatement {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  totalBilled: bigint;
  minimumPayment: bigint;
  /** Tabla del banco "vencimientos próximos meses", normalizada a mes de pago. */
  upcoming: { month: string; amount: bigint }[];
}

export interface ParsedImport {
  source: ImportSource;
  institution: string;
  accountKind: 'checking' | 'credit_card';
  suggestedName: string;
  last4: string | null;
  currency: 'CLP';
  creditLimit: bigint | null;
  movements: ParsedMovement[];
  installments: ParsedInstallment[];
  statement: ParsedStatement | null;
}

/** Una línea de texto de un PDF, armada a partir de la posición de cada trozo. */
export interface PdfLine {
  page: number;
  text: string;
}

export class ImportError extends Error {}
