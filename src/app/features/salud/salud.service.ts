import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment.generated';
import type { HealthVisit, HealthVisitPayload } from './salud.models';

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/health`;

  visits() {
    return firstValueFrom(this.http.get<HealthVisit[]>(`${this.api}/visits`));
  }
  createVisit(payload: HealthVisitPayload) {
    return firstValueFrom(this.http.post<HealthVisit>(`${this.api}/visits`, payload));
  }
  updateVisit(id: string, payload: Partial<Omit<HealthVisitPayload, 'completesVisitId'>> & { nextDone?: boolean }) {
    return firstValueFrom(this.http.patch<HealthVisit>(`${this.api}/visits/${id}`, payload));
  }
  deleteVisit(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.api}/visits/${id}`));
  }
}
