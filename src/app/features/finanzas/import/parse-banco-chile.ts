import type { TransactionKind } from '../finance.models';
import { suggestCategory } from './categorize';
import { ImportError, type ParsedImport, type ParsedMovement } from './import.types';
import {
  cleanDescription,
  excelSerialToDate,
  lastFourDigits,
  normalizeText,
  parseChileanAmount,
  parseChileanDate,
} from './parse-utils';

type Cell = string | number | boolean | null | undefined;

const cellText = (cell: Cell) => (cell === null || cell === undefined ? '' : String(cell).trim());

/** ¿Es la cartola de cuenta corriente de Banco de Chile (Excel "Movimientos al …")? */
export function isBancoChileCartola(rows: Cell[][]): boolean {
  return findHeader(rows) !== null && rows.some((row) => /^cuenta:?$/i.test(cellText(row[0])));
}

function findHeader(rows: Cell[][]) {
  for (let index = 0; index < Math.min(rows.length, 40); index += 1) {
    const labels = rows[index]!.map((cell) => normalizeText(cellText(cell)));
    const date = labels.indexOf('fecha');
    const description = labels.findIndex((label) => label.startsWith('descripcion'));
    const debit = labels.findIndex((label) => label.startsWith('cargos'));
    const credit = labels.findIndex((label) => label.startsWith('abonos'));
    if (date >= 0 && description >= 0 && debit >= 0 && credit >= 0) {
      return { index, date, description, debit, credit };
    }
  }
  return null;
}

function amountOf(cell: Cell): bigint {
  if (typeof cell === 'number') return BigInt(Math.round(cell));
  return parseChileanAmount(cellText(cell)) ?? 0n;
}

function dateOf(cell: Cell): string | null {
  if (typeof cell === 'number') return excelSerialToDate(cell);
  return parseChileanDate(cellText(cell));
}

/** Nombre del titular en el texto del movimiento ("Traspaso De:Nicolás Gómez" ⊃ "nicolas gomez"). */
function mentionsHolder(description: string, holder: string | null): boolean {
  if (!holder) return false;
  const text = normalizeText(description);
  const words = normalizeText(holder).split(' ').filter((word) => word.length > 2);
  return words.length >= 2 && words.every((word) => text.includes(word));
}

/**
 * Clasifica un movimiento de cuenta corriente:
 * - pagos de tarjeta o línea de crédito → `card_payment` (no son gasto nuevo);
 * - traspasos entre cuentas del mismo titular → `transfer`;
 * - traspasos a terceros → gasto en "transferencias"; desde terceros → ingreso.
 */
export function classifyBankMovement(description: string, amount: bigint, holder: string | null): Pick<ParsedMovement, 'kind' | 'category'> {
  const text = normalizeText(description);
  const isTransfer = /^traspaso (a|de)\s*:/.test(text);
  if (/tarjeta|pago linea de cred|pago tc\b/.test(text) && (amount < 0n || !isTransfer)) {
    return { kind: 'card_payment', category: null };
  }
  if (isTransfer && mentionsHolder(description, holder)) return { kind: 'transfer', category: null };
  if (amount > 0n) return { kind: 'income', category: 'ingresos' };
  if (isTransfer) return { kind: 'expense', category: 'transferencias' };
  return { kind: 'expense' as TransactionKind, category: suggestCategory(description) };
}

export function parseBancoChileCartola(rows: Cell[][]): ParsedImport {
  const header = findHeader(rows);
  if (!header) throw new ImportError('No encontramos la tabla de movimientos en la cartola.');

  const field = (label: RegExp) => {
    const row = rows.find((candidate) => label.test(cellText(candidate[0])));
    return row ? cellText(row[1]) : null;
  };
  const holder = field(/^sr\(a\):?$/i);
  const accountNumber = field(/^cuenta:?$/i);
  const currencyText = field(/^moneda:?$/i) ?? '';
  if (currencyText && !/CLP|pesos/i.test(currencyText)) {
    throw new ImportError('Por ahora solo importamos cartolas en pesos chilenos.');
  }

  const movements: ParsedMovement[] = [];
  for (const row of rows.slice(header.index + 1)) {
    const date = dateOf(row[header.date]);
    if (!date) continue;
    const description = cleanDescription(cellText(row[header.description]));
    const amount = amountOf(row[header.credit]) - amountOf(row[header.debit]);
    if (!description || amount === 0n) continue;
    movements.push({ date, description, amount, ...classifyBankMovement(description, amount, holder) });
  }
  if (movements.length === 0) throw new ImportError('La cartola no tiene movimientos.');

  // La cartola viene del más nuevo al más antiguo: se guarda en orden cronológico.
  movements.reverse();

  return {
    source: 'banco-chile-cartola',
    institution: 'Banco de Chile',
    accountKind: 'checking',
    suggestedName: 'Cuenta corriente Banco de Chile',
    last4: accountNumber ? lastFourDigits(accountNumber) : null,
    currency: 'CLP',
    creditLimit: null,
    movements,
    installments: [],
    statement: null,
  };
}
