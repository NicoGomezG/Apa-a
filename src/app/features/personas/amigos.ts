import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { daysUntilLabel, MONTH_NAMES, nextBirthday } from '../../core/calendar/birthdays';
import { formatDay, todayIn } from '../../core/format/format';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { friendName } from './friends';
import type { Contact, Friend, FriendInvite } from './people.models';
import { PeopleService } from './people.service';

type Status = { kind: 'success' | 'error'; message: string } | null;

/** Amigos con cuenta en Apaña: invitación por enlace, cumpleaños y enlace con tus contactos. */
@Component({
  selector: 'app-personas-amigos',
  imports: [FormsModule, RouterLink, EmptyState],
  template: `
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
      <p class="mb-0">
        Tus amigos con cuenta en Apaña ven los grupos de gastos donde los agregas, te avisan cuando te pagan y comparten su
        cumpleaños contigo.
      </p>
      <button type="button" class="btn btn-sm btn-primary" (click)="createInvite()" [disabled]="busy()">
        <i class="fa-solid fa-user-plus me-1" aria-hidden="true"></i>Invitar a un amigo
      </button>
    </div>

    @if (status(); as s) {
      <div class="alert py-2" [class.alert-success]="s.kind === 'success'" [class.alert-danger]="s.kind === 'error'" role="status">
        {{ s.message }}
      </div>
    }

    @if (invites().length > 0) {
      <section class="apana-card mb-3" aria-labelledby="invitaciones">
        <h2 id="invitaciones" class="apana-section-title"><i class="fa-solid fa-link" aria-hidden="true"></i>Invitaciones sin usar</h2>
        <p class="small mb-3">
          Envía el enlace a una sola persona: sirve una vez y vence en 7 días. Si no tiene cuenta, la crea y queda como tu amigo.
        </p>
        <ul class="list-unstyled d-grid gap-3 mb-0">
          @for (invite of invites(); track invite.id) {
            <li>
              <div class="input-group input-group-sm">
                <label class="visually-hidden" [for]="'inv-' + invite.id">Enlace de invitación</label>
                <input class="form-control" readonly [id]="'inv-' + invite.id" [value]="inviteUrl(invite)" (focus)="$any($event.target).select()" />
                @if (canShare) {
                  <button type="button" class="btn btn-primary" (click)="share(invite)">Compartir</button>
                }
                <button type="button" class="btn" [class.btn-primary]="!canShare" [class.btn-outline-primary]="canShare" (click)="copy(invite)">
                  {{ copied() === invite.id ? '¡Copiado!' : 'Copiar' }}
                </button>
                <button type="button" class="btn btn-outline-danger" (click)="revoke(invite)" [disabled]="busy()" aria-label="Anular invitación">
                  <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
              </div>
              <div class="small mt-1">Vence el {{ formatDay(invite.expiresAt.slice(0, 10)) }}</div>
            </li>
          }
        </ul>
      </section>
    }

    @if (loading()) {
      <p role="status">Cargando…</p>
    } @else if (friends().length === 0) {
      <section class="apana-card">
        <app-empty-state
          icon="fa-handshake"
          title="Aún no tienes amigos en Apaña"
          description="Invita a quienes comparten gastos contigo: verán lo que deben en cada grupo y podrán avisarte cuando te paguen."
        />
      </section>
    } @else {
      <ul class="list-unstyled row g-3">
        @for (row of rows(); track row.friend.userId) {
          <li class="col-12 col-md-6 col-xl-4">
            <article class="apana-card h-100 d-grid gap-2">
              <div class="d-flex align-items-center gap-2">
                <span class="avatar" aria-hidden="true">{{ initial(row.friend) }}</span>
                <div class="min-w-0">
                  <h3 class="h6 fw-bold mb-0 text-truncate">{{ name(row.friend) }}</h3>
                  @if (row.contact) {
                    <div class="small text-truncate">En tus contactos: {{ row.contact.name }}</div>
                  }
                </div>
              </div>
              <div class="small">
                @if (row.birthday; as birthday) {
                  <i class="fa-solid fa-cake-candles cake me-1" aria-hidden="true"></i>{{ birthdayText(row.friend) }} ·
                  {{ daysUntil(birthday.daysUntil) }}
                } @else {
                  Aún no indica su cumpleaños.
                }
              </div>
              @if (contacts().length > 0) {
                <div>
                  <label class="form-label small mb-1" [for]="'link-' + row.friend.userId">Contacto enlazado</label>
                  <select
                    class="form-select form-select-sm"
                    [id]="'link-' + row.friend.userId"
                    [ngModel]="row.friend.contactId"
                    (ngModelChange)="link(row.friend, $event)"
                    [disabled]="busy()"
                  >
                    <option [ngValue]="null">Ninguno</option>
                    @for (contact of contacts(); track contact.id) {
                      <option [ngValue]="contact.id">{{ contact.name }}</option>
                    }
                  </select>
                  <div class="form-text">Así no aparece dos veces en la Agenda.</div>
                </div>
              }
              <div class="mt-auto">
                @if (confirmRemove() === row.friend.userId) {
                  <span class="small me-2">¿Dejar de ser amigos? Ya no verá tus grupos.</span>
                  <button type="button" class="btn btn-sm btn-danger me-1" (click)="remove(row.friend)" [disabled]="busy()">Sí</button>
                  <button type="button" class="btn btn-sm btn-outline-primary" (click)="confirmRemove.set(null)">No</button>
                } @else {
                  <button type="button" class="btn btn-sm btn-outline-danger" (click)="confirmRemove.set(row.friend.userId)">Eliminar amigo</button>
                }
              </div>
            </article>
          </li>
        }
      </ul>
      <p class="small mt-3 mb-0">
        Para compartir gastos, agrégalos a un grupo desde <a routerLink="/personas/gastos">Gastos compartidos</a>.
      </p>
    }
  `,
  styles: `
    .avatar {
      display: inline-grid;
      place-items: center;
      flex: none;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 50%;
      background: var(--apana-section-color);
      color: #fff;
      font-weight: 700;
    }
    .min-w-0 {
      min-width: 0;
    }
    .cake {
      color: var(--apana-section-color);
    }
  `,
})
export class PersonasAmigos {
  private readonly people = inject(PeopleService);
  private readonly profile = inject(ProfileService);

