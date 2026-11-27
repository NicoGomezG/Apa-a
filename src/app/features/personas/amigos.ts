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

    @if (current(); as invite) {
      <section class="apana-card mb-3" aria-labelledby="invitaciones">
        <h2 id="invitaciones" class="apana-section-title"><i class="fa-solid fa-link" aria-hidden="true"></i>Enlace de invitación</h2>
        <p class="small mb-3">
          Envía el enlace a una sola persona: sirve una vez y vence en 7 días. Si no tiene cuenta, la crea y queda como tu amigo.
        </p>
        <div class="d-grid gap-3">
            <div>
              <label class="visually-hidden" [for]="'inv-' + invite.id">Enlace de invitación</label>
              <input class="form-control form-control-sm mb-2" readonly [id]="'inv-' + invite.id" [value]="inviteUrl(invite)" (focus)="$any($event.target).select()" />
              <div class="d-flex flex-wrap gap-2">
                @if (canShare) {
                  <button type="button" class="btn btn-sm btn-primary" (click)="share(invite)">Compartir</button>
                }
                <button type="button" class="btn btn-sm" [class.btn-primary]="!canShare" [class.btn-outline-primary]="canShare" (click)="copy(invite)">
                  {{ copied() === invite.id ? '¡Copiado!' : 'Copiar' }}
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary"
                  (click)="toggleQr(invite)"
                  [attr.aria-expanded]="qrFor() === invite.id"
                  [attr.aria-controls]="'qr-' + invite.id"
                >
                  <i class="fa-solid fa-qrcode me-1" aria-hidden="true"></i>QR
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger ms-auto" (click)="revoke(invite)" [disabled]="busy()">
                  <i class="fa-solid fa-xmark me-1" aria-hidden="true"></i>Anular
                </button>
              </div>
              <div class="small mt-1">Vence el {{ formatDay(invite.expiresAt.slice(0, 10)) }}</div>
              @if (qrFor() === invite.id) {
                <div class="qr-panel mt-2" [id]="'qr-' + invite.id">
                  @if (qrImage(); as image) {
                    <img [src]="image" width="240" height="240" alt="Código QR de la invitación" />
                  } @else {
                    <div class="qr-placeholder" role="status">Generando…</div>
                  }
                  <p class="small mb-0">Pídele a tu amigo que lo escanee con la cámara del celular. Sirve una sola vez.</p>
                </div>
              }
            </div>
          <div class="d-flex flex-wrap align-items-center gap-2 small">
            <span>¿Vas a invitar a otra persona?</span>
            <button type="button" class="btn btn-link btn-sm p-0" (click)="newInvite()" [disabled]="busy()">Crear otro enlace</button>
          </div>
          @if (older().length > 0) {
            <div class="d-flex flex-wrap align-items-center gap-2 small">
              <span>{{ older().length === 1 ? 'Tienes 1 enlace anterior sin usar' : 'Tienes ' + older().length + ' enlaces anteriores sin usar' }}.</span>
              <button type="button" class="btn btn-link btn-sm p-0 text-danger" (click)="revokeOlder()" [disabled]="busy()">Anular</button>
            </div>
          }
        </div>
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
                <div class="min-w-0 flex-grow-1">
                  <h3 class="h6 fw-bold mb-0 text-truncate">{{ name(row.friend) }}</h3>
                  @if (row.friend.nickname && row.friend.displayName) {
                    <div class="small text-truncate">{{ row.friend.displayName }}</div>
                  } @else if (row.contact) {
                    <div class="small text-truncate">En tus contactos: {{ row.contact.name }}</div>
                  }
                </div>
                @if (editingNickname() !== row.friend.userId) {
                  <button type="button" class="btn btn-sm btn-link p-0 flex-none" (click)="startNickname(row.friend)"
                          [attr.aria-label]="'Apodo para ' + name(row.friend)">
                    {{ row.friend.nickname ? 'Cambiar apodo' : 'Ponerle apodo' }}
                  </button>
                }
              </div>
              @if (editingNickname() === row.friend.userId) {
                <form class="d-flex gap-2" (ngSubmit)="saveNickname(row.friend)">
                  <label class="visually-hidden" [for]="'nick-' + row.friend.userId">Apodo</label>
                  <input class="form-control form-control-sm" [id]="'nick-' + row.friend.userId" name="nickname" maxlength="40"
                         placeholder="Cómo le dices" [(ngModel)]="nicknameDraft" />
                  <button type="submit" class="btn btn-sm btn-primary" [disabled]="busy()">Guardar</button>
                  <button type="button" class="btn btn-sm btn-outline-primary" (click)="editingNickname.set(null)">Cancelar</button>
                </form>
                <div class="form-text mt-0">Solo lo ves tú. Déjalo vacío para quitarlo.</div>
              }
              @if (row.friend.phone; as phone) {
                <div class="d-flex flex-wrap align-items-center gap-2 small">
                  <i class="fa-solid fa-phone cake" aria-hidden="true"></i>
                  <a [href]="'tel:' + phoneDigits(phone)">{{ phone }}</a>
                  <a class="btn btn-sm btn-outline-primary py-0" [href]="whatsapp(phone)" target="_blank" rel="noopener">
                    <i class="fa-brands fa-whatsapp me-1" aria-hidden="true"></i>WhatsApp
                  </a>
                </div>
              }
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
              <div class="mt-auto d-flex flex-wrap align-items-center gap-2">
                <a class="btn btn-sm btn-primary" [routerLink]="['/personas/mensajes/amigo', row.friend.userId]">
                  <i class="fa-solid fa-comment me-1" aria-hidden="true"></i>Mensaje
                </a>
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
      font-weight: 600;
    }
    .min-w-0 {
      min-width: 0;
    }
    .flex-none {
      flex: none;
    }
    .cake {
      color: var(--apana-section-color);
    }
    .qr-panel {
      display: grid;
      justify-items: center;
      gap: 0.5rem;
      padding: 1.25rem;
      border: 1px solid var(--bs-border-color);
      border-radius: 10px;
      background: #fff;
      text-align: center;
    }
    .qr-panel img,
    .qr-placeholder {
      width: 240px;
      max-width: 100%;
      height: auto;
      aspect-ratio: 1;
    }
    .qr-placeholder {
      display: grid;
      place-items: center;
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
  protected readonly qrFor = signal<string | null>(null);
  protected readonly qrImage = signal<string | null>(null);
  protected readonly editingNickname = signal<string | null>(null);
  protected nicknameDraft = '';

  private readonly today = todayIn(this.profile.timezone());

  /** Se muestra un solo enlace: el más nuevo. Los anteriores siguen vigentes hasta usarse o anularse. */
  private readonly sortedInvites = computed(() => [...this.invites()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  protected readonly current = computed(() => this.sortedInvites()[0] ?? null);
  protected readonly older = computed(() => this.sortedInvites().slice(1));

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

  /** Si ya hay un enlace sin usar, se muestra ese en vez de crear otro (evita duplicados por doble toque). */
  protected async createInvite(): Promise<void> {
    if (this.current()) {
      this.status.set({ kind: 'success', message: 'Ya tienes un enlace sin usar: envíaselo a tu amigo.' });
      document.getElementById('invitaciones')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    await this.newInvite();
  }

  protected async newInvite(): Promise<void> {
    this.qrFor.set(null);
    await this.run(async () => {
      const invite = await this.people.createInvite();
      this.invites.update((list) => [invite, ...list]);
    }, 'Creamos un enlace de invitación. Envíaselo a tu amigo.');
  }

  protected async revoke(invite: FriendInvite): Promise<void> {
    await this.run(async () => {
      await this.people.revokeInvite(invite.id);
      this.invites.update((list) => list.filter((item) => item.id !== invite.id));
      if (this.qrFor() === invite.id) this.qrFor.set(null);
    }, 'Anulamos la invitación: el enlace ya no funciona.');
  }

  protected async revokeOlder(): Promise<void> {
    const older = this.older();
    await this.run(async () => {
      for (const invite of older) await this.people.revokeInvite(invite.id);
      const ids = new Set(older.map((invite) => invite.id));
      this.invites.update((list) => list.filter((item) => !ids.has(item.id)));
    }, older.length === 1 ? 'Anulamos el enlace anterior.' : 'Anulamos los enlaces anteriores.');
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

  /** El QR se dibuja en el navegador: el enlace es de un solo uso y no debe pasar por servicios externos. */
  protected async toggleQr(invite: FriendInvite): Promise<void> {
    if (this.qrFor() === invite.id) {
      this.qrFor.set(null);
      return;
    }
    this.qrFor.set(invite.id);
    this.qrImage.set(null);
    try {
      // `qrcode` es CommonJS: el bundle lo expone solo como `default` (los nombres sueltos llegan undefined).
      const mod = await import('qrcode');
      const qr = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const image = await qr.toDataURL(this.inviteUrl(invite), { width: 480, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0a0a0a', light: '#ffffff' } });
      if (this.qrFor() === invite.id) this.qrImage.set(image);
    } catch (error) {
      console.error('QR', error);
      this.qrFor.set(null);
      this.status.set({ kind: 'error', message: 'No pudimos generar el código QR. Usa el enlace.' });
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

  protected startNickname(friend: Friend): void {
    this.nicknameDraft = friend.nickname ?? '';
    this.editingNickname.set(friend.userId);
  }

  protected async saveNickname(friend: Friend): Promise<void> {
    await this.run(async () => {
      const updated = await this.people.setFriendNickname(friend.userId, this.nicknameDraft.trim());
      this.friends.update((list) => list.map((item) => (item.userId === friend.userId ? updated : item)));
      // Si no tenía contacto enlazado, el backend creó uno: recargar para que aparezca en el selector.
      if (!friend.contactId && updated.contactId) this.contacts.set(await this.people.contacts());
      this.editingNickname.set(null);
    });
  }

  protected phoneDigits(phone: string): string {
    return phone.replace(/[^\d+]/g, '');
  }

  /** wa.me pide el número sin + ni espacios. Si viene sin código de país, se asume Chile (+56). */
  protected whatsapp(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (!phone.trim().startsWith('+') && digits.length === 9) digits = `56${digits}`;
    return `https://wa.me/${digits}`;
  }

  protected async remove(friend: Friend): Promise<void> {
    await this.run(async () => {
      await this.people.removeFriend(friend.userId);
      this.friends.update((list) => list.filter((item) => item.userId !== friend.userId));
      this.confirmRemove.set(null);
    }, 'Ya no son amigos en Apaña.');
  }
}
