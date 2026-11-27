import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PageHeader } from '../../shared/ui/page-header';

const TABS = [
  { path: 'resumen', label: 'Resumen', icon: 'fa-chart-pie' },
  { path: 'movimientos', label: 'Movimientos', icon: 'fa-list' },
  { path: 'cuentas', label: 'Cuentas', icon: 'fa-building-columns' },
  { path: 'suscripciones', label: 'Suscripciones', icon: 'fa-repeat' },
  { path: 'cuentas-fijas', label: 'Cuentas fijas', icon: 'fa-file-invoice-dollar' },
  { path: 'deudas', label: 'Deudas', icon: 'fa-hand-holding-dollar' },
  { path: 'importar', label: 'Importar', icon: 'fa-file-import' },
];

@Component({
  selector: 'app-finanzas',
  imports: [PageHeader, RouterOutlet, RouterLink, RouterLinkActive],
  host: { style: '--apana-section-color: var(--apana-module-finanzas)' },
  template: `
    <app-page-header
      title="Finanzas"
      icon="fa-wallet"
      module="finanzas"
      subtitle="Tus gastos, cuentas, compras en cuotas, suscripciones y cuentas fijas."
    />
    <nav class="finance-tabs mb-4" aria-label="Secciones de Finanzas">
      @for (tab of tabs; track tab.path) {
        <a
          class="finance-tab"
          [routerLink]="tab.path"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >
          <i class="fa-solid {{ tab.icon }}" aria-hidden="true"></i>{{ tab.label }}
        </a>
      }
    </nav>
    <router-outlet />
  `,
  styles: `
    .finance-tabs {
      display: flex;
      gap: 0.5rem;
      overflow-x: auto;
      padding-bottom: 0.25rem;
      scrollbar-width: thin;
    }
    .finance-tab {
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
    .finance-tab i {
      color: var(--apana-section-color);
    }
    .finance-tab.active {
      background: var(--bs-primary);
      border-color: var(--bs-primary);
      color: #fff;
    }
    .finance-tab.active i {
      color: #fff;
    }
  `,
})
export class Finanzas {
  protected readonly tabs = TABS;
}
