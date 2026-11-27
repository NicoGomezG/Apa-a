import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatDay } from '../../core/format/format';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { relativeDays } from './salud.models';
import { HealthService } from './salud.service';
import {
  addDays,
  type Dose,
  dosesOn,
  DURATION_OPTIONS,
  everyDaysLabel,
  everyHoursLabel,
  type HealthTracker,
  type HealthTrackerPayload,
  HOUR_OPTIONS,
  localNow,
  medicationPhase,
  nextDose,
  REPLACEMENT_PRESETS,
  replacementIcon,
  replacementView,
  type TrackerKind,
  treatmentDay,
} from './trackers.models';

type Status = { kind: 'success' | 'error'; message: string } | null;

interface Draft {
  kind: TrackerKind;
  name: string;
  everyDays: number | null;
  everyHours: number | null;
  startTime: string;
  startDate: string;
  /** Medicamento: '' = sin término. */
  endDate: string;
  notes: string;
}

/** Salud → Remedios y recambios: medicamentos cada N horas y recambios (lentes…) cada N días. */
@Component({
  selector: 'app-salud-trackers',
  imports: [FormsModule, EmptyState],
  templateUrl: './trackers.html',
  styleUrl: './trackers.scss',
})
export class SaludTrackers {
  private readonly health = inject(HealthService);
  private readonly profile = inject(ProfileService);

  protected readonly presets = REPLACEMENT_PRESETS;
  protected readonly hourOptions = HOUR_OPTIONS;
  protected readonly durationOptions = DURATION_OPTIONS;
  protected readonly formatDay = formatDay;
  protected readonly relativeDays = relativeDays;
  protected readonly everyDaysLabel = everyDaysLabel;
  protected readonly everyHoursLabel = everyHoursLabel;
  protected readonly icon = replacementIcon;

  /** Día y minuto de reloj en la zona de la persona; se actualiza cada minuto. */
  protected readonly now = signal(localNow(this.profile.timezone()));
  protected readonly today = computed(() => this.now().day);

  protected readonly trackers = signal<HealthTracker[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly status = signal<Status>(null);

  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);
  /** Recambio con el selector "Otro día" abierto. */
  protected readonly pickingDay = signal<string | null>(null);
  protected pickedDay = '';
  protected readonly showFinished = signal(false);
  protected draft: Draft = this.emptyDraft('replacement');

  protected readonly medications = computed(() => {
    const now = this.now();
    return this.trackers()
      .filter((item) => item.kind === 'medication')
      .map((tracker) => ({
        tracker,
        phase: medicationPhase(tracker, now.day),
        doses: dosesOn(tracker, now.day, now),
        next: nextDose(tracker, now),
        day: treatmentDay(tracker, now.day),
      }));
  });
  protected readonly activeMedications = computed(() => this.medications().filter((item) => item.phase !== 'finished'));
  protected readonly finishedMedications = computed(() => this.medications().filter((item) => item.phase === 'finished'));
  /** Tomas de hoy que ya pasaron y no se marcan. */
  protected readonly dueCount = computed(() =>
    this.activeMedications().reduce((sum, item) => sum + item.doses.filter((dose) => dose.status === 'due').length, 0),
  );

  protected readonly replacements = computed(() =>
    this.trackers()
      .filter((item) => item.kind === 'replacement')
      .map((tracker) => ({ tracker, view: replacementView(tracker, this.today()) }))
      .sort((a, b) => a.view.daysLeft - b.view.daysLeft),
  );

  constructor() {
    const timer = setInterval(() => this.now.set(localNow(this.profile.timezone())), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.trackers.set(await this.health.trackers());
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar tus remedios y recambios.') });
    } finally {
      this.loading.set(false);
    }
  }

  private emptyDraft(kind: TrackerKind): Draft {
    const minute = this.now().minute;
    // Medicamento: la próxima hora en punto como primera toma.
    const nextHour = Math.min(23, Math.floor(minute / 60) + 1);
    return {
      kind,
      name: '',
      everyDays: kind === 'replacement' ? 30 : null,
      everyHours: kind === 'medication' ? 8 : null,
      startTime: `${String(nextHour).padStart(2, '0')}:00`,
      startDate: this.today(),
      endDate: kind === 'medication' ? addDays(this.today(), 6) : '',
      notes: '',
    };
  }

  // --- Formulario ---------------------------------------------------------------------

  protected openNew(kind: TrackerKind): void {
    this.draft = this.emptyDraft(kind);
    this.editingId.set(null);
    this.formOpen.set(true);
    this.status.set(null);
    this.scrollToForm();
  }

