import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment.generated';
import type { HealthVisit, HealthVisitPayload } from './salud.models';
import type { HealthTracker, HealthTrackerPayload } from './trackers.models';

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

  // Recambios y medicamentos.
  trackers() {
    return firstValueFrom(this.http.get<HealthTracker[]>(`${this.api}/trackers`));
  }
  createTracker(payload: HealthTrackerPayload) {
    return firstValueFrom(this.http.post<HealthTracker>(`${this.api}/trackers`, payload));
  }
  updateTracker(id: string, payload: Partial<Omit<HealthTracker, 'id' | 'kind' | 'createdAt' | 'events'>>) {
    return firstValueFrom(this.http.patch<HealthTracker>(`${this.api}/trackers/${id}`, payload));
  }
  deleteTracker(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.api}/trackers/${id}`));
  }
  /** "Los cambié" ese día. */
  markChanged(id: string, day: string) {
    return firstValueFrom(this.http.post<HealthTracker>(`${this.api}/trackers/${id}/changes`, { day }));
  }
  markDose(id: string, dose: number, status: 'taken' | 'skipped') {
    return firstValueFrom(this.http.put<HealthTracker>(`${this.api}/trackers/${id}/doses/${dose}`, { status }));
  }
  /** Deshace un "Los cambié" o una toma marcada. */
  undoEvent(id: string, eventId: string) {
    return firstValueFrom(this.http.delete<HealthTracker>(`${this.api}/trackers/${id}/events/${eventId}`));
  }
}
