import { Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DEFAULT_LOCALE } from '../../core/format/format';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { type ChatKind, type ChatMessage, ChatService, MAX_MESSAGE_LENGTH } from './chat.service';

/** Cada cuánto se buscan mensajes nuevos con la conversación abierta. */
const POLL_MS = 4_000;

interface Row {
  message: ChatMessage;
  /** Etiqueta de día cuando cambia respecto del mensaje anterior. */
  day: string | null;
  /** Mostrar el nombre: primer mensaje seguido de esa persona. */
  showAuthor: boolean;
}

/** Conversación (amigo o grupo): mensajes, envío y revisión periódica de lo nuevo. */
@Component({
  selector: 'app-chat-thread',
  imports: [FormsModule],
  template: `
    <div class="chat">
      <div class="chat-scroll" #scroller (scroll)="onScroll()">
        @if (loading()) {
          <p class="chat-hint" role="status">Cargando mensajes…</p>
        } @else {
          @if (hasMore()) {
            <div class="text-center mb-2">
              <button type="button" class="btn btn-sm btn-outline-primary" (click)="loadOlder()" [disabled]="loadingOlder()">
                {{ loadingOlder() ? 'Cargando…' : 'Ver mensajes anteriores' }}
              </button>
            </div>
          }
          @if (rows().length === 0) {
            <p class="chat-hint">{{ emptyText() }}</p>
          }
          <ol class="chat-list" role="log" aria-live="polite" [attr.aria-label]="'Mensajes con ' + (title() || 'la conversación')">
            @for (row of rows(); track row.message.id) {
              @if (row.day) {
                <li class="chat-day" aria-hidden="true"><span>{{ row.day }}</span></li>
              }
              <li class="chat-row" [class.mine]="row.message.mine">
                <div class="bubble">
                  @if (row.showAuthor) {
                    <div class="author">{{ row.message.authorName || 'Ex participante' }}</div>
                  }
                  <span class="visually-hidden">{{ row.message.mine ? 'Tú' : row.message.authorName || 'Otra persona' }}:</span>
                  <p class="body">{{ row.message.body }}</p>
                  <time class="time" [attr.datetime]="row.message.createdAt">{{ time(row.message.createdAt) }}</time>
                </div>
              </li>
            }
          </ol>
        }
      </div>

      @if (error(); as message) {
        <div class="alert alert-danger py-2 mb-0 mt-2" role="alert">{{ message }}</div>
      }

      @if (readOnly()) {
        <p class="chat-readonly" role="note">
          <i class="fa-solid fa-lock me-1" aria-hidden="true"></i>Ya no son amigos: puedes leer la conversación, pero no escribir.
        </p>
      } @else if (!loading()) {
        <form class="chat-compose" (ngSubmit)="send()">
          <label class="visually-hidden" [for]="inputId()">Escribe un mensaje</label>
          <textarea
            #composer
            class="form-control"
            [id]="inputId()"
            name="body"
            rows="1"
            [maxlength]="maxLength"
            placeholder="Escribe un mensaje"
            [(ngModel)]="draft"
            (keydown.enter)="onEnter($event)"
            (input)="autosize()"
          ></textarea>
          <button type="submit" class="btn btn-primary send" [disabled]="sending() || !draft.trim()" aria-label="Enviar">
            <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
          </button>
        </form>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .chat {
      display: flex;
      flex-direction: column;
      height: var(--chat-height, min(70dvh, 40rem));
    }
    .chat-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 0.25rem 0.25rem 0.75rem;
      overscroll-behavior: contain;
    }
    .chat-hint {
      text-align: center;
      margin: 2rem 0;
    }
    .chat-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.25rem;
    }
    .chat-day {
      text-align: center;
      margin: 0.75rem 0 0.25rem;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .chat-day span {
      padding: 0.15rem 0.6rem;
      border-radius: 18px;
      background: var(--bs-light);
    }
    .chat-row {
      display: flex;
    }
    .chat-row.mine {
      justify-content: flex-end;
    }
    .bubble {
      max-width: min(80%, 32rem);
      padding: 0.45rem 0.75rem;
      border-radius: 18px;
      background: var(--bs-light);
      color: var(--bs-body-color);
    }
    .mine .bubble {
      background: var(--bs-primary);
      color: #fff;
    }
    .author {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--apana-section-color);
    }
    .body {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .time {
      display: block;
      text-align: right;
      font-size: 0.7rem;
      opacity: 0.8;
    }
    .chat-compose {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--bs-border-color);
    }
    .chat-compose textarea {
      resize: none;
      max-height: 8rem;
    }
    .send {
      flex: none;
      width: 2.5rem;
      height: 2.5rem;
      padding: 0;
    }
    .chat-readonly {
      margin: 0;
      padding-top: 0.75rem;
      border-top: 1px solid var(--bs-border-color);
      text-align: center;
    }
  `,
})
export class ChatThread {
  private readonly chat = inject(ChatService);
  private readonly profile = inject(ProfileService);
  private readonly destroyRef = inject(DestroyRef);

  readonly kind = input.required<ChatKind>();
  readonly threadId = input.required<string>();
  /** Nombre a mostrar mientras carga o si la API no lo trae. */
  readonly fallbackTitle = input<string | null>(null);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  protected readonly maxLength = MAX_MESSAGE_LENGTH;
  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly title = signal<string | null>(null);
  protected readonly readOnly = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loading = signal(true);
  protected readonly loadingOlder = signal(false);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected draft = '';

  protected readonly inputId = computed(() => `chat-${this.kind()}-${this.threadId()}`);
  protected readonly emptyText = computed(() =>
    this.readOnly() ? 'No hay mensajes.' : 'Aún no hay mensajes. Escribe el primero.',
  );

