import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ChatService } from './chat.service';

/** Selector superior de la sección Amigos: la lista de amigos y sus mensajes. */
@Component({
  selector: 'app-amigos-tabs',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="segmented mb-3" aria-label="Amigos y mensajes">
      <a routerLink="/personas/amigos" routerLinkActive="active" ariaCurrentWhenActive="page">
        <i class="fa-solid fa-address-book" aria-hidden="true"></i>Amigos
      </a>
      <a routerLink="/personas/mensajes" routerLinkActive="active" ariaCurrentWhenActive="page">
        <i class="fa-solid fa-comments" aria-hidden="true"></i>Mensajes
        @if (chat.unread() > 0) {
          <span class="count">{{ chat.unread() }}<span class="visually-hidden"> sin leer</span></span>
        }
      </a>
    </nav>
  `,
  styles: `
    .segmented {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.25rem;
      padding: 0.25rem;
      border-radius: 18px;
      background: var(--bs-secondary-bg);
      max-width: 26rem;
    }
    .segmented a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      padding: 0.45rem 0.75rem;
      border-radius: 14px;
      color: var(--bs-body-color);
      font-weight: 500;
      text-decoration: none;
    }
    .segmented a.active {
      background: var(--bs-body-bg);
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
      font-weight: 600;
    }
    .count {
      display: inline-grid;
      place-items: center;
      min-width: 1.25rem;
      height: 1.25rem;
      padding: 0 0.35rem;
      border-radius: 18px;
      background: var(--bs-danger);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 600;
    }
  `,
})
export class AmigosTabs {
  protected readonly chat = inject(ChatService);
}
