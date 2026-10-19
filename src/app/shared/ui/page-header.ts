import { Component, input } from '@angular/core';

@Component({
  selector: 'app-page-header',
  host: { class: 'd-flex flex-wrap align-items-center gap-3 mb-4' },
  template: `
    <span class="page-header-icon" [style.--apana-section-color]="'var(--apana-module-' + module() + ')'">
      <i class="fa-solid {{ icon() }}" aria-hidden="true"></i>
    </span>
    <div class="flex-grow-1 min-w-0">
      <h1 class="h3 mb-0">{{ title() }}</h1>
      @if (subtitle()) {
        <p class="text-secondary mb-0">{{ subtitle() }}</p>
      }
    </div>
    <ng-content />
  `,
  styles: `
    .page-header-icon {
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 0.75rem;
      color: #fff;
      background: var(--apana-section-color);
      font-size: 1.15rem;
      flex-shrink: 0;
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly icon = input.required<string>();
  readonly module = input.required<string>();
  readonly subtitle = input<string | null>(null);
}
