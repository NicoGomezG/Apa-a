import { suggestCategory } from './categorize';
import { ImportError, type ParsedImport, type ParsedInstallment, type ParsedMovement, type PdfLine } from './import.types';
import {
  addMonths,
  cleanDescription,
  monthOf,
  parseChileanAmount,
  parseChileanDate,
  spanishMonthNumber,
} from './parse-utils';

const LONG_DATE = String.raw`\d{2}/\d{2}/\d{4}`;
const MONEY = /\$\s*-?[\d.]+/g;

/** [lugar] dd/mm/aa resto — la fecha corta de los movimientos (no dd/mm/aaaa). */
const MOVEMENT_RE = /^(?:.*?\s)?(\d{2}\/\d{2}\/\d{2})(?!\d)\s+(.+)$/;

export function isSantanderStatement(lines: PdfLine[]): boolean {
  const text = lines.map((line) => line.text).join('\n');
  return /ESTADO DE CUENTA EN MONEDA NACIONAL DE TARJETA DE CR[EÉ]DITO/i.test(text) && /SANTANDER/i.test(text);
}

function find(lines: PdfLine[], pattern: RegExp): RegExpMatchArray | null {
  for (const line of lines) {
    const match = line.text.match(pattern);
    if (match) return match;
  }
  return null;
}

const money = (token: string) => parseChileanAmount(token.replace('$', ''));

export function parseSantanderStatement(lines: PdfLine[]): ParsedImport {
  // "PERÍODO FACTURADO" lleva sus fechas en la misma línea o en la siguiente.
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  const periodIndex = lines.findIndex((line) => /PER[IÍ]ODO FACTURADO/i.test(line.text) && !/ANTERIOR/i.test(line.text));
  for (const line of lines.slice(Math.max(periodIndex, 0), periodIndex + 3)) {
    const dates = line.text.match(new RegExp(LONG_DATE, 'g'));
    if (periodIndex >= 0 && dates && dates.length >= 2) {
      periodStart = parseChileanDate(dates[0]!);
      periodEnd = parseChileanDate(dates[1]!);
      break;
    }
  }
  const due = find(lines, new RegExp(String.raw`PAGAR HASTA\s+(${LONG_DATE})`, 'i'));
  const total =
    find(lines, /MONTO TOTAL FACTURADO A PAGAR\s+\$\s*([\d.]+)/i) ?? find(lines, /TOTAL OPERACIONES\s+\$\s*([\d.]+)/i);
  const minimum = find(lines, /MONTO M[IÍ]NIMO A PAGAR\s+\$\s*([\d.]+)/i);
  if (!periodStart || !periodEnd || !due || !total) {
    throw new ImportError('No pudimos leer el período o la fecha de pago del estado de cuenta Santander.');
  }
  const dueDate = parseChileanDate(due[1]!)!;
  const dueMonth = monthOf(dueDate);

  const movements: ParsedMovement[] = [];
  const installments: ParsedInstallment[] = [];
  for (const line of lines) {
    const match = line.text.match(MOVEMENT_RE);
    if (!match) continue;
    const date = parseChileanDate(match[1]!);
    const rest = match[2]!;
    const amounts = (rest.match(MONEY) ?? []).map(money).filter((value): value is bigint => value !== null);
    if (!date || amounts.length === 0) continue;

    // La descripción termina donde empieza el tipo de cuota, la tasa o el primer monto.
    const cut = rest.search(/\s(CUOTA\s|-?[\d,]+\s*%|\$)/);
    const description = cleanDescription(cut >= 0 ? rest.slice(0, cut) : rest);
    const installment = rest.match(/\s(\d{2})\/(\d{2})\s/);

    if (installment && amounts.length >= 3) {
      const [original, totalToPay, value] = amounts as [bigint, bigint, bigint];
      const number = Number(installment[1]);
      const count = Number(installment[2]);
      if (count > 1) {
        installments.push({
          description,
          purchaseDate: date,
          originalAmount: original,
          totalAmount: totalToPay,
          installmentCount: count,
          installmentAmount: value,
          currentNumber: number,
          currentDueMonth: dueMonth,
          category: suggestCategory(description),
        });
        continue;
      }
    }

    const charged = amounts.at(-1)!;
    if (charged < 0n) {
      movements.push({ date, description, amount: -charged, kind: 'card_payment', category: null });
    } else if (charged > 0n) {
      movements.push({ date, description, amount: -charged, kind: 'expense', category: suggestCategory(description) });
    }
  }

  // "Vencimiento próximos 4 meses": rotulado por mes de FACTURACIÓN; se paga el mes siguiente.
  const upcoming: { month: string; amount: bigint }[] = [];
  const monthsIndex = lines.findIndex(
    (line) => line.text.split(/\s+/).filter((word) => spanishMonthNumber(word) !== null && word.length > 3).length >= 2,
  );
  if (monthsIndex >= 0) {
    const names = lines[monthsIndex]!.text.split(/\s+/).filter((word) => word.length > 3 && spanishMonthNumber(word) !== null);
    // Los montos van en una de las líneas siguientes (puede haber un rótulo entre medio).
    const values =
      lines
        .slice(monthsIndex + 1, monthsIndex + 4)
        .map((line) => (line.text.match(MONEY) ?? []).map(money))
        .find((found) => found.length >= names.length) ?? [];
    // El primer valor es "saldo capital cuotas"; luego uno por mes.
    const offset = values.length > names.length ? values.length - names.length : 0;
    let billingMonth = monthOf(periodEnd);
    names.forEach((name, index) => {
      const target = spanishMonthNumber(name)!;
      while (Number(billingMonth.slice(5, 7)) !== target) billingMonth = addMonths(billingMonth, 1);
      const value = values[index + offset];
      if (value !== null && value !== undefined) upcoming.push({ month: addMonths(billingMonth, 1), amount: value });
    });
  }

  const card = find(lines, /TARJETA DE CR[EÉ]DITO\s+X{4}\s+X{4}\s+X{4}\s+(\d{4})/i);
  const product = find(lines, /X{4}\s+(\d{4})\s+([A-ZÁÉÍÓÚÑ ]{4,})$/i);
  const creditLimit = find(lines, /^CUPO TOTAL\s+\$\s*([\d.]+)/i);

  return {
    source: 'santander-tarjeta',
    institution: 'Santander',
    accountKind: 'credit_card',
    suggestedName: product ? `Santander ${titleCase(product[2]!.trim())}` : 'Tarjeta Santander',
    last4: card ? card[1]! : null,
    currency: 'CLP',
    creditLimit: creditLimit ? parseChileanAmount(creditLimit[1]!) : null,
    movements,
    installments,
    statement: {
      periodStart,
      periodEnd,
      dueDate,
      totalBilled: parseChileanAmount(total[1]!) ?? 0n,
      minimumPayment: (minimum && parseChileanAmount(minimum[1]!)) ?? 0n,
      upcoming,
    },
  };
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((word) => (word === 'latam' ? 'LATAM' : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}
