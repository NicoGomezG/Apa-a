import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DEFAULT_LOCALE } from '../../core/format/format';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { AmigosTabs } from './amigos-tabs';
import { ChatThread } from './chat-thread';
import { CHAT_ROUTE_KIND, type ChatKind, ChatService, type ChatThreadSummary } from './chat.service';

/** Cada cuánto se refresca la lista mientras está abierta. */
const LIST_POLL_MS = 15_000;

const threadTitle = (thread: Pick<ChatThreadSummary, 'kind' | 'title' | 'readOnly'>) =>
  thread.title ?? (thread.readOnly ? 'Conversación anterior' : thread.kind === 'friend' ? 'Amigo sin nombre' : 'Grupo');

/** Lista de conversaciones con amigos y grupos de gastos. */
@Component({
  selector: 'app-personas-mensajes',
  imports: [RouterLink, EmptyState, AmigosTabs],
  template: `
    <app-amigos-tabs />
    @if (error(); as message) {
      <div class="alert alert-danger py-2" role="alert">{{ message }}</div>
    }
    @if (loading()) {
      <p role="status">Cargando…</p>
    } @else if (threads().length === 0) {
      <section class="apana-card">
        <app-empty-state
          icon="fa-comments"
          title="Aún no tienes conversaciones"
          description="Cuando tengas amigos en Apaña o grupos de gastos con amigos, podrás escribirles desde acá."
        />
        <div class="text-center mt-3">
          <a class="btn btn-primary" routerLink="/personas/amigos">Invitar a un amigo</a>
        </div>
      </section>
    } @else {
      <ul class="apana-card list-unstyled p-0 mb-0 threads">
        @for (thread of threads(); track thread.kind + thread.id) {
          <li>
            <a class="thread" [routerLink]="[routeKind[thread.kind], thread.id]">
              <span class="thread-icon" aria-hidden="true">
                @if (thread.kind === 'group') {
                  <i class="fa-solid fa-receipt"></i>
                } @else {
                  {{ initial(thread) }}
                }
              </span>
              <span class="thread-main">
                <span class="d-flex justify-content-between gap-2">
                  <span class="thread-title text-truncate" [class.fw-semibold]="thread.unread > 0">{{ title(thread) }}</span>
                  @if (thread.lastMessage) {
                    <time class="small flex-none" [attr.datetime]="thread.lastMessage.at">{{ when(thread.lastMessage.at) }}</time>
                  }
                </span>
                <span class="d-flex justify-content-between gap-2 align-items-center">
                  <span class="small text-truncate">
                    @if (thread.lastMessage) {
                      {{ thread.lastMessage.mine ? 'Tú: ' : '' }}{{ thread.lastMessage.body }}
                    } @else {
                      {{ thread.kind === 'group' ? 'Chat del grupo' : 'Sin mensajes' }}
                    }
                  </span>
                  @if (thread.unread > 0) {
                    <span class="badge rounded-pill text-bg-primary">
                      {{ thread.unread }}<span class="visually-hidden"> sin leer</span>
                    </span>
                  }
                </span>
              </span>
            </a>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .threads li + li {
      border-top: 1px solid var(--bs-border-color);
    }
    .thread {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.85rem 1.25rem;
      color: inherit;
      text-decoration: none;
    }
    .thread:hover {
      background: var(--bs-light);
    }
    .threads li:first-child .thread {
      border-radius: 24px 24px 0 0;
    }
    .threads li:last-child .thread {
      border-radius: 0 0 24px 24px;
    }
    .threads li:only-child .thread {
      border-radius: 24px;
    }
    .thread-icon {
      display: inline-grid;
      place-items: center;
      flex: none;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 50%;
      background: var(--apana-section-color);
      color: #fff;
      font-weight: 600;
    }
    .thread-main {
      display: grid;
      min-width: 0;
      flex: 1;
    }
    .flex-none {
      flex: none;
    }
  `,
})
export class PersonasMensajes {
  private readonly chat = inject(ChatService);
  private readonly profile = inject(ProfileService);

