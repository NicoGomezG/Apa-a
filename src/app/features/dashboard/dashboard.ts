import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { daysUntilLabel, upcomingBirthdays, type UpcomingBirthday } from '../../core/calendar/birthdays';
import { nextHoliday } from '../../core/calendar/holidays-cl';
import { formatDay, formatLongDate, greetingFor, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import type { UpcomingPayment } from '../finanzas/finance.models';
import { FinanceService } from '../finanzas/finance.service';
import { PeopleService } from '../personas/people.service';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { daysBetween, pendingControls, relativeDays, SOON_DAYS } from '../salud/salud.models';
import { HealthService } from '../salud/salud.service';
import {
  dosesOn,
  type HealthTracker,
  localNow,
  medicationPhase,
  nextDose,
  REPLACEMENT_SOON_DAYS,
  replacementIcon,
  replacementView,
} from '../salud/trackers.models';

/** Lo próximo de Salud para Inicio: tomas de hoy, recambios que tocan y controles cercanos. */
export interface HealthHighlight {
  key: string;
  icon: string;
  label: string;
  detail: string;
  /** Rojo: toma por marcar, recambio que toca o atrasado. */
  urgent: boolean;
  /** Para ordenar: minutos de reloj hasta el momento (negativo = ya pasó). */
  order: number;
}

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
    title: 'Agenda',
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
    key: 'salud',
    title: 'Salud',
    icon: 'fa-heart-pulse',
    path: '/salud',
    emptyTitle: 'Nada pendiente',
    emptyDescription: 'Tus remedios de hoy, cuándo cambiar los lentes y tus próximos controles aparecerán aquí.',
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
  imports: [RouterLink, EmptyState, MoneyPipe],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  protected readonly profile = inject(ProfileService);
  private readonly finance = inject(FinanceService);
  private readonly people = inject(PeopleService);
  private readonly health = inject(HealthService);
  protected readonly daysUntilLabel = daysUntilLabel;

  /** Cumpleaños reales de los próximos 30 días. */
  protected readonly birthdays = signal<UpcomingBirthday[]>([]);
  protected readonly sections = SECTIONS;
  protected readonly formatDay = formatDay;

  /** Próximos pagos reales (tarjetas y suscripciones). Si falla, queda el estado vacío. */
  protected readonly upcomingPayments = signal<UpcomingPayment[]>([]);
  /** Lo próximo de Salud (máximo 5). Si falla, queda el estado vacío. */
  protected readonly healthItems = signal<HealthHighlight[]>([]);

  constructor() {
    this.finance
      .summary()
      .then((summary) => this.upcomingPayments.set(summary.upcoming.slice(0, 5)))
      .catch(() => this.upcomingPayments.set([]));
    this.people
      .birthdayPeople()
      .then((people) => this.birthdays.set(upcomingBirthdays(people, todayIn(this.profile.timezone(), this.now), 30).slice(0, 5)))
      .catch(() => this.birthdays.set([]));
    Promise.all([this.health.trackers(), this.health.visits()])
      .then(([trackers, visits]) => {
        const now = localNow(this.profile.timezone(), this.now);
        const items = [...trackerHighlights(trackers, now)];
        for (const visit of pendingControls(visits)) {
          const days = daysBetween(now.day, visit.nextDate);
          if (days > SOON_DAYS) continue;
          items.push({
            key: visit.id,
            icon: 'fa-calendar-check',
            label: `Control de ${visit.specialty}`,
            detail: `${formatDay(visit.nextDate)} · ${relativeDays(days)}`,
            urgent: days < 0,
            order: days * 1440,
          });
        }
        this.healthItems.set(items.sort((a, b) => a.order - b.order).slice(0, 5));
      })
      .catch(() => this.healthItems.set([]));
  }

  private readonly now = new Date();
  protected readonly greeting = computed(() => greetingFor(this.now, this.profile.timezone()));
  protected readonly today = computed(() => formatLongDate(this.now, this.profile.timezone()));
  /** Feriado real calculado por ley; no es un dato de ejemplo. */
  protected readonly nextHoliday = computed(() => nextHoliday(todayIn(this.profile.timezone(), this.now)));

  /** Primeros pasos: se esconde cuando ya están todos listos (o mientras carga el perfil). */
  protected readonly stepsPending = computed(() => this.profile.me() !== null && this.steps().some((step) => !step.done));

  protected readonly steps = computed(() => {
    const me = this.profile.me();
    return [
      { label: 'Crea tu cuenta', done: me !== null, path: null },
      { label: 'Cuéntanos cómo te llamas', done: Boolean(me?.displayName), path: '/ajustes' },
    ];
  });
}

function trackerHighlights(trackers: HealthTracker[], now: { day: string; minute: number }): HealthHighlight[] {
  const items: HealthHighlight[] = [];
  const nowClock = now.minute;
  for (const tracker of trackers) {
    if (tracker.kind === 'medication') {
      if (medicationPhase(tracker, now.day) === 'finished') continue;
      const due = dosesOn(tracker, now.day, now).filter((dose) => dose.status === 'due');
      if (due.length > 0) {
        const times = due.map((dose) => dose.time).join(', ');
        items.push({
          key: tracker.id,
          icon: 'fa-pills',
          label: tracker.name,
          detail: `Por marcar: ${times}`,
          urgent: true,
          order: -1,
        });
        continue;
      }
      const next = nextDose(tracker, now);
      if (!next) continue;
      const minutes = daysBetween(now.day, next.day) * 1440 + timeToMinutes(next.time) - nowClock;
      if (minutes > 1440) continue;
      items.push({
        key: tracker.id,
        icon: 'fa-pills',
        label: tracker.name,
        detail: next.day === now.day ? `Hoy a las ${next.time}` : `Mañana a las ${next.time}`,
        urgent: false,
        order: minutes,
      });
    } else {
      const view = replacementView(tracker, now.day);
      if (view.status === 'notStarted' || view.daysLeft > REPLACEMENT_SOON_DAYS) continue;
      items.push({
        key: tracker.id,
        icon: replacementIcon(tracker.name),
        label: tracker.name,
        detail: view.daysLeft === 0 ? 'Toca cambiarlos hoy' : view.daysLeft < 0 ? `Cambio atrasado (${relativeDays(view.daysLeft)})` : `Cambiar ${relativeDays(view.daysLeft)}`,
        urgent: view.daysLeft <= 0,
        order: view.daysLeft * 1440,
      });
    }
  }
  return items;
}

const timeToMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
