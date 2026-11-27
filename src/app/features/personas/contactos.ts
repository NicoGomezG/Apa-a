import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { daysUntilLabel, MONTH_NAMES, nextBirthday, upcomingBirthdays } from '../../core/calendar/birthdays';
import { formatDay, todayIn } from '../../core/format/format';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { RELATIONSHIP_LABELS, RELATIONSHIPS, type Contact, type ContactPayload, type Relationship } from './people.models';
import { PeopleService } from './people.service';


/** Días del mes contando el 29 de febrero (vale para cumpleaños sin año). */
const maxDay = (month: number | null) => (month ? new Date(Date.UTC(2000, month, 0)).getUTCDate() : 31);

interface Draft {
  name: string;
  nickname: string;
  birthDay: number | null;
  birthMonth: number | null;
  birthYear: string;
  phone: string;
  email: string;
  relationship: Relationship | '';
  notes: string;
}

const emptyDraft = (): Draft => ({
  name: '',
  nickname: '',
  birthDay: null,
  birthMonth: null,
  birthYear: '',
  phone: '',
  email: '',
  relationship: '',
  notes: '',
});

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

@Component({
  selector: 'app-personas-contactos',
  imports: [FormsModule, EmptyState],
  templateUrl: './contactos.html',
  styles: `
    .avatar {
      width: 2.5rem;
      height: 2.5rem;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: var(--apana-section-color);
      color: #fff;
      font-weight: 600;
      flex-shrink: 0;
    }
    .cake {
      color: var(--apana-section-color);
    }
    .today {
      font-weight: 600;
      color: var(--apana-section-color);
    }
  `,
})
export class PersonasContactos {
  private readonly people = inject(PeopleService);
  private readonly profile = inject(ProfileService);

  protected readonly relationships = RELATIONSHIPS;
  protected readonly relationshipLabels = RELATIONSHIP_LABELS;
  protected readonly months = MONTH_NAMES;
  protected readonly formatDay = formatDay;
  protected readonly daysUntilLabel = daysUntilLabel;

  protected readonly contacts = signal<Contact[]>([]);
  protected readonly loading = signal(true);
  protected readonly status = signal<{ kind: 'success' | 'error'; message: string } | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly confirmDeleteId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly search = signal('');
  protected draft: Draft = emptyDraft();

  private readonly today = todayIn(this.profile.timezone());

  protected readonly upcoming = computed(() => upcomingBirthdays(this.contacts(), this.today, 60));

  protected readonly rows = computed(() => {
    const query = normalize(this.search().trim());
    return this.contacts()
      .filter((contact) => !query || normalize(`${contact.name} ${contact.nickname ?? ''}`).includes(query))
      .map((contact) => ({ contact, birthday: nextBirthday(contact, this.today) }));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.contacts.set(await this.people.contacts());
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar tus contactos.') });
    } finally {
      this.loading.set(false);
    }
  }

  protected dayOptions(): number[] {
    return Array.from({ length: maxDay(this.draft.birthMonth) }, (_, index) => index + 1);
  }

  protected birthdayText(contact: Contact): string {
    if (!contact.birthDay || !contact.birthMonth) return '';
    return `${contact.birthDay} de ${MONTH_NAMES[contact.birthMonth - 1]}`;
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('');
  }

  protected openNew(): void {
    this.draft = emptyDraft();
    this.editingId.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(contact: Contact): void {
    this.draft = {
      name: contact.name,
      nickname: contact.nickname ?? '',
      birthDay: contact.birthDay,
      birthMonth: contact.birthMonth,
      birthYear: contact.birthYear ? String(contact.birthYear) : '',
      phone: contact.phone ?? '',
      email: contact.email ?? '',
      relationship: contact.relationship ?? '',
      notes: contact.notes ?? '',
    };
    this.editingId.set(contact.id);
    this.formOpen.set(true);
  }

  protected async save(): Promise<void> {
    const draft = this.draft;
    if (!draft.name.trim()) {
      this.status.set({ kind: 'error', message: 'Escribe al menos el nombre.' });
      return;
    }
    if ((draft.birthDay === null) !== (draft.birthMonth === null)) {
      this.status.set({ kind: 'error', message: 'Para el cumpleaños elige el día y el mes.' });
      return;
    }
    if (draft.birthDay !== null && draft.birthDay > maxDay(draft.birthMonth)) {
      this.status.set({ kind: 'error', message: 'Ese día no existe en ese mes.' });
      return;
    }
    const year = draft.birthYear.trim();
    if (year && (!/^\d{4}$/.test(year) || draft.birthDay === null)) {
      this.status.set({ kind: 'error', message: 'El año va con 4 dígitos y junto al día y el mes.' });
      return;
    }
    const payload: ContactPayload = {
      name: draft.name.trim(),
      nickname: draft.nickname.trim() || null,
      birthDay: draft.birthDay,
      birthMonth: draft.birthMonth,
      birthYear: year ? Number(year) : null,
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      relationship: draft.relationship || null,
      notes: draft.notes.trim() || null,
    };
    this.saving.set(true);
    this.status.set(null);
    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.people.updateContact(id, payload);
        this.contacts.update((list) => list.map((item) => (item.id === id ? updated : item)));
      } else {
        const created = await this.people.createContact(payload);
        this.contacts.update((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
      }
      this.formOpen.set(false);
      this.status.set({ kind: 'success', message: 'Guardamos el contacto.' });
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(contact: Contact): Promise<void> {
    try {
      await this.people.deleteContact(contact.id);
      this.contacts.update((list) => list.filter((item) => item.id !== contact.id));
      this.confirmDeleteId.set(null);
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    }
  }
}