  private nearBottom = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Evita respuestas cruzadas si cambia la conversación mientras carga. */
  private generation = 0;

  private readonly timeFormat = computed(
    () => new Intl.DateTimeFormat(DEFAULT_LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: this.profile.timezone() }),
  );
  private readonly dayFormat = computed(
    () => new Intl.DateTimeFormat(DEFAULT_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: this.profile.timezone() }),
  );

  protected readonly rows = computed<Row[]>(() => {
    const format = this.dayFormat();
    let previousDay = '';
    let previousAuthor: string | null | undefined;
    return this.messages().map((message) => {
      const day = format.format(new Date(message.createdAt));
      const showDay = day !== previousDay;
      const author = message.mine ? null : message.authorName;
      const showAuthor = this.kind() === 'group' && !message.mine && (showDay || author !== previousAuthor);
      previousDay = day;
      previousAuthor = message.mine ? undefined : author;
      return { message, day: showDay ? day.charAt(0).toUpperCase() + day.slice(1) : null, showAuthor };
    });
  });

  constructor() {
    effect(() => {
      const kind = this.kind();
      const id = this.threadId();
      untracked(() => void this.open(kind, id));
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => {
      this.stopPolling();
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  protected time(iso: string): string {
    return this.timeFormat().format(new Date(iso));
  }

  private async open(kind: ChatKind, id: string): Promise<void> {
    const generation = ++this.generation;
    this.stopPolling();
    this.loading.set(true);
    this.error.set(null);
    this.messages.set([]);
    this.title.set(this.fallbackTitle());
    try {
      const page = await this.chat.messages(kind, id);
      if (generation !== this.generation) return;
      this.title.set(page.title ?? this.fallbackTitle());
      this.readOnly.set(page.readOnly);
      this.hasMore.set(page.hasMore);
      this.messages.set(page.messages);
      this.nearBottom = true;
      this.scrollToBottom();
      void this.chat.markRead(kind, id).catch(() => undefined);
      this.timer = setInterval(() => {
        if (document.visibilityState === 'visible') void this.poll();
      }, POLL_MS);
    } catch (error) {
      if (generation === this.generation) this.error.set(apiErrorMessage(error, 'No pudimos cargar la conversación.'));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Agrega mensajes sin repetir (la API entrega desde `after` inclusive). */
  private merge(incoming: ChatMessage[]): ChatMessage[] {
    const known = new Set(this.messages().map((message) => message.id));
    const fresh = incoming.filter((message) => !known.has(message.id));
    if (fresh.length > 0) {
      this.messages.update((list) => [...list, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    }
    return fresh;
  }

  private async poll(): Promise<void> {
    if (this.loading() || !this.timer) return;
    const generation = this.generation;
    const kind = this.kind();
    const id = this.threadId();
    const last = this.messages().at(-1)?.createdAt;
    try {
      const page = await this.chat.messages(kind, id, last ? { after: last } : {});
      if (generation !== this.generation) return;
      this.readOnly.set(page.readOnly);
      const fresh = this.merge(page.messages);
      if (fresh.length > 0) {
        if (this.nearBottom) this.scrollToBottom();
        if (fresh.some((message) => !message.mine)) void this.chat.markRead(kind, id).catch(() => undefined);
      }
      this.error.set(null);
    } catch (error) {
      // Si se pierde el acceso (amistad terminada, te sacaron del grupo), se avisa y se deja de revisar.
      if (generation === this.generation && (error as { status?: number }).status === 404) {
        this.stopPolling();
        this.error.set('Ya no tienes acceso a esta conversación.');
      }
    }
  }

  protected async loadOlder(): Promise<void> {
    const first = this.messages()[0];
    if (!first) return;
    const generation = this.generation;
    const scroller = this.scroller()?.nativeElement;
    const previousHeight = scroller?.scrollHeight ?? 0;
    this.loadingOlder.set(true);
    try {
      const page = await this.chat.messages(this.kind(), this.threadId(), { before: first.createdAt });
      if (generation !== this.generation) return;
      const known = new Set(this.messages().map((message) => message.id));
      this.messages.update((list) => [...page.messages.filter((message) => !known.has(message.id)), ...list]);
      this.hasMore.set(page.hasMore);
      // Mantener la vista donde estaba.
      setTimeout(() => {
        if (scroller) scroller.scrollTop += scroller.scrollHeight - previousHeight;
      });
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'No pudimos cargar los mensajes anteriores.'));
    } finally {
      this.loadingOlder.set(false);
    }
  }

  protected onEnter(event: Event): void {
    const keyboard = event as KeyboardEvent;
    // Enter envía; Shift+Enter hace un salto de línea. En pantallas táctiles, Enter es salto de línea.
    if (keyboard.shiftKey || keyboard.isComposing || matchMedia('(pointer: coarse)').matches) return;
    keyboard.preventDefault();
    void this.send();
  }

  protected autosize(): void {
    const textarea = this.composer()?.nativeElement;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }

  protected async send(): Promise<void> {
    const body = this.draft.trim();
    if (!body || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      const message = await this.chat.send(this.kind(), this.threadId(), body);
      this.merge([message]);
      this.draft = '';
      setTimeout(() => this.autosize());
      this.nearBottom = true;
      this.scrollToBottom();
    } catch (error) {
      if ((error as { status?: number }).status === 403) this.readOnly.set(true);
      this.error.set(apiErrorMessage(error, 'No pudimos enviar el mensaje.'));
    } finally {
      this.sending.set(false);
      this.composer()?.nativeElement.focus();
    }
  }

  protected onScroll(): void {
    const scroller = this.scroller()?.nativeElement;
    if (scroller) this.nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const scroller = this.scroller()?.nativeElement;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }
}
