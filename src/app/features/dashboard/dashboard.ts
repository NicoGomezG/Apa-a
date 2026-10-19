import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatLongDate, greetingFor } from '../../core/format/format';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';

interface DashboardSection {
  key: string;
  title: string;
  icon: string;
  path: string;
  emptyTitle: string;
  emptyDescription: string;
}

// Cada sección se llena con datos reales cuando su módulo exista. Mientras tanto
// se muestra un estado vacío, nunca cifras de ejemplo.
const SECTIONS: DashboardSection[] = [
  {
    key: 'finanzas',
    title: 'Próximos pagos',
    icon: 'fa-wallet',
    path: '/finanzas',
    emptyTitle: 'Sin pagos por ahora',
    emptyDescription: 'Cuando registres suscripciones y cuentas, verás aquí lo que vence pronto.',
  },
  {
    key: 'agenda',
    title: 'Agenda y recordatorios',
    icon: 'fa-calendar-days',
    path: '/agenda',
    emptyTitle: 'Nada agendado',
    emptyDescription: 'Tus citas y recordatorios de todos los módulos aparecerán aquí.',
  },
  {
    key: 'personas',
    title: 'Cumpleaños y fechas',
    icon: 'fa-cake-candles',
    path: '/personas',
    emptyTitle: 'Sin fechas cercanas',
    emptyDescription: 'Agrega a tus personas para que no se te pase ningún cumpleaños.',
  },
  {
    key: 'vehiculos',
    title: 'Vehículos',
    icon: 'fa-car',
    path: '/vehiculos',
    emptyTitle: 'Sin vencimientos',
    emptyDescription: 'Revisión técnica, permiso de circulación y mantenciones, con aviso previo.',
  },
  {
    key: 'compras',
    title: 'Lista de compras',
    icon: 'fa-cart-shopping',
    path: '/compras',
    emptyTitle: 'Tu lista está vacía',
    emptyDescription: 'Arma tus listas del súper y lleva el historial de precios.',
  },
];

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, EmptyState],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  protected readonly profile = inject(ProfileService);
  protected readonly sections = SECTIONS;

  private readonly now = new Date();
  protected readonly greeting = computed(() => greetingFor(this.now, this.profile.timezone()));
  protected readonly today = computed(() => formatLongDate(this.now, this.profile.timezone()));

  protected readonly steps = computed(() => {
    const me = this.profile.me();
    return [
      { label: 'Crea tu cuenta', done: me !== null, path: null },
      { label: 'Cuéntanos cómo te llamas', done: Boolean(me?.displayName), path: '/ajustes' },
    ];
  });
}
