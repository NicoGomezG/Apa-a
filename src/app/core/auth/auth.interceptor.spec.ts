import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  const signOut = vi.fn(async () => undefined);
  const navigateByUrl = vi.fn(async () => true);

  beforeEach(() => {
    signOut.mockClear();
    navigateByUrl.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { accessToken: async () => 'token-123', signOut } },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  // El token se resuelve de forma asíncrona antes de enviar la request.
  const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve));

  it('adjunta el token a las llamadas a nuestra API', async () => {
    const response = firstValueFrom(http.get('/api/me'));
    await flushMicrotasks();
    const req = controller.expectOne('/api/me');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-123');
    req.flush({});
    await response;
  });

  it('nunca envía el token a otros dominios ni a rutas parecidas', async () => {
    for (const url of ['https://otro.cl/api/me', '/apix/me']) {
      const response = firstValueFrom(http.get(url));
      await flushMicrotasks();
      const req = controller.expectOne(url);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
      await response;
    }
  });

  it('cierra la sesión si la API responde 401', async () => {
    const response = firstValueFrom(http.get('/api/me'));
    await flushMicrotasks();
    controller.expectOne('/api/me').flush({ code: 'UNAUTHORIZED' }, { status: 401, statusText: 'Unauthorized' });
    await expect(response).rejects.toBeTruthy();
    await flushMicrotasks();
    expect(signOut).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/auth/ingresar');
  });
});
