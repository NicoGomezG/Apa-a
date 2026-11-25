import { suggestCategory } from './categorize';
import type { PdfLine } from './import.types';
import { classifyBankMovement } from './parse-banco-chile';
import { parseChileanAmount, parseChileanDate, spanishMonthNumber } from './parse-utils';
import { parsePdfLines, parseSpreadsheetRows } from './read-file';
import { futureInstallments, verifyTotal, verifyUpcoming } from './verify';

// Datos inventados con el mismo formato que los documentos reales.
const pdf = (texts: string[]): PdfLine[] => texts.map((text) => ({ page: 1, text }));

const CMR_LINES = pdf([
  'ESTADO DE CUENTA',
  'CLIENTE CMR Calle Falsa 123',
  'Nombre del Titular: Ana Pérez Soto',
  'Fecha Facturación Estado de Cuenta: 19/11/2026',
  '• Pagar Hasta 05/12/2026',
  '• Monto Total Facturado a Pagar $81.000 tu App',
  '• Monto mínimo a pagar $9.000',
  'Cupo Compras* 500.000 120.000 380.000',
  'Tasa Interés Vigente 3,42 % 3,9 % 3,9 % Período Facturado 20/10/2026 19/11/2026',
  '2. PERÍODO ACTUAL',
  'COMPRAS NACIONALES',
  'Santiago 08/09/2026 Tienda de muebles T 60.000 60.000 03/06 oct-2026 10.000',
  'Santiago 03/10/2026 Zapateria centro T 25.700 27.503 02/03 nov-2026 9.167',
  'Las Condes 20/10/2026 Uber T 3.000 3.000 01/01 dic-2026 3.000',
  'Santiago 21/10/2026 Sta isabel centro T 25.000 25.000 01/01 dic-2026 25.000',
  'Santiago 21/10/2026 Sta isabel centro T 25.000 25.000 01/01 dic-2026 25.000',
  'COMPRAS INTERNACIONALES',
  'Cupertino 22/10/2026 Apple.com/bi T 990 990 01/01 dic-2026 990',
  '2.3 Cargos, Comisiones, Impuestos y Abonos',
  'S/I 02/11/2026 Pago tarjeta cmr T -100.000 0 01/01',
  '19/11/2026 Servicio administracion 2.843 2.843 01/01 2.843',
  'III. INFORMACIÓN DE PAGO',
  'Actual 05/01/2027 05/02/2027 05/03/2027',
  '$153,612',
  '76.000 19.169 10.000 10.000 $76,807',
  '(1) T: Titular : 548742******1234',
]);

const SANTANDER_LINES = pdf([
  'ESTADO DE CUENTA EN MONEDA NACIONAL DE TARJETA DE CRÉDITO',
  'Nº DE TARJETA DE CRÉDITO XXXX XXXX XXXX 9876 MASTER GOLD LATAM',
  'CUPO TOTAL $ 700.000 $ 100.000 $ 600.000',
  'CAE se calcula sobre un supuesto PERÍODO FACTURADO',
  '26/10/2026 24/11/2026',
  'PAGAR HASTA 10/12/2026',
  'PERÍODO DE FACTURACIÓN ANTERIOR 24/09/2026 26/10/2026',
  '28/08/26 COMERCIALIZADORA UNO CUOTA COMERCIO 0,00 % $ 27.440 $ 27.440 02/03 $9.147',
  '16/10/26 COMERCIAL DOS SPA CUOTA FIJA 3,36 % $ 28.490 $ 31.184 01/03 $10.395',
  'SANTIAGO 26/10/26 PAGO ONLINE KUSHKI $560',
  'Santiago 30/10/26 Red Movilidad Santiago $815',
  '02/11/26 MONTO CANCELADO $ -256.019',
  'MONTO TOTAL FACTURADO A PAGAR $ 20.917 EVOLUCIÓN MONTOS',
  'MONTO MÍNIMO A PAGAR $ 6.800',
  'DICIEMBRE ENERO FEBRERO MARZO',
  'CUOTAS',
  '$ 29.935 $ 19.541 $ 10.394 $ 0 $ 0',
  'WWW.SANTANDER.CL',
]);

