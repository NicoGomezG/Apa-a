import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { daysUntilLabel, MONTH_NAMES, nextBirthday } from '../../core/calendar/birthdays';
import { formatDay, todayIn } from '../../core/format/format';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { AmigosTabs } from './amigos-tabs';
import { friendName } from './friends';
import type { Contact, Friend, FriendInvite } from './people.models';
import { PeopleService } from './people.service';

type Status = { kind: 'success' | 'error'; message: string } | null;

const nicknameMessage = (draft: string) => (draft.trim() ? 'Guardamos el apodo.' : 'Quitamos el apodo.');

interface FriendRow {
  friend: Friend;
  contact: Contact | null;
  birthday: ReturnType<typeof nextBirthday>;
}

/** Sin tildes ni mayúsculas, pero conservando la ñ. */
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/ñ/g, '\u0001')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ');

/** Amigos con cuenta en Apaña: invitación por enlace, cumpleaños y enlace con tus contactos. */
@Component({
  selector: 'app-personas-amigos',
  imports: [FormsModule, RouterLink, EmptyState, AmigosTabs],
  template: `
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2">
      <app-amigos-tabs class="flex-grow-1" />
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
      <div class="search mb-3">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <label class="visually-hidden" for="buscar-amigo">Buscar amigo</label>
        <input id="buscar-amigo" type="search" class="form-control" placeholder="Buscar por nombre o apodo"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>

      @if (groups().length === 0) {
        <p class="text-center my-4">Ningún amigo coincide con «{{ query() }}».</p>
      } @else {
        <section class="apana-card p-0 overflow-hidden" aria-label="Tus amigos">
          @for (group of groups(); track group.letter) {
            <h2 class="letter" [id]="'letra-' + group.letter">{{ group.letter }}</h2>
            <ul class="list-unstyled mb-0" [attr.aria-labelledby]="'letra-' + group.letter">
              @for (row of group.rows; track row.friend.userId) {
                <li class="friend" [class.open]="openId() === row.friend.userId">
                  <div class="friend-row">
                    <button type="button" class="friend-main" (click)="toggle(row.friend.userId)"
                            [attr.aria-expanded]="openId() === row.friend.userId" [attr.aria-controls]="'amigo-' + row.friend.userId">
                      <span class="avatar" aria-hidden="true">{{ initial(row.friend) }}</span>
                      <span class="min-w-0 text-start">
                        <span class="d-block fw-semibold text-truncate">{{ name(row.friend) }}</span>
                        <span class="d-block small text-truncate">{{ subtitle(row) }}</span>
                      </span>
                    </button>
                    <a class="icon-btn" [routerLink]="['/personas/mensajes/amigo', row.friend.userId]"
                       [attr.aria-label]="'Escribirle a ' + name(row.friend)">
                      <i class="fa-solid fa-comment" aria-hidden="true"></i>
                    </a>
                  </div>

                  @if (openId() === row.friend.userId) {
                    <div class="friend-detail d-grid gap-3" [id]="'amigo-' + row.friend.userId">
                      <div class="d-flex flex-wrap gap-2">
                        <a class="btn btn-sm btn-primary" [routerLink]="['/personas/mensajes/amigo', row.friend.userId]">
                          <i class="fa-solid fa-comment me-1" aria-hidden="true"></i>Mensaje
                        </a>
                        @if (row.friend.phone; as phone) {
                          <a class="btn btn-sm btn-outline-primary" [href]="'tel:' + phoneDigits(phone)">
                            <i class="fa-solid fa-phone me-1" aria-hidden="true"></i>Llamar
                          </a>
                          <a class="btn btn-sm btn-outline-primary" [href]="whatsapp(phone)" target="_blank" rel="noopener">
                            <i class="fa-brands fa-whatsapp me-1" aria-hidden="true"></i>WhatsApp
                          </a>
                        }
                      </div>

                      <dl class="facts mb-0">
                        @if (row.friend.nickname && row.friend.displayName) {
                          <dt>Nombre</dt>
                          <dd>{{ row.friend.displayName }}</dd>
                        }
                        <dt>Cumpleaños</dt>
                        <dd>
                          @if (row.birthday; as birthday) {
                            <i class="fa-solid fa-cake-candles accent me-1" aria-hidden="true"></i>{{ birthdayText(row.friend) }} ·
                            {{ daysUntil(birthday.daysUntil) }}
                          } @else {
                            Aún no lo indica
                          }
                        </dd>
                        <dt>Teléfono</dt>
                        <dd>{{ row.friend.phone ?? 'No lo comparte' }}</dd>
                        <dt>Amigos desde</dt>
                        <dd>{{ formatDay(row.friend.since.slice(0, 10)) }}</dd>
                      </dl>

                      <form class="d-grid gap-1" (ngSubmit)="saveNickname(row.friend)">
                        <label class="form-label small mb-0" [for]="'nick-' + row.friend.userId">Apodo (solo lo ves tú)</label>
                        <div class="d-flex gap-2">
                          <input class="form-control form-control-sm" [id]="'nick-' + row.friend.userId" name="nickname" maxlength="40"
                                 placeholder="Cómo le dices" [(ngModel)]="nicknameDraft" />
                          <button type="submit" class="btn btn-sm btn-outline-primary" [disabled]="busy() || nicknameDraft.trim() === (row.friend.nickname ?? '')">
                            Guardar
                          </button>
                        </div>
                      </form>

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

                      <div class="d-flex flex-wrap align-items-center gap-2">
                        @if (confirmRemove() === row.friend.userId) {
                          <span class="small me-2">¿Dejar de ser amigos? Ya no verá tus grupos.</span>
                          <button type="button" class="btn btn-sm btn-danger" (click)="remove(row.friend)" [disabled]="busy()">Sí, eliminar</button>
                          <button type="button" class="btn btn-sm btn-outline-primary" (click)="confirmRemove.set(null)">No</button>
                        } @else {
                          <button type="button" class="btn btn-sm btn-link text-danger p-0" (click)="confirmRemove.set(row.friend.userId)">
                            Eliminar amigo
                          </button>
                        }
                      </div>
                    </div>
                  }
                </li>
              }
            </ul>
          }
        </section>
      }
      <p class="small mt-3 mb-0">
        {{ friends().length === 1 ? '1 amigo' : friends().length + ' amigos' }}. Para compartir gastos, agrégalos a un grupo desde
        <a routerLink="/personas/gastos">Gastos compartidos</a>.
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
    .accent {
      color: var(--apana-section-color);
    }
    .search {
      position: relative;
    }
    .search i {
      position: absolute;
      left: 0.9rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--apana-mid);
      pointer-events: none;
    }
    .search input {
      padding-left: 2.4rem;
    }
    .letter {
      margin: 0;
      padding: 0.35rem 1rem;
      background: var(--bs-tertiary-bg);
      border-bottom: 1px solid var(--bs-border-color);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: var(--apana-ink-soft);
    }
    .friend + .friend {
      border-top: 1px solid var(--bs-border-color);
    }
    ul + .letter {
      border-top: 1px solid var(--bs-border-color);
    }
    .friend-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding-right: 0.75rem;
    }
    .friend-main {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex: 1;
      min-width: 0;
      padding: 0.7rem 0 0.7rem 1rem;
      border: 0;
      background: none;
      color: inherit;
    }
    .friend-row:hover,
    .friend.open .friend-row {
      background: var(--bs-tertiary-bg);
    }
    .icon-btn {
      display: inline-grid;
      place-items: center;
      flex: none;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 50%;
      color: var(--bs-body-color);
      border: 1px solid var(--bs-border-color);
      background: var(--bs-body-bg);
    }
    .friend-detail {
      padding: 0.25rem 1rem 1rem calc(1rem + 2.25rem + 0.75rem);
      background: var(--bs-tertiary-bg);
    }
    @media (max-width: 575.98px) {
      .friend-detail {
        padding-left: 1rem;
      }
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.25rem 1rem;
      font-size: 0.875rem;
    }
    .facts dt {
      font-weight: 500;
      color: var(--apana-ink-soft);
    }
    .facts dd {
      margin: 0;
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
  protected nicknameDraft = '';

  private readonly today = todayIn(this.profile.timezone());

  /** Se muestra un solo enlace: el más nuevo. Los anteriores siguen vigentes hasta usarse o anularse. */
  private readonly sortedInvites = computed(() => [...this.invites()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  protected readonly current = computed(() => this.sortedInvites()[0] ?? null);
  protected readonly older = computed(() => this.sortedInvites().slice(1));

  protected readonly rows = computed((): FriendRow[] => {
    const contacts = new Map(this.contacts().map((contact) => [contact.id, contact]));
    return this.friends()
      .map((friend) => ({
        friend,
        contact: friend.contactId ? (contacts.get(friend.contactId) ?? null) : null,
        birthday: nextBirthday({ id: friend.userId, name: friendName(friend), ...friend, birthYear: null }, this.today),
      }))
      .sort((a, b) => friendName(a.friend).localeCompare(friendName(b.friend), 'es'));
  });

  protected readonly query = signal('');
  protected readonly openId = signal<string | null>(null);

  /** Lista estilo agenda del teléfono: filtrada por nombre/apodo y agrupada por inicial. */
  protected readonly groups = computed(() => {
    const query = normalize(this.query().trim());
    const groups: { letter: string; rows: FriendRow[] }[] = [];
    for (const row of this.rows()) {
      const haystack = normalize(`${row.friend.nickname ?? ''} ${row.friend.displayName ?? ''} ${row.contact?.name ?? ''}`);
      if (query && !haystack.includes(query)) continue;
      const first = normalize(friendName(row.friend)).charAt(0).toUpperCase();
      const letter = /[A-ZÑ]/.test(first) ? first : '#';
      const last = groups.at(-1);
      if (last?.letter === letter) last.rows.push(row);
      else groups.push({ letter, rows: [row] });
    }
    return groups;
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

  protected toggle(friendId: string): void {
    const opening = this.openId() !== friendId;
    this.openId.set(opening ? friendId : null);
    this.confirmRemove.set(null);
    if (opening) this.nicknameDraft = this.friends().find((item) => item.userId === friendId)?.nickname ?? '';
  }

  /** Segunda línea de la fila: su nombre real si tiene apodo, si no el próximo cumpleaños. */
  protected subtitle(row: FriendRow): string {
    if (row.friend.nickname && row.friend.displayName) return row.friend.displayName;
    if (row.birthday) return 'Cumpleaños: ' + this.birthdayText(row.friend);
    return row.friend.phone ?? 'En Apaña';
  }

  protected async saveNickname(friend: Friend): Promise<void> {
    await this.run(async () => {
      const updated = await this.people.setFriendNickname(friend.userId, this.nicknameDraft.trim());
      this.friends.update((list) => list.map((item) => (item.userId === friend.userId ? updated : item)));
      // Si no tenía contacto enlazado, el backend creó uno: recargar para que aparezca en el selector.
      if (!friend.contactId && updated.contactId) this.contacts.set(await this.people.contacts());
    }, nicknameMessage(this.nicknameDraft));
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
