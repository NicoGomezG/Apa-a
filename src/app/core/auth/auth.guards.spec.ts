import { safeRedirect } from './auth.guards';

describe('safeRedirect', () => {
  it('acepta rutas internas', () => {
    expect(safeRedirect('/ajustes')).toBe('/ajustes');
    expect(safeRedirect('/finanzas?mes=2026-10')).toBe('/finanzas?mes=2026-10');
  });

  it('rechaza destinos externos o ambiguos', () => {
    for (const target of ['https://malo.cl', '//malo.cl', '/\\malo.cl', 'javascript:alert(1)', 'ajustes', '', undefined, 42]) {
      expect(safeRedirect(target)).toBe('/');
    }
  });

  it('no vuelve a pantallas de acceso', () => {
    expect(safeRedirect('/auth/ingresar')).toBe('/');
  });
});
