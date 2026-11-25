import type { Category } from '../finance.models';
import { normalizeText } from './parse-utils';

// Reglas por palabra clave para sugerir la categoría de un movimiento importado.
// Es solo una sugerencia: se puede cambiar en la vista previa y después.
const RULES: [Category, string[]][] = [
  ['supermercado', ['sta isabel', 'santa isabel', 'lider', 'jumbo', 'tottus', 'unimarc', 'acuenta', 'alvi', 'mayorista', 'huevera', 'oxxo', 'ok market', 'minimarket', 'botilleria', 'feria']],
  ['transporte', ['uber', 'cabify', 'didi', 'red movilidad', 'metro de santiago', 'bip', 'copec', 'shell', 'petrobras', 'aramco', 'pronto', 'autopista', 'costanera norte', 'vespucio', 'estacionamiento', 'parking', 'turbus', 'pullman']],
  ['comida', ['rappi', 'pedidosya', 'pedidos ya', 'ubereats', 'uber eats', 'gastronomica', 'restaurant', 'resto', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'burger', 'pizza', 'sushi', 'juan maestro', 'dominos', 'kiosko', 'tostadu', 'bar ']],
  ['suscripciones', ['google play', 'apple.com', 'itunes', 'netflix', 'spotify', 'disney', 'hbo', 'max.com', 'prime video', 'amazon prime', 'youtube', 'openai', 'chatgpt', 'claude.ai', 'anthropic', 'microsoft', 'adobe', 'icloud', 'crunchyroll', 'paramount']],
  ['salud', ['farmacia', 'cruz verde', 'salcobrand', 'ahumada', 'dr simi', 'clinica', 'isapre', 'fonasa', 'laboratorio', 'dental', 'medic', 'optica']],
  ['entretencion', ['cinepolis', 'cinemark', 'cine hoyts', 'jugabet', 'ticketmaster', 'puntoticket', 'passline', 'steam', 'playstation', 'xbox', 'nintendo', 'barberia', 'peluqueria']],
  ['viajes', ['jetsmart', 'latam', 'sky airline', 'airbnb', 'booking', 'hotel', 'despegar']],
  ['hogar', ['enel', 'aguas andinas', 'metrogas', 'abastible', 'lipigas', 'gasco', 'vtr', 'movistar', 'entel', 'wom', 'claro', 'mundo pacifico', 'gastos comunes', 'sodimac', 'homecenter', 'easy', 'recaudacion y pagos de servicios']],
  ['compras', ['mercado libre', 'mercadolibre', 'falabella', 'paris', 'ripley', 'h&m', 'zara', 'aliexpress', 'temu', 'shein', 'amazon', 'mall']],
  ['comisiones', ['servicio administracion', 'comision', 'intereses', 'interes', 'impuesto', 'seg.proteccion', 'seguro', 'mantencion', 'cargo seg']],
  ['educacion', ['universidad', 'u.catolica', 'colegio', 'instituto', 'udemy', 'coursera', 'platzi', 'libreria']],
];

export function suggestCategory(description: string): Category | null {
  const text = normalizeText(description);
  // Gana la palabra clave más larga: "uber eats" (comida) le gana a "uber" (transporte).
  let best: { category: Category; length: number } | null = null;
  for (const [category, keywords] of RULES) {
    for (const keyword of keywords) {
      if (text.includes(keyword) && keyword.length > (best?.length ?? 0)) best = { category, length: keyword.length };
    }
  }
  return best?.category ?? null;
}
