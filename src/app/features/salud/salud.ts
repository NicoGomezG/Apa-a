import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { formatDay, todayIn } from '../../core/format/format';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { PageHeader } from '../../shared/ui/page-header';
import {
  addMonths,
  CONTROL_STATUS_LABELS,
  controlStatus,
  daysBetween,
  type HealthVisit,
  type HealthVisitPayload,
  pendingControls,
  relativeDays,
  REPEAT_OPTIONS,
  type RepeatMonths,
  SPECIALTIES,
  specialtyIcon,
} from './salud.models';
import { HealthService } from './salud.service';
import { SaludTrackers } from './trackers';

type Status = { kind: 'success' | 'error'; message: string } | null;
/** "Repetir en" del formulario: sin repetir, 1/6/12 meses o una fecha elegida a mano. */
type RepeatChoice = 'none' | '1' | '6' | '12' | 'custom';

const OTHER = '__otra__';

interface Draft {
  specialty: string;
  customSpecialty: string;
  visitDate: string;
  professional: string;
  place: string;
  repeat: RepeatChoice;
  nextDate: string;
  notes: string;
}

@Component({
  selector: 'app-salud',
  imports: [FormsModule, RouterLink, PageHeader, EmptyState, SaludTrackers],
  host: { style: '--apana-section-color: var(--apana-module-salud)' },
  templateUrl: './salud.html',
  styleUrl: './salud.scss',
})
export class Salud {
  private readonly health = inject(HealthService);
  private readonly profile = inject(ProfileService);

  protected readonly specialties = SPECIALTIES;
  protected readonly repeatOptions = REPEAT_OPTIONS;
  protected readonly statusLabels = CONTROL_STATUS_LABELS;
  protected readonly other = OTHER;
  protected readonly icon = specialtyIcon;
  protected readonly formatDay = formatDay;
  protected readonly relativeDays = relativeDays;