const BANCO_CHILE_ROWS = [
  ['Sr(a): ', 'Ana Pérez Soto'],
  ['Rut:', '11.111.111-1'],
  ['Cuenta:', '00-123-45678-90'],
  ['Moneda:', 'Pesos Chilenos (CLP)'],
  ['Movimientos al 25/11/2026'],
  ['Fecha', 'Descripción', 'Canal o Sucursal', 'Cargos (CLP)', 'Abonos (CLP)', 'Saldo (CLP)'],
  ['23/11/2026', 'Traspaso A:Carlos Rojas', 'Internet', 35460, null, 1689],
  ['23/11/2026', 'Traspaso De:Ana Pérez Soto', 'Internet', null, 5862, 37149],
  ['17/11/2026', 'Traspaso A:Tarjeta Cmr', 'Internet', 10000, null, 31287],
  ['05/11/2026', 'Pago:la Huevera De Gor', 'Oficina', 1600, null, 34695],
  ['03/11/2026', 'Traspaso De:Empresa Spa', 'Internet', null, 1200000, 1220172],
  ['02/11/2026', 'Intereses Linea De Credito', 'Oficina', 10, null, 5172],
  ['13/10/2026', 'Pago Linea De Cred:0123', 'Internet', 1217, null, 29783],
  ['Infórmate sobre la garantía estatal de los depósitos'],
];

describe('utilidades de importación', () => {
  it('lee montos y fechas chilenas', () => {
    expect(parseChileanAmount('$ -256.019')).toBe(-256019n);
    expect(parseChileanAmount('$9.147')).toBe(9147n);
    expect(parseChileanAmount('$76,807')).toBeNull();
    expect(parseChileanDate('05/12/2026')).toBe('2026-12-05');
    expect(parseChileanDate('28/08/26')).toBe('2026-08-28');
    expect(spanishMonthNumber('DICIEMBRE')).toBe(12);
    expect(spanishMonthNumber('CUOTAS')).toBeNull();
  });

  it('sugiere categorías por comercio', () => {
    expect(suggestCategory('Sta isabel grajales')).toBe('supermercado');
    expect(suggestCategory('Uber rides')).toBe('transporte');
    expect(suggestCategory('Uber Eats')).toBe('comida');
    expect(suggestCategory('Google play')).toBe('suscripciones');
    expect(suggestCategory('Metrogas')).toBe('hogar');
    expect(suggestCategory('MUDI SPA')).toBeNull();
  });
});

describe('estado de cuenta CMR', () => {
  const parsed = parsePdfLines(CMR_LINES);

  it('lee los datos del estado de cuenta', () => {
    expect(parsed.source).toBe('cmr-falabella');
    expect(parsed.last4).toBe('1234');
    expect(parsed.creditLimit).toBe(500000n);
    expect(parsed.statement).toMatchObject({
      periodStart: '2026-10-20',
      periodEnd: '2026-11-19',
      dueDate: '2026-12-05',
      totalBilled: 81000n,
      minimumPayment: 9000n,
    });
  });

  it('separa compras al contado, cuotas, pagos y comisiones', () => {
    expect(parsed.movements.map((m) => [m.date, m.kind, m.amount])).toEqual([
      ['2026-10-20', 'expense', -3000n],
      ['2026-10-21', 'expense', -25000n],
      ['2026-10-21', 'expense', -25000n],
      ['2026-10-22', 'expense', -990n],
      ['2026-11-02', 'card_payment', 100000n],
      ['2026-11-19', 'expense', -2843n],
    ]);
    expect(parsed.installments).toEqual([
      expect.objectContaining({
        description: 'Tienda de muebles',
        installmentCount: 6,
        currentNumber: 3,
        installmentAmount: 10000n,
        currentDueMonth: '2026-12',
      }),
      expect.objectContaining({ description: 'Zapateria centro', installmentCount: 3, currentNumber: 2, totalAmount: 27503n }),
    ]);
  });

  it('cuadra con el total facturado y con la tabla de vencimientos del banco', () => {
    // 3.000 + 25.000 × 2 + 990 + 2.843 + cuotas 10.000 + 9.167 = 76.000
    expect(verifyTotal({ ...parsed, statement: { ...parsed.statement!, totalBilled: 76000n } })).toEqual({
      charged: 76000n,
      billed: 76000n,
      matches: true,
    });
    expect(verifyTotal(parsed)?.matches).toBe(false);
    expect(verifyUpcoming(parsed)).toEqual([
      { month: '2027-01', bank: 19169n, projected: 19169n, matches: true },
      { month: '2027-02', bank: 10000n, projected: 10000n, matches: true },
      { month: '2027-03', bank: 10000n, projected: 10000n, matches: true },
    ]);
  });

  it('proyecta en qué meses caen las cuotas que faltan (la última ajusta el redondeo)', () => {
    expect(futureInstallments(parsed.installments[1]!)).toEqual([
      { number: 2, month: '2026-12', amount: 9167n },
      { number: 3, month: '2027-01', amount: 9169n },
    ]);
  });
});

