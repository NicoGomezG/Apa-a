import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PageHeader } from '../../shared/ui/page-header';
import { ChatService } from './chat.service';

const TABS = [
  { path: 'contactos', label: 'Contactos', icon: 'fa-address-book' },
  { path: 'gastos', label: 'Gastos compartidos', icon: 'fa-receipt' },
  { path: 'amigos', label: 'Amigos', icon: 'fa-handshake' },
  { path: 'mensajes', label: 'Mensajes', icon: 'fa-comments' },
];

@Component({
  selector: 'app-personas',
  imports: [PageHeader, RouterOutlet, RouterLink, RouterLinkActive],
  host: { style: '--apana-section-color: var(--apana-module-personas)' },
  template: `
    <app-page-header
      title="Personas"
      icon="fa-user-group"
      module="personas"
      subtitle="Tus contactos, tus amigos en Apaña, sus cumpleaños y los gastos que compartes."
    />
    <nav class="section-tabs mb-4" aria-label="Secciones de Personas">
      @for (tab of tabs; track tab.path) {
        <a
          class="section-tab"
          [routerLink]="tab.path"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >
          <i class="fa-solid {{ tab.icon }}" aria-hidden="true"></i>{{ tab.label }}
          @if (tab.path === 'mensajes' && chat.unread() > 0) {
            <span class="tab-badge">{{ chat.unread() }}<span class="visually-hidden"> sin leer</span></span>
          }
        </a>
      }
    </nav>
    <router-outlet />
  `,
  styles: `
    .section-tabs {
      display: flex;
      gap: 0.5rem;
      overflow-x: auto;
      padding-bottom: 0.25rem;
      scrollbar-width: thin;
    }
    .section-tab {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      white-space: nowrap;
      padding: 0.45rem 0.9rem;
      border-radius: 999px;
      border: 1px solid var(--bs-border-color);
      background: var(--bs-body-bg);
      color: var(--bs-body-color);
      font-weight: 500;
      font-size: 0.9rem;
      text-decoration: none;
    }
    .section-tab i {
      color: var(--apana-section-color);
    }
    .section-tab.active {
      background: var(--bs-primary);
      border-color: var(--bs-primary);
      color: #fff;
    }
    .section-tab.active i {
      color: #fff;
    }
    .tab-badge {
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
export class Personas {
  protected readonly tabs = TABS;
  protected readonly chat = inject(ChatService);
}
