import { suggestCategory } from './categorize';
import { ImportError, type ParsedImport, type ParsedInstallment, type ParsedMovement, type PdfLine } from './import.types';
import { cleanDescription, lastFourDigits, monthOf, parseChileanAmount, parseChileanDate } from './parse-utils';

const DATE = String.raw`\d{2}/\d{2}/\d{4}`;
const AMOUNT = String.raw`-?[\d.]+`;

/**
 * Fila de operación del estado de cuenta CMR:
 *   [lugar] fecha descripción [T|A] monto_operación total_a_pagar n/N [mes-año] [valor_cuota]
 */
const OPERATION_RE = new RegExp(
  String.raw`^(?:.*?\s)?(${DATE})\s+(.+?)\s+(?:[TA]\s+)?(${AMOUNT})\s+(${AMOUNT})\s+(\d{2})/(\d{2})(?:\s+[a-z]{3}-\d{4})?(?:\s+(${AMOUNT}))?$`,
  'i',
);

export function isCmrStatement(lines: PdfLine[]): boolean {
  const text = lines.map((line) => line.text).join('\n');
  return /CLIENTE CMR/i.test(text) && /Fecha Facturaci[oó]n/i.test(text);
}

function find(lines: PdfLine[], pattern: RegExp): RegExpMatchArray | null {
  for (const line of lines) {
    const match = line.text.match(pattern);
    if (match) return match;
  }
  return null;
}

const amount = (text: string | undefined) => (text ? parseChileanAmount(text) : null);

export function parseCmrStatement(lines: PdfLine[]): ParsedImport {
  const period = find(lines, new RegExp(String.raw`Per[ií]odo Facturado\s+(${DATE})\s+(${DATE})`, 'i'));
  const due = find(lines, new RegExp(String.raw`Pagar Hasta\s+(${DATE})`, 'i'));
  const total = find(lines, /Monto Total Facturado a Pagar\s+\$?\s*([\d.]+)/i);
  const minimum = find(lines, /Monto m[ií]nimo a pagar\s+\$?\s*([\d.]+)/i);
  if (!period || !due || !total) {
    throw new ImportError('No pudimos leer el período o la fecha de pago del estado de cuenta CMR.');
  }

  const periodStart = parseChileanDate(period[1]!)!;
  const periodEnd = parseChileanDate(period[2]!)!;
  const dueDate = parseChileanDate(due[1]!)!;
  const dueMonth = monthOf(dueDate);

  const movements: ParsedMovement[] = [];
  const installments: ParsedInstallment[] = [];
  const start = lines.findIndex((line) => /PER[IÍ]ODO ACTUAL/i.test(line.text));
  const end = lines.findIndex((line) => /INFORMACI[OÓ]N DE PAGO/i.test(line.text));

  for (const line of lines.slice(Math.max(start, 0), end > start ? end : undefined)) {
    const match = line.text.match(OPERATION_RE);
    if (!match) continue;
    const [, dateText, rawDescription, operationText, totalText, numberText, countText, valueText] = match;
    const date = parseChileanDate(dateText!);
    const operation = amount(operationText);
    const totalToPay = amount(totalText);
    if (!date || operation === null || totalToPay === null) continue;
    const description = cleanDescription(rawDescription!);
    const number = Number(numberText);
    const count = Number(countText);

    if (operation < 0n) {
      // Pago o abono a la tarjeta: entra plata a la tarjeta, no es gasto.
      movements.push({ date, description, amount: -operation, kind: 'card_payment', category: null });
      continue;
    }

    if (count > 1) {
      const value = amount(valueText) ?? (totalToPay + BigInt(count) - 1n) / BigInt(count);
      installments.push({
        description,
        purchaseDate: date,
        originalAmount: operation,
        totalAmount: totalToPay,
        installmentCount: count,
        installmentAmount: value,
        currentNumber: number,
        currentDueMonth: dueMonth,
        category: suggestCategory(description),
      });
      continue;
    }

    const charged = amount(valueText) ?? totalToPay;
    if (charged === 0n) continue;
    movements.push({ date, description, amount: -charged, kind: 'expense', category: suggestCategory(description) });
  }

  // "Vencimiento próximos 4 meses": una línea con fechas y la siguiente con montos.
  const upcoming: { month: string; amount: bigint }[] = [];
  const headerIndex = lines.findIndex((line) => /^Actual\b/i.test(line.text) && new RegExp(DATE).test(line.text));
  if (headerIndex >= 0) {
    const dates = [...lines[headerIndex]!.text.matchAll(new RegExp(DATE, 'g'))].map((m) => parseChileanDate(m[0])!);
    // Los montos van en una de las líneas siguientes (entre medio puede colarse texto del gráfico).
    const amountsOf = (text: string) =>
      text
        .split(/\s+/)
        .filter((token) => /^\d{1,3}(\.\d{3})*$/.test(token))
        .map((token) => parseChileanAmount(token)!);
    const amounts =
      lines
        .slice(headerIndex + 1, headerIndex + 4)
        .map((line) => amountsOf(line.text))
        .find((values) => values.length > dates.length) ?? [];
    // El primer monto es el "Actual"; los siguientes corresponden a cada fecha.
    dates.forEach((date, index) => {
      const value = amounts[index + 1];
      if (value !== undefined) upcoming.push({ month: monthOf(date), amount: value });
    });
  }

  const holderCard = find(lines, /T:\s*Titular\s*:\s*([\d*]+)/i);
  const creditLimit = find(lines, /Cupo Compras\*?\s+([\d.]+)/i);

  return {
    source: 'cmr-falabella',
    institution: 'Banco Falabella',
    accountKind: 'credit_card',
    suggestedName: 'CMR Falabella',
    last4: holderCard ? lastFourDigits(holderCard[1]!) : null,
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