describe('estado de cuenta Santander', () => {
  const parsed = parsePdfLines(SANTANDER_LINES);

  it('lee los datos del estado de cuenta', () => {
    expect(parsed.source).toBe('santander-tarjeta');
    expect(parsed.last4).toBe('9876');
    expect(parsed.suggestedName).toBe('Santander Master Gold LATAM');
    expect(parsed.creditLimit).toBe(700000n);
    expect(parsed.statement).toMatchObject({
      periodStart: '2026-10-26',
      periodEnd: '2026-11-24',
      dueDate: '2026-12-10',
      totalBilled: 20917n,
      minimumPayment: 6800n,
    });
  });

  it('separa cuotas, compras y pagos', () => {
    expect(parsed.installments.map((i) => [i.description, i.currentNumber, i.installmentCount, i.installmentAmount])).toEqual([
      ['COMERCIALIZADORA UNO', 2, 3, 9147n],
      ['COMERCIAL DOS SPA', 1, 3, 10395n],
    ]);
    expect(parsed.movements.map((m) => [m.description, m.kind, m.amount])).toEqual([
      ['PAGO ONLINE KUSHKI', 'expense', -560n],
      ['Red Movilidad Santiago', 'expense', -815n],
      ['MONTO CANCELADO', 'card_payment', 256019n],
    ]);
  });

  it('normaliza su tabla (rotulada por mes de facturación) a mes de pago y cuadra', () => {
    expect(verifyUpcoming(parsed)).toEqual([
      { month: '2027-01', bank: 19541n, projected: 19541n, matches: true },
      { month: '2027-02', bank: 10394n, projected: 10394n, matches: true },
      { month: '2027-03', bank: 0n, projected: 0n, matches: true },
      { month: '2027-04', bank: 0n, projected: 0n, matches: true },
    ]);
    expect(verifyTotal(parsed)).toEqual({ charged: 20917n, billed: 20917n, matches: true });
  });
});

describe('cartola Banco de Chile', () => {
  const parsed = parseSpreadsheetRows(BANCO_CHILE_ROWS);

  it('lee la cuenta y los movimientos en orden cronológico', () => {
    expect(parsed.source).toBe('banco-chile-cartola');
    expect(parsed.last4).toBe('7890');
    expect(parsed.statement).toBeNull();
    expect(parsed.movements.map((m) => [m.date, m.amount])).toEqual([
      ['2026-10-13', -1217n],
      ['2026-11-02', -10n],
      ['2026-11-03', 1200000n],
      ['2026-11-05', -1600n],
      ['2026-11-17', -10000n],
      ['2026-11-23', 5862n],
      ['2026-11-23', -35460n],
    ]);
  });

  it('distingue traspasos propios, pagos de tarjeta, transferencias e ingresos', () => {
    const kinds = Object.fromEntries(parsed.movements.map((m) => [m.description, [m.kind, m.category]]));
    expect(kinds).toEqual({
      'Pago Linea De Cred:0123': ['card_payment', null],
      'Intereses Linea De Credito': ['expense', 'comisiones'],
      'Traspaso De:Empresa Spa': ['income', 'ingresos'],
      'Pago:la Huevera De Gor': ['expense', 'supermercado'],
      'Traspaso A:Tarjeta Cmr': ['card_payment', null],
      'Traspaso De:Ana Pérez Soto': ['transfer', null],
      'Traspaso A:Carlos Rojas': ['expense', 'transferencias'],
    });
  });

  it('un traspaso desde el mismo titular escrito sin tildes también es propio', () => {
    expect(classifyBankMovement('Traspaso De:Ana Perez Soto', 100n, 'Ana Pérez Soto').kind).toBe('transfer');
  });
});

describe('archivos no reconocidos', () => {
  it('lo dice con claridad', () => {
    expect(() => parsePdfLines(pdf(['Boleta de honorarios']))).toThrowError(/No reconocemos este PDF/);
    expect(() => parseSpreadsheetRows([['a', 'b']])).toThrowError(/No reconocemos esta planilla/);
  });
});
