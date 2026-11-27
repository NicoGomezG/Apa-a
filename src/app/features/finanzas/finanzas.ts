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
          <i class="fa-solid {{ tab.icon }}" aria-hidden="true"></i><span>{{ tab.label }}</span>
        </a>
      }
    </nav>
    <router-outlet />
  `,
  styles: `
    /* Todas las secciones a la vista, sin deslizar: grilla de 4 en celular, barra que salta de línea en escritorio. */
    .finance-tabs {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.25rem;
      padding: 0.25rem;
      border-radius: 18px;
      background: var(--bs-secondary-bg);
    }
    .finance-tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      min-width: 0;
      padding: 0.5rem 0.25rem;
      border-radius: 14px;
      color: var(--bs-body-color);
      font-weight: 500;
      font-size: 0.7rem;
      line-height: 1.15;
      text-align: center;
      text-decoration: none;
    }
    .finance-tab span {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .finance-tab i {
      font-size: 1rem;
      color: var(--apana-section-color);
    }
    .finance-tab:hover {
      background: var(--bs-body-bg);
    }
    .finance-tab.active {
      background: var(--bs-primary);
      color: #fff;
      font-weight: 600;
    }
    .finance-tab.active i {
      color: #fff;
    }
    @media (min-width: 768px) {
      .finance-tabs {
        display: flex;
        flex-wrap: wrap;
        width: fit-content;
        max-width: 100%;
      }
      .finance-tab {
        flex-direction: row;
        gap: 0.45rem;
        padding: 0.45rem 0.9rem;
        font-size: 0.9rem;
      }
      .finance-tab i {
        font-size: 0.9rem;
      }
    }
  `,
})
export class Finanzas {
  protected readonly tabs = TABS;
}
