export type ModuleKey = 'inicio' | 'finanzas' | 'agenda' | 'personas' | 'compras' | 'vehiculos' | 'salud' | 'ajustes';

export interface NavItem {
  key: ModuleKey;
  path: string;
  label: string;
  icon: string;
  /** Aparece en la barra inferior del celular; el resto va en "Más". */
  mobile: boolean;
}

export interface UpcomingModule {
  key: ModuleKey;
  title: string;
  icon: string;
  phase: number;
  summary: string;
  features: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'inicio', path: '/', label: 'Inicio', icon: 'fa-house', mobile: true },
  { key: 'finanzas', path: '/finanzas', label: 'Finanzas', icon: 'fa-wallet', mobile: true },
  { key: 'agenda', path: '/agenda', label: 'Agenda', icon: 'fa-calendar-days', mobile: true },
  { key: 'personas', path: '/personas', label: 'Personas', icon: 'fa-user-group', mobile: true },
  { key: 'compras', path: '/compras', label: 'Compras', icon: 'fa-cart-shopping', mobile: false },
  { key: 'vehiculos', path: '/vehiculos', label: 'Vehículos', icon: 'fa-car', mobile: false },
  { key: 'salud', path: '/salud', label: 'Salud', icon: 'fa-heart-pulse', mobile: false },
];

export const SETTINGS_ITEM: NavItem = { key: 'ajustes', path: '/ajustes', label: 'Ajustes', icon: 'fa-gear', mobile: false };

/** Módulos que todavía no están construidos. La pantalla lo dice tal cual. */
export const UPCOMING_MODULES: Record<string, UpcomingModule> = {
  finanzas: {
    key: 'finanzas',
    title: 'Finanzas',
    icon: 'fa-wallet',
    phase: 2,
    summary: 'Tus ingresos, gastos, presupuestos y suscripciones, con aviso antes de cada renovación.',
    features: ['Registro de gastos e ingresos', 'Cuentas y medios de pago', 'Presupuestos mensuales', 'Suscripciones y pagos recurrentes', 'Proyección de gastos'],
  },
  agenda: {
    key: 'agenda',
    title: 'Agenda',
    icon: 'fa-calendar-days',
    phase: 2,
    summary: 'Tus recordatorios, citas y vencimientos de todos los módulos, en un solo calendario.',
    features: ['Recordatorios con anticipación configurable', 'Recurrencias', 'Pendientes, completados y descartados'],
  },
  personas: {
    key: 'personas',
    title: 'Personas',
    icon: 'fa-user-group',
    phase: 3,
    summary: 'Cumpleaños, fechas importantes y salidas, con reparto de la cuenta a partir de una foto de la boleta.',
    features: ['Contactos y cumpleaños', 'Eventos y salidas', 'Lectura de boletas con IA', 'Reparto de gastos y enlace para invitados'],
  },
  compras: {
    key: 'compras',
    title: 'Compras',
    icon: 'fa-cart-shopping',
    phase: 4,
    summary: 'Listas de supermercado reutilizables e historial de precios por producto y local.',
    features: ['Listas y plantillas', 'Historial de precios', 'Comparación por unidad', 'Gasto mensual en supermercado'],
  },
  vehiculos: {
    key: 'vehiculos',
    title: 'Vehículos',
    icon: 'fa-car',
    phase: 5,
    summary: 'Mantenciones, combustible y vencimientos de revisión técnica, permiso de circulación y seguros.',
    features: ['Kilometraje e historial', 'Combustible y rendimiento', 'Mantenciones y talleres', 'Avisos por fecha o kilometraje'],
  },
  salud: {
    key: 'salud',
    title: 'Salud',
    icon: 'fa-heart-pulse',
    phase: 6,
    summary: 'Tus controles, profesionales y exámenes ordenados, con protección reforzada.',
    features: ['Profesionales y centros', 'Citas y controles', 'Exámenes y documentos', 'Recordatorios de próximos controles'],
  },
};