  protected readonly routeKind = CHAT_ROUTE_KIND;
  protected readonly threads = signal<ChatThreadSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly title = threadTitle;

  private readonly timeFormat = computed(
    () => new Intl.DateTimeFormat(DEFAULT_LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: this.profile.timezone() }),
  );
  private readonly dateFormat = computed(
    () => new Intl.DateTimeFormat(DEFAULT_LOCALE, { day: 'numeric', month: 'short', timeZone: this.profile.timezone() }),
  );

  constructor() {
    void this.load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.load(true);
    }, LIST_POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async load(quiet = false): Promise<void> {
    try {
      this.threads.set(await this.chat.threads());
      this.error.set(null);
    } catch (error) {
      if (!quiet) this.error.set(apiErrorMessage(error, 'No pudimos cargar tus conversaciones.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected initial(thread: ChatThreadSummary): string {
    return threadTitle(thread).charAt(0).toUpperCase();
  }

  protected when(iso: string): string {
    const date = new Date(iso);
    const sameDay = this.dateFormat().format(date) === this.dateFormat().format(new Date());
    return sameDay ? this.timeFormat().format(date) : this.dateFormat().format(date);
  }
}

/** Una conversación abierta: /personas/mensajes/amigo/:id o /personas/mensajes/grupo/:id. */
@Component({
  selector: 'app-personas-conversacion',
  imports: [RouterLink, ChatThread],
  template: `
    <a class="apana-back" routerLink="/personas/mensajes">
      <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>Mensajes
    </a>
    @if (chatKind(); as k) {
      <section class="apana-card">
        <header class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
          <h2 class="h5 mb-0">
            <i class="fa-solid {{ k === 'group' ? 'fa-receipt' : 'fa-comment' }} me-2 section-icon" aria-hidden="true"></i>{{ heading() }}
          </h2>
          @if (k === 'group') {
            <a class="btn btn-sm btn-outline-primary" [routerLink]="groupLink()">Ver el grupo</a>
          }
        </header>
        <app-chat-thread [kind]="k" [threadId]="id()" />
      </section>
    } @else {
      <p>No encontramos esa conversación.</p>
    }
  `,
  styles: `
    .section-icon {
      color: var(--apana-section-color);
    }
    /* El chat ocupa el alto disponible: pantalla menos barra superior, barra inferior (celular),
       enlace de volver y encabezado. Nunca menos de 20rem ni más de 40rem. */
    app-chat-thread {
      --chat-height: clamp(20rem, calc(100dvh - 19rem - env(safe-area-inset-bottom)), 40rem);
    }
    @media (min-width: 992px) {
      app-chat-thread {
        --chat-height: clamp(20rem, calc(100dvh - 15rem), 40rem);
      }
    }
  `,
})
export class PersonasConversacion {
  private readonly chat = inject(ChatService);

  /** Parámetros de la ruta (withComponentInputBinding). */
  readonly kind = input.required<string>();
  readonly id = input.required<string>();

  protected readonly chatKind = computed<ChatKind | null>(() =>
    this.kind() === CHAT_ROUTE_KIND.friend ? 'friend' : this.kind() === CHAT_ROUTE_KIND.group ? 'group' : null,
  );
  private readonly summary = signal<ChatThreadSummary | null>(null);
  protected readonly heading = computed(() => {
    const summary = this.summary();
    return summary ? threadTitle(summary) : this.chatKind() === 'group' ? 'Chat del grupo' : 'Conversación';
  });
  /** El dueño entra a su grupo; el amigo, a la vista compartida. */
  protected readonly groupLink = computed(() => [
    this.summary()?.owned === false ? '/personas/compartidos' : '/personas/gastos',
    this.id(),
  ]);

  constructor() {
    void this.loadSummary();
  }

  private async loadSummary(): Promise<void> {
    try {
      const threads = await this.chat.threads();
      this.summary.set(threads.find((thread) => thread.kind === this.chatKind() && thread.id === this.id()) ?? null);
    } catch {
      // El título es opcional: la conversación carga igual.
    }
  }
}