  /** Pestaña: consultas o remedios y recambios (?vista=remedios, para enlazar desde Inicio). */
  protected readonly view = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => (params.get('vista') === 'remedios' ? 'remedios' : 'consultas'))),
    { initialValue: 'consultas' as const },
  );

  protected readonly today = signal(todayIn(this.profile.timezone()));
  protected readonly visits = signal<HealthVisit[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly status = signal<Status>(null);

  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  /** "Ya fui": la consulta cuyo control se cumple con la que se está anotando. */
  protected readonly completing = signal<HealthVisit | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);
  protected readonly expandedId = signal<string | null>(null);
  protected readonly filter = signal<string>('');
  protected draft: Draft = this.emptyDraft();

  protected readonly controls = computed(() =>
    pendingControls(this.visits()).map((visit) => {
      const days = daysBetween(this.today(), visit.nextDate);
      return { visit, days, status: controlStatus(visit.nextDate, this.today()) };
    }),
  );
  protected readonly lateCount = computed(() => this.controls().filter((item) => item.status === 'late').length);

  /** Especialidades presentes en el historial, para filtrar. */
  protected readonly usedSpecialties = computed(() =>
    [...new Set(this.visits().map((visit) => visit.specialty))].sort((a, b) => a.localeCompare(b, 'es')),
  );
  protected readonly history = computed(() => {
    const filter = this.filter();
    return this.visits().filter((visit) => !filter || visit.specialty === filter);
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.visits.set(await this.health.visits());
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar tus consultas.') });
    } finally {
      this.loading.set(false);
    }
  }

  private emptyDraft(): Draft {
    return {
      specialty: '',
      customSpecialty: '',
      visitDate: this.today(),
      professional: '',
      place: '',
      repeat: 'none',
      nextDate: '',
      notes: '',
    };
  }

  /** Vista previa del próximo control según "repetir en". */
  protected previewNext(): string | null {
    const { repeat, visitDate, nextDate } = this.draft;
    if (!visitDate) return null;
    if (repeat === 'custom') return nextDate || null;
    return repeat === 'none' ? null : addMonths(visitDate, Number(repeat));
  }

  protected isFuture(visit: HealthVisit): boolean {
    return visit.visitDate > this.today();
  }

  protected openNew(): void {
    this.draft = this.emptyDraft();
    this.editingId.set(null);
    this.completing.set(null);
    this.formOpen.set(true);
    this.status.set(null);
    this.scrollToForm();
  }

  /** "Ya fui": nueva consulta con los datos del control, que lo deja cumplido. */
  protected markDone(visit: HealthVisit): void {
    this.fillDraft(visit);
    this.draft.visitDate = this.today();
    this.draft.notes = '';
    if (this.draft.repeat === 'custom') this.draft.repeat = 'none';
    this.draft.nextDate = '';
    this.editingId.set(null);
    this.completing.set(visit);
    this.formOpen.set(true);
    this.status.set(null);
    this.scrollToForm();
  }

  protected edit(visit: HealthVisit): void {
    this.fillDraft(visit);
    this.editingId.set(visit.id);
    this.completing.set(null);
    this.formOpen.set(true);
    this.status.set(null);
    this.scrollToForm();
  }

  private fillDraft(visit: HealthVisit): void {
    const known = SPECIALTIES.some((item) => item.name === visit.specialty);
    const computedNext = visit.repeatMonths ? addMonths(visit.visitDate, visit.repeatMonths) : null;
    const custom = visit.nextDate !== null && visit.nextDate !== computedNext;
    this.draft = {
      specialty: known ? visit.specialty : OTHER,
      customSpecialty: known ? '' : visit.specialty,
      visitDate: visit.visitDate,
      professional: visit.professional ?? '',
      place: visit.place ?? '',
      repeat: custom ? 'custom' : visit.repeatMonths ? (String(visit.repeatMonths) as RepeatChoice) : 'none',
      nextDate: custom ? (visit.nextDate ?? '') : '',
      notes: visit.notes ?? '',
    };
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
    this.completing.set(null);
  }

  protected async save(): Promise<void> {
    const specialty = (this.draft.specialty === OTHER ? this.draft.customSpecialty : this.draft.specialty).trim();
    if (!specialty) {
      this.status.set({ kind: 'error', message: 'Elige o escribe la especialidad.' });
      return;
    }
    if (!this.draft.visitDate) {
      this.status.set({ kind: 'error', message: 'Indica el día de la consulta.' });
      return;
    }
    const custom = this.draft.repeat === 'custom';
    if (custom && !this.draft.nextDate) {
      this.status.set({ kind: 'error', message: 'Elige la fecha del próximo control.' });
      return;
    }
    if (custom && this.draft.nextDate < this.draft.visitDate) {
      this.status.set({ kind: 'error', message: 'El próximo control no puede ser antes de la consulta.' });
      return;
    }

    const repeatMonths = custom || this.draft.repeat === 'none' ? null : (Number(this.draft.repeat) as RepeatMonths);
    const payload: HealthVisitPayload = {
      specialty,
      professional: this.draft.professional,
      place: this.draft.place,
      visitDate: this.draft.visitDate,
      repeatMonths,
      // Con "repetir en" lo calcula el servidor; sin repetir, se borra.
      nextDate: custom ? this.draft.nextDate : repeatMonths ? undefined : null,
      notes: this.draft.notes,
    };

    const editingId = this.editingId();
    const completing = this.completing();
    this.busy.set(true);
    this.status.set(null);
    try {
      if (editingId) {
        const updated = await this.health.updateVisit(editingId, payload);
        this.visits.update((list) => list.map((item) => (item.id === editingId ? updated : item)));
        this.status.set({ kind: 'success', message: 'Guardamos los cambios.' });
      } else {
        const created = await this.health.createVisit({ ...payload, completesVisitId: completing?.id });
        this.visits.update((list) =>
          sortVisits([created, ...list.map((item) => (item.id === completing?.id ? { ...item, nextDone: true } : item))]),
        );
        this.status.set({
          kind: 'success',
          message: created.nextDate
            ? `Anotamos la consulta. Próximo control: ${formatDay(created.nextDate, true)}.`
            : 'Anotamos la consulta.',
        });
      }
      this.closeForm();
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.busy.set(false);
    }
  }

  /** Quita el control pendiente (la consulta queda en el historial). */
  protected async dropControl(visit: HealthVisit): Promise<void> {
    await this.run(async () => {
      const updated = await this.health.updateVisit(visit.id, { repeatMonths: null, nextDate: null });
      this.visits.update((list) => list.map((item) => (item.id === visit.id ? updated : item)));
    }, 'Quitamos ese control.');
  }

  protected async remove(visit: HealthVisit): Promise<void> {
    await this.run(async () => {
      await this.health.deleteVisit(visit.id);
      this.visits.update((list) => list.filter((item) => item.id !== visit.id));
      this.confirmDelete.set(null);
    }, 'Borramos la consulta.');
  }

  private async run(action: () => Promise<void>, success: string): Promise<void> {
    this.busy.set(true);
    this.status.set(null);
    try {
      await action();
      this.status.set({ kind: 'success', message: success });
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.busy.set(false);
    }
  }

  private scrollToForm(): void {
    setTimeout(() => document.getElementById('form-consulta')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

function sortVisits(list: HealthVisit[]): HealthVisit[] {
  return [...list].sort((a, b) => b.visitDate.localeCompare(a.visitDate) || b.createdAt.localeCompare(a.createdAt));
}
