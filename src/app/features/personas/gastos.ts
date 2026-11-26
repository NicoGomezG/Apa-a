import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { formatDay, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import type { Contact, GroupSummary } from './people.models';
import { PeopleService } from './people.service';

interface PendingParticipant {
  name: string;
  contactId: string | null;
}

@Component({
  selector: 'app-personas-gastos',
  imports: [FormsModule, RouterLink, MoneyPipe, EmptyState],
  templateUrl: './gastos.html',
  styles: `
    .group-card {
      display: block;
      color: inherit;
      text-decoration: none;
    }
    .group-card:hover {
      border-color: var(--apana-section-color);
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.35rem 0.25rem 0.7rem;
      border-radius: 999px;
      border: 1px solid var(--bs-border-color);
      background: var(--bs-body-bg);
      font-weight: 600;
      font-size: 0.9rem;
    }
    .chip button {
      border: 0;
      background: transparent;
      color: var(--bs-body-color);
      padding: 0 0.35rem;
    }
    .positive {
      color: var(--bs-success);
    }
    .negative {
      color: var(--bs-danger);
    }
  `,
})
export class PersonasGastos {
  private readonly people = inject(PeopleService);
  private readonly profile = inject(ProfileService);
  private readonly router = inject(Router);

  protected readonly formatDay = formatDay;

  protected readonly groups = signal<GroupSummary[]>([]);
  protected readonly contacts = signal<Contact[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);

  protected name = '';
  protected date = todayIn(this.profile.timezone());
  protected newName = '';
  protected contactChoice = '';
  protected readonly pending = signal<PendingParticipant[]>([]);

  /** Contactos que aún no están en la lista del grupo nuevo. */
  protected readonly availableContacts = computed(() => {
    const chosen = new Set(this.pending().map((item) => item.contactId));
    return this.contacts().filter((contact) => !chosen.has(contact.id));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [groups, contacts] = await Promise.all([this.people.groups(), this.people.contacts()]);
      this.groups.set(groups);
      this.contacts.set(contacts);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'No pudimos cargar tus grupos.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected balanceOf(group: GroupSummary): bigint {
    return BigInt(group.myBalance ?? '0');
  }

  /** 1, -1 o 0 (las plantillas no aceptan literales BigInt como 0n). */
  protected sign(value: bigint): number {
    return value > 0n ? 1 : value < 0n ? -1 : 0;
  }

  protected abs(value: bigint): bigint {
    return value < 0n ? -value : value;
  }

  protected addContact(): void {
    const contact = this.contacts().find((item) => item.id === this.contactChoice);
    if (!contact) return;
    this.pending.update((list) => [...list, { name: contact.nickname || contact.name, contactId: contact.id }]);
    this.contactChoice = '';
  }

  protected addName(): void {
    const name = this.newName.trim();
    if (!name) return;
    this.pending.update((list) => [...list, { name, contactId: null }]);
    this.newName = '';
  }

  protected removePending(index: number): void {
    this.pending.update((list) => list.filter((_, i) => i !== index));
  }

  protected async create(): Promise<void> {
    if (this.newName.trim()) this.addName();
    if (!this.name.trim()) {
      this.error.set('Ponle un nombre al grupo, por ejemplo "Asado sábado".');
      return;
    }
    if (this.pending().length === 0) {
      this.error.set('Agrega al menos a una persona más.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const detail = await this.people.createGroup({ name: this.name.trim(), date: this.date || null, participants: this.pending() });
      await this.router.navigate(['/personas/gastos', detail.group.id]);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'No pudimos crear el grupo.'));
    } finally {
      this.saving.set(false);
    }
  }
}
