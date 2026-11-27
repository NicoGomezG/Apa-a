import { HttpClient } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment.generated';

export type ChatKind = 'friend' | 'group';

export interface ChatThreadSummary {
  kind: ChatKind;
  /** Id del amigo (cuenta) o del grupo. */
  id: string;
  title: string | null;
  readOnly: boolean;
  /** Grupo propio (true) o de un amigo (false). Siempre false en conversaciones de amigos. */
  owned: boolean;
  lastMessage: { body: string; at: string; mine: boolean } | null;
  unread: number;
}

export interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  /** Nombre de quien escribió (null si es tuyo o ya no está en la conversación). */
  authorName: string | null;
}

export interface ChatThreadPage {
  title: string | null;
  readOnly: boolean;
  hasMore: boolean;
  messages: ChatMessage[];
}

/** Segmento de URL de la app para cada tipo de conversación. */
export const CHAT_ROUTE_KIND: Record<ChatKind, string> = { friend: 'amigo', group: 'grupo' };
export const MAX_MESSAGE_LENGTH = 2000;

/** Cada cuánto se revisan los no leídos (fuera del chat). */
const UNREAD_INTERVAL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/chats`;

  private readonly unreadState = signal(0);
  /** Mensajes sin leer en todas las conversaciones. */
  readonly unread = this.unreadState.asReadonly();

  private base(kind: ChatKind, id: string) {
    return `${this.api}/${kind === 'friend' ? 'friends' : 'groups'}/${id}`;
  }

  async threads(): Promise<ChatThreadSummary[]> {
    const result = await firstValueFrom(this.http.get<{ threads: ChatThreadSummary[]; unread: number }>(this.api));
    this.unreadState.set(result.unread);
    return result.threads;
  }

  async refreshUnread(): Promise<void> {
    try {
      const { unread } = await firstValueFrom(this.http.get<{ unread: number }>(`${this.api}/unread`));
      this.unreadState.set(unread);
    } catch {
      // Sin conexión o sesión vencida: se vuelve a intentar en la próxima vuelta.
    }
  }

  messages(kind: ChatKind, id: string, query: { after?: string; before?: string } = {}) {
    const params: Record<string, string> = {};
    if (query.after) params['after'] = query.after;
    if (query.before) params['before'] = query.before;
    return firstValueFrom(this.http.get<ChatThreadPage>(this.base(kind, id), { params }));
  }

  send(kind: ChatKind, id: string, body: string) {
    return firstValueFrom(this.http.post<ChatMessage>(`${this.base(kind, id)}/messages`, { body }));
  }

  async markRead(kind: ChatKind, id: string): Promise<void> {
    await firstValueFrom(this.http.post<void>(`${this.base(kind, id)}/read`, {}));
    void this.refreshUnread();
  }

  /** Revisa los no leídos ahora y cada 30 s mientras la pestaña esté visible. Se detiene con `destroyRef`. */
  watchUnread(destroyRef: DestroyRef): void {
    void this.refreshUnread();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refreshUnread();
    }, UNREAD_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.refreshUnread();
    };
    document.addEventListener('visibilitychange', onVisible);
    destroyRef.onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  clear(): void {
    this.unreadState.set(0);
  }
}