  protected edit(tracker: HealthTracker): void {
    this.draft = {
      kind: tracker.kind,
      name: tracker.name,
      everyDays: tracker.everyDays,
      everyHours: tracker.everyHours,
      startTime: tracker.startTime ?? '08:00',
      startDate: tracker.startDate,
      endDate: tracker.endDate ?? '',
      notes: tracker.notes ?? '',
    };
    this.editingId.set(tracker.id);
    this.formOpen.set(true);
    this.status.set(null);
    this.scrollToForm();
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  protected usePreset(preset: { name: string; days: number }): void {
    this.draft.name = preset.name;
    this.draft.everyDays = preset.days;
  }

  /** "Por 7 días": el término queda en el día 7 contando el de inicio. */
  protected setDuration(days: number | null): void {
    this.draft.endDate = days === null || !this.draft.startDate ? '' : addDays(this.draft.startDate, days - 1);
  }

  protected durationDays(): number | null {
    if (!this.draft.endDate || !this.draft.startDate || this.draft.endDate < this.draft.startDate) return null;
    return Math.round((Date.parse(this.draft.endDate) - Date.parse(this.draft.startDate)) / 86_400_000) + 1;
  }

  protected async save(): Promise<void> {
    const draft = this.draft;
    const name = draft.name.trim();
    if (!name) {
      this.status.set({ kind: 'error', message: draft.kind === 'medication' ? 'Escribe el nombre del medicamento.' : 'Escribe qué recambias.' });
      return;
    }
    if (!draft.startDate) {
      this.status.set({ kind: 'error', message: 'Indica desde qué día.' });
      return;
    }
    let payload: HealthTrackerPayload;
    if (draft.kind === 'replacement') {
      const everyDays = Number(draft.everyDays);
      if (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > 730) {
        this.status.set({ kind: 'error', message: 'Cada cuántos días: un número entre 1 y 730.' });
        return;
      }
      payload = { kind: 'replacement', name, everyDays, startDate: draft.startDate, notes: draft.notes };
    } else {
      const everyHours = Number(draft.everyHours);
      if (!Number.isInteger(everyHours) || everyHours < 1 || everyHours > 168) {
        this.status.set({ kind: 'error', message: 'Cada cuántas horas: un número entre 1 y 168.' });
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(draft.startTime)) {
        this.status.set({ kind: 'error', message: 'Indica la hora de la primera toma.' });
        return;
      }
      if (draft.endDate && draft.endDate < draft.startDate) {
        this.status.set({ kind: 'error', message: 'El término no puede ser antes del inicio.' });
        return;
      }
      payload = {
        kind: 'medication',
        name,
        everyHours,
        startTime: draft.startTime,
        startDate: draft.startDate,
        endDate: draft.endDate || null,
        notes: draft.notes,
      };
    }

    const editingId = this.editingId();
    this.busy.set(true);
    this.status.set(null);
    try {
      if (editingId) {
        const { kind: _kind, ...changes } = payload;
        const current = this.trackers().find((item) => item.id === editingId);
        const scheduleChanged =
          current?.kind === 'medication' &&
          (current.everyHours !== draft.everyHours || current.startTime !== draft.startTime || current.startDate !== draft.startDate);
        const updated = await this.health.updateTracker(editingId, changes);
        this.replace(updated);
        this.status.set({
          kind: 'success',
          message: scheduleChanged ? 'Guardamos el nuevo horario (las tomas marcadas se reiniciaron).' : 'Guardamos los cambios.',
        });
      } else {
        const created = await this.health.createTracker(payload);
        this.trackers.update((list) => [...list, created]);
        this.status.set({
          kind: 'success',
          message: created.kind === 'medication' ? `Agregamos ${created.name}.` : `Agregamos ${created.name}. Te avisamos cuando toque cambiarlos.`,
        });
      }
      this.closeForm();
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.busy.set(false);
    }
  }

  // --- Acciones -----------------------------------------------------------------------

  protected async changedOn(tracker: HealthTracker, day: string): Promise<void> {
    if (!day) return;
    await this.run(async () => {
      this.replace(await this.health.markChanged(tracker.id, day));
      this.pickingDay.set(null);
    }, day === this.today() ? 'Listo, anotamos el cambio de hoy.' : `Anotamos el cambio del ${formatDay(day)}.`);
  }

  protected openPicker(tracker: HealthTracker): void {
    this.pickedDay = this.today();
    this.pickingDay.set(this.pickingDay() === tracker.id ? null : tracker.id);
  }

  protected async markDose(tracker: HealthTracker, dose: Dose, status: 'taken' | 'skipped'): Promise<void> {
    await this.run(async () => this.replace(await this.health.markDose(tracker.id, dose.number, status)), null);
  }

  protected async undo(tracker: HealthTracker, eventId: string): Promise<void> {
    await this.run(async () => this.replace(await this.health.undoEvent(tracker.id, eventId)), null);
  }

  protected async remove(tracker: HealthTracker): Promise<void> {
    await this.run(async () => {
      await this.health.deleteTracker(tracker.id);
      this.trackers.update((list) => list.filter((item) => item.id !== tracker.id));
      this.confirmDelete.set(null);
    }, `Borramos ${tracker.name}.`);
  }

  private replace(updated: HealthTracker): void {
    this.trackers.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
  }

  private async run(action: () => Promise<void>, success: string | null): Promise<void> {
    this.busy.set(true);
    this.status.set(null);
    try {
      await action();
      if (success) this.status.set({ kind: 'success', message: success });
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.busy.set(false);
    }
  }

  private scrollToForm(): void {
    setTimeout(() => document.getElementById('form-seguimiento')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}
