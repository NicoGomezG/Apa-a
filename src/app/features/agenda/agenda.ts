import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { birthdaysInMonth, type BirthdayPerson, type UpcomingBirthday } from '../../core/calendar/birthdays';
import { holidaysInMonth, nextHoliday, type Holiday } from '../../core/calendar/holidays-cl';
import { monthGrid, WEEKDAY_LABELS, type GridDay } from '../../core/calendar/month-grid';
import { formatDay, formatMonth, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { MonthPicker } from '../../shared/ui/month-picker';
import { PageHeader } from '../../shared/ui/page-header';
import {
  type CalendarPayment,
  PAYMENT_SHORT_LABELS,
  PAYMENT_TYPE_LABELS,
  type PaymentStatus,
  paymentIcon,
} from '../finanzas/finance.models';
import { FinanceService } from '../finanzas/finance.service';
import { PeopleService } from '../personas/people.service';
import type { HealthVisit } from '../salud/salud.models';
import { HealthService } from '../salud/salud.service';

/** Control pendiente u hora agendada de Salud, para el calendario. */
export interface HealthEvent {
  key: string;
  kind: 'control' | 'appointment';
  label: string;
}

export const STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'Pagado',
  pending: 'Por pagar',
  unconfirmed: 'Sin confirmar',
};

const STATUS_ICONS: Record<PaymentStatus, string> = {
  paid: 'fa-circle-check',
  pending: 'fa-clock',
  unconfirmed: 'fa-circle-question',
};

const LONG_DAY = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

interface Cell extends GridDay {
  holiday: Holiday | null;
  /** Domingo o feriado: el número va en rojo. */
  red: boolean;
  isToday: boolean;
  payments: CalendarPayment[];
  birthdays: UpcomingBirthday[];
  health: HealthEvent[];
  ariaLabel: string;
}

@Component({
  selector: 'app-agenda',
  imports: [PageHeader, MonthPicker, MoneyPipe, RouterLink],
  host: { style: '--apana-section-color: var(--apana-module-agenda)' },
  templateUrl: './agenda.html',
  styleUrl: './agenda.scss',
})
export class Agenda {
  private readonly finance = inject(FinanceService);
  private readonly profile = inject(ProfileService);
  private readonly people = inject(PeopleService);
  private readonly healthService = inject(HealthService);

  protected readonly weekdays = WEEKDAY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly paymentIcon = paymentIcon;
  protected readonly paymentTypeLabels = PAYMENT_TYPE_LABELS;
  protected readonly paymentShortLabels = PAYMENT_SHORT_LABELS;
  protected readonly statusIcons = STATUS_ICONS;
  protected readonly formatDay = formatDay;

