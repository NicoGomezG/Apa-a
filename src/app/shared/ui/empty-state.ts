import { Component, input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  host: { class: 'd-block text-center py-3' },
  template: `
    <i class="fa-regular {{ icon() }} empty-icon mb-2" aria-hidden="true"></i>
    <p class="fw-semibold mb-1">{{ title() }}</p>
    @if (description()) {
      <p class="text-secondary small mb-0">{{ description() }}</p>
    }
    <ng-content />
  `,
  styles: `
    .empty-icon {
      font-size: 1.6rem;
      color: var(--apana-section-color, var(--bs-primary));
    }
  `,
})
export class EmptyState {
  readonly icon = input('fa-folder-open');
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
}
