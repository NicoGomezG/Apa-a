import { ImportError, type ParsedImport, type PdfLine } from './import.types';
import { isBancoChileCartola, parseBancoChileCartola } from './parse-banco-chile';
import { isCmrStatement, parseCmrStatement } from './parse-cmr';
import { isSantanderStatement, parseSantanderStatement } from './parse-santander';

/** El archivo se lee en el navegador: nunca se sube ni se guarda. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export class PdfPasswordError extends ImportError {
  constructor(readonly incorrect: boolean) {
    super(incorrect ? 'La contraseña no es correcta.' : 'Este PDF tiene contraseña.');
  }
}

/** Interpreta líneas de texto de un PDF ya extraídas. */
export function parsePdfLines(lines: PdfLine[]): ParsedImport {
  if (isCmrStatement(lines)) return parseCmrStatement(lines);
  if (isSantanderStatement(lines)) return parseSantanderStatement(lines);
  throw new ImportError(
    'No reconocemos este PDF. Por ahora leemos estados de cuenta de CMR Falabella y de tarjetas Santander.',
  );
}

export function parseSpreadsheetRows(rows: unknown[][]): ParsedImport {
  const cells = rows as (string | number | null)[][];
  if (isBancoChileCartola(cells)) return parseBancoChileCartola(cells);
  throw new ImportError('No reconocemos esta planilla. Por ahora leemos cartolas de cuenta corriente de Banco de Chile.');
}

export async function readImportFile(file: File, password?: string): Promise<ParsedImport> {
  if (file.size > MAX_FILE_BYTES) throw new ImportError('El archivo pesa más de 10 MB.');
  const data = await file.arrayBuffer();
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return parsePdfLines(await pdfToLines(data, password));
  }
  if (/\.(xls|xlsx|csv)$/.test(name)) {
    return parseSpreadsheetRows(await spreadsheetToRows(data));
  }
  throw new ImportError('Sube un PDF (estado de cuenta) o un Excel (cartola).');
}

async function spreadsheetToRows(data: ArrayBuffer): Promise<unknown[][]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) throw new ImportError('La planilla está vacía.');
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false, defval: null });
}

/** Extrae el texto del PDF y lo arma en líneas según la posición vertical de cada trozo. */
async function pdfToLines(data: ArrayBuffer, password?: string): Promise<PdfLine[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), password });
  let document;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    void loadingTask.destroy();
    if ((error as { name?: string }).name === 'PasswordException') {
      throw new PdfPasswordError(Boolean(password));
    }
    throw new ImportError('No pudimos abrir el PDF.');
  }

  const lines: PdfLine[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows: { y: number; items: { x: number; text: string }[] }[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, text: item.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      lines.push({ page: pageNumber, text: row.items.map((item) => item.text).join(' ') });
    }
  }
  await loadingTask.destroy();
  return lines;
}