  protected readonly formatDay = formatDay;
  protected readonly daysUntil = daysUntilLabel;
  protected readonly name = friendName;
  protected readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  protected readonly friends = signal<Friend[]>([]);
  protected readonly invites = signal<FriendInvite[]>([]);
  protected readonly contacts = signal<Contact[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly status = signal<Status>(null);
  protected readonly copied = signal<string | null>(null);
  protected readonly confirmRemove = signal<string | null>(null);

  private readonly today = todayIn(this.profile.timezone());

  protected readonly rows = computed(() => {
    const contacts = new Map(this.contacts().map((contact) => [contact.id, contact]));
    return this.friends()
      .map((friend) => ({
        friend,
        contact: friend.contactId ? (contacts.get(friend.contactId) ?? null) : null,
        birthday: nextBirthday({ id: friend.userId, name: friendName(friend), ...friend, birthYear: null }, this.today),
      }))
      .sort((a, b) => friendName(a.friend).localeCompare(friendName(b.friend)));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [friends, invites, contacts] = await Promise.all([this.people.friends(), this.people.invites(), this.people.contacts()]);
      this.friends.set(friends);
      this.invites.set(invites);
      this.contacts.set(contacts);
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar tus amigos.') });
    } finally {
      this.loading.set(false);
    }
  }

  private async run(action: () => Promise<unknown>, success?: string): Promise<void> {
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

  protected initial(friend: Friend): string {
    return friendName(friend).charAt(0).toUpperCase();
  }

  protected birthdayText(friend: Friend): string {
    return friend.birthDay && friend.birthMonth ? `${friend.birthDay} de ${MONTH_NAMES[friend.birthMonth - 1]}` : '';
  }

  protected inviteUrl(invite: FriendInvite): string {
    return `${location.origin}/amigos/unirse/${invite.code}`;
  }

  protected async createInvite(): Promise<void> {
    await this.run(async () => {
      const invite = await this.people.createInvite();
      this.invites.update((list) => [invite, ...list]);
    }, 'Creamos un enlace de invitación. Envíaselo a tu amigo.');
  }

  protected async revoke(invite: FriendInvite): Promise<void> {
    await this.run(async () => {
      await this.people.revokeInvite(invite.id);
      this.invites.update((list) => list.filter((item) => item.id !== invite.id));
    }, 'Anulamos la invitación: el enlace ya no funciona.');
  }

  protected async copy(invite: FriendInvite): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteUrl(invite));
      this.copied.set(invite.id);
      setTimeout(() => this.copied.set(null), 2000);
    } catch {
      this.status.set({ kind: 'error', message: 'No pudimos copiar. Selecciona el enlace y cópialo a mano.' });
    }
  }

  protected async share(invite: FriendInvite): Promise<void> {
    try {
      await navigator.share({ title: 'Apaña', text: 'Agrégame como amigo en Apaña:', url: this.inviteUrl(invite) });
    } catch {
      // La persona cerró el menú de compartir: no es un error.
    }
  }

  protected async link(friend: Friend, contactId: string | null): Promise<void> {
    await this.run(async () => {
      const updated = await this.people.linkFriendContact(friend.userId, contactId);
      this.friends.update((list) => list.map((item) => (item.userId === friend.userId ? updated : item)));
    });
  }

  protected async remove(friend: Friend): Promise<void> {
    await this.run(async () => {
      await this.people.removeFriend(friend.userId);
      this.friends.update((list) => list.filter((item) => item.userId !== friend.userId));
      this.confirmRemove.set(null);
    }, 'Ya no son amigos en Apaña.');
  }
}