  protected readonly today = signal(todayIn(this.profile.timezone()));
  protected readonly month = signal(this.today().slice(0, 7));
  protected readonly selected = signal(this.today());
  protected readonly payments = signal<CalendarPayment[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly contacts = signal<BirthdayPerson[]>([]);
  protected readonly birthdays = computed(() => birthdaysInMonth(this.contacts(), this.month()));
  protected readonly birthdayList = computed(() => [...this.birthdays().values()].flat());
  protected readonly visits = signal<HealthVisit[]>([]);
  /** Controles pendientes (por su fecha) y horas agendadas desde hoy, por día. */
  protected readonly health = computed(() => {
    const byDay = new Map<string, HealthEvent[]>();
    const add = (date: string, event: HealthEvent) => byDay.set(date, [...(byDay.get(date) ?? []), event]);
    for (const visit of this.visits()) {
      if (visit.nextDate && !visit.nextDone) {
        add(visit.nextDate, { key: 'c-' + visit.id, kind: 'control', label: 'Control de ' + visit.specialty });
      }
      if (visit.visitDate >= this.today()) {
        add(visit.visitDate, { key: 'a-' + visit.id, kind: 'appointment', label: 'Hora: ' + visit.specialty });
      }
    }
    return byDay;
  });

  protected readonly monthLabel = computed(() => formatMonth(this.month()));
  protected readonly holidays = computed(() => holidaysInMonth(this.month()));
  protected readonly holidayList = computed(() => [...this.holidays().values()]);
  protected readonly nextHoliday = computed(() => nextHoliday(this.today()));

  protected readonly weeks = computed<Cell[][]>(() => {
    const holidays = this.holidays();
    const birthdays = this.birthdays();
    const health = this.health();
    const today = this.today();
    const byDay = new Map<string, CalendarPayment[]>();
    for (const payment of this.payments()) {
      byDay.set(payment.date, [...(byDay.get(payment.date) ?? []), payment]);
    }
    return monthGrid(this.month()).map((week) =>
      week.map((day) => {
        const holiday = day.inMonth ? (holidays.get(day.date) ?? null) : null;
        const payments = day.inMonth ? (byDay.get(day.date) ?? []) : [];
        const dayBirthdays = day.inMonth ? (birthdays.get(day.date) ?? []) : [];
        const dayHealth = day.inMonth ? (health.get(day.date) ?? []) : [];
        const parts = [longDay(day.date)];
        if (holiday) parts.push(`feriado: ${holiday.name}`);
        if (dayBirthdays.length) parts.push(`cumpleaños de ${dayBirthdays.map((item) => item.person.name).join(' y ')}`);
        if (dayHealth.length) parts.push(dayHealth.map((item) => item.label).join(', '));
        if (payments.length) parts.push(payments.length === 1 ? '1 pago' : `${payments.length} pagos`);
        return {
          ...day,
          holiday,
          red: day.weekday === 0 || holiday !== null,
          isToday: day.date === today,
          payments,
          birthdays: dayBirthdays,
          health: dayHealth,
          ariaLabel: parts.join(', '),
        };
      }),
    );
  });

  protected readonly selectedDay = computed(() => {
    const date = this.selected();
    return {
      date,
      label: longDay(date),
      holiday: this.holidays().get(date) ?? null,
      sunday: new Date(`${date}T12:00:00Z`).getUTCDay() === 0,
      payments: this.payments().filter((payment) => payment.date === date),
      birthdays: this.birthdays().get(date) ?? [],
      health: this.health().get(date) ?? [],
    };
  });

  /** Totales del mes por moneda y conteo por estado. */
  protected readonly totals = computed(() => {
    const byCurrency = new Map<string, bigint>();
    const counts: Record<PaymentStatus, number> = { paid: 0, pending: 0, unconfirmed: 0 };
    for (const payment of this.payments()) {
      counts[payment.status] += 1;
      if (payment.amount !== null) {
        byCurrency.set(payment.currency, (byCurrency.get(payment.currency) ?? 0n) + BigInt(payment.amount));
      }
    }
    return {
      amounts: [...byCurrency].map(([currency, amount]) => ({ currency, amount })),
      counts,
    };
  });

  constructor() {
    effect(() => {
      void this.load(this.month());
    });
    void this.people
      .birthdayPeople()
      .then((people) => this.contacts.set(people))
      .catch(() => undefined);
    // Salud es opcional en la Agenda: si falla, el calendario sigue con lo demás.
    void this.healthService
      .visits()
      .then((visits) => this.visits.set(visits))
      .catch(() => undefined);
  }

  private async load(month: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const calendar = await this.finance.calendar(month);
      if (calendar.month !== this.month()) return; // llegó tarde una respuesta de otro mes
      this.today.set(calendar.today);
      this.payments.set(calendar.payments);
    } catch (error) {
      this.payments.set([]);
      this.error.set(apiErrorMessage(error, 'No pudimos cargar tus pagos. Los feriados sí se muestran.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected changeMonth(month: string): void {
    this.month.set(month);
    const today = this.today();
    this.selected.set(today.startsWith(month) ? today : `${month}-01`);
  }

  protected goToday(): void {
    const today = todayIn(this.profile.timezone());
    this.today.set(today);
    this.month.set(today.slice(0, 7));
    this.selected.set(today);
  }

  protected select(cell: Cell): void {
    if (!cell.inMonth) {
      this.changeMonth(cell.date.slice(0, 7));
    }
    this.selected.set(cell.date);
  }
}

function longDay(date: string): string {
  return LONG_DAY.format(new Date(`${date}T12:00:00Z`));
}
