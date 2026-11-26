import { Component, computed, inject, input, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { formatDay, moneyToInput, parseMoneyInput, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import {
  SPLIT_MODE_LABELS,
  type Contact,
  type Expense,
  type Friend,
  type Participant,
  type ExpensePayload,
  type GroupDetail,
  type SplitMode,
} from './people.models';
import { PeopleService } from './people.service';
import { friendName } from './friends';
import { computeSplit, SplitError, type SplitResult } from './split.math';

export const DEFAULT_TIP_PERCENT = 10;
/** Igual que en el backend: un recordatorio por amigo cada 20 horas. */
const REMINDER_COOLDOWN_MS = 20 * 60 * 60 * 1000;

interface ItemDraft {
  description: string;
  quantity: number;
  unitPrice: string;
  participantIds: string[];
}

interface ExpenseDraft {
  description: string;
  date: string;
  payerId: string;
  mode: SplitMode;
  tip: boolean;
  amount: string;
  participantIds: string[];
  exact: Record<string, string>;
  items: ItemDraft[];
}

@Component({
  selector: 'app-personas-grupo',
  imports: [FormsModule, RouterLink, MoneyPipe],
  templateUrl: './grupo.html',
  styleUrl: './grupo.scss',
})
export class PersonasGrupo {
  private readonly people = inject(PeopleService);
  private readonly profile = inject(ProfileService);
  private readonly router = inject(Router);

  /** Viene de la ruta /personas/gastos/:id. */
  readonly id = input.required<string>();

  protected readonly modes: SplitMode[] = ['equal', 'items', 'exact'];
  protected readonly modeLabels = SPLIT_MODE_LABELS;
  protected readonly tipPercent = DEFAULT_TIP_PERCENT;
  protected readonly formatDay = formatDay;

  protected readonly detail = signal<GroupDetail | null>(null);
  protected readonly contacts = signal<Contact[]>([]);
  protected readonly friends = signal<Friend[]>([]);
  protected readonly loading = signal(true);
  protected readonly status = signal<{ kind: 'success' | 'error'; message: string } | null>(null);
  protected readonly busy = signal(false);
  protected readonly expenseFormOpen = signal(false);
  protected readonly editingExpenseId = signal<string | null>(null);
  protected readonly openExpenseId = signal<string | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected draft: ExpenseDraft = this.emptyDraft();
  protected newParticipant = '';
  protected contactChoice = '';
  protected friendChoice = '';
  protected linkParticipantId = '';
  protected linkFriendId = '';
  protected readonly friendName = friendName;

  private readonly today = todayIn(this.profile.timezone());

  protected readonly currency = computed(() => this.detail()?.group.currency ?? 'CLP');

  protected readonly names = computed(() => {
    const map = new Map<string, string>();
    for (const participant of this.detail()?.participants ?? []) {
      map.set(participant.id, participant.isMe ? `${participant.name} (tú)` : participant.name);
    }
    return map;
  });

  protected readonly balanceRows = computed(() => {
    const detail = this.detail();
    if (!detail) return [];
    return detail.participants.map((participant) => {
      const balance = detail.balances.find((item) => item.participantId === participant.id);
      return {
        participant,
        paid: balance?.paid ?? '0',
        owed: balance?.owed ?? '0',
        balance: BigInt(balance?.balance ?? '0'),
      };
    });
  });

  protected readonly shareUrl = computed(() => {
    const token = this.detail()?.group.shareToken;
    return token ? `${location.origin}/compartido/${token}` : null;
  });

  /** Amigos que todavía no están enlazados a nadie del grupo. */
  protected readonly availableFriends = computed(() => {
    const used = new Set((this.detail()?.participants ?? []).map((participant) => participant.linkedUserId));
    return this.friends().filter((friend) => !used.has(friend.userId));
  });

  /** Personas del grupo que se pueden enlazar con un amigo (todas menos tú). */
  protected readonly linkable = computed(() => (this.detail()?.participants ?? []).filter((participant) => !participant.isMe));

  protected readonly participantsById = computed(
    () => new Map((this.detail()?.participants ?? []).map((participant) => [participant.id, participant])),
  );

  protected readonly pendingSettlements = computed(() => (this.detail()?.settlements ?? []).filter((item) => !item.confirmed));
  protected readonly confirmedSettlements = computed(() => (this.detail()?.settlements ?? []).filter((item) => item.confirmed));

  protected readonly availableContacts = computed(() => {
    const used = new Set((this.detail()?.participants ?? []).map((participant) => participant.contactId));
    return this.contacts().filter((contact) => !used.has(contact.id));
  });

  constructor() {
    effect(() => {
      void this.load(this.id());
    });
    void this.people
      .contacts()
      .then((contacts) => this.contacts.set(contacts))
      .catch(() => undefined);
    void this.people
      .friends()
      .then((friends) => this.friends.set(friends))
      .catch(() => undefined);
  }

  private async load(id: string): Promise<void> {
    try {
      this.detail.set(await this.people.group(id));
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar el grupo.') });
    } finally {
      this.loading.set(false);
    }
  }

  private async reload(): Promise<void> {
    await this.load(this.id());
  }

  /** Ejecuta una acción, recarga el grupo y muestra el resultado. */
  private async run(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    this.busy.set(true);
    this.status.set(null);
    try {
      await action();
      await this.reload();
      if (success) this.status.set({ kind: 'success', message: success });
      return true;
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** 1, -1 o 0 (las plantillas no aceptan literales BigInt como 0n). */
  protected sign(value: bigint): number {
    return value > 0n ? 1 : value < 0n ? -1 : 0;
  }

  protected abs(value: bigint): bigint {
    return value < 0n ? -value : value;
  }

  protected name(id: string): string {
    return this.names().get(id) ?? '—';
  }

  protected namesOf(ids: string[]): string {
    return ids.map((id) => this.name(id)).join(', ');
  }

  // --- Personas del grupo ------------------------------------------------------

  protected async addParticipant(): Promise<void> {
    const friend = this.friends().find((item) => item.userId === this.friendChoice);
    const contact = this.contacts().find((item) => item.id === (friend ? friend.contactId : this.contactChoice));
    const name = friend ? friendName(friend) : contact ? contact.nickname || contact.name : this.newParticipant.trim();
    if (!name) return;
    // Un contacto enlazado a un amigo entra como amigo, salvo que ese amigo ya esté en el grupo.
    const friendId =
      friend?.userId ??
      (contact?.friendUserId && this.availableFriends().some((item) => item.userId === contact.friendUserId)
        ? contact.friendUserId
        : null);
    const ok = await this.run(() => this.people.addParticipant(this.id(), { name, contactId: contact?.id ?? null, friendId }));
    if (ok) {
      this.newParticipant = '';
      this.contactChoice = '';
      this.friendChoice = '';
    }
  }

  protected async linkFriend(): Promise<void> {
    if (!this.linkParticipantId) return;
    const friendId = this.linkFriendId || null;
    const ok = await this.run(
      () => this.people.linkParticipant(this.id(), this.linkParticipantId, friendId),
      friendId ? 'Listo: tu amigo ya ve el grupo y lo que debe.' : 'Quitamos el enlace: esa persona ya no ve el grupo.',
    );
    if (ok) {
      this.linkParticipantId = '';
      this.linkFriendId = '';
    }
  }

  protected isFriend(id: string): boolean {
    return !!this.participantsById().get(id)?.linkedUserId;
  }

  /** Se puede recordar si es amigo con cuenta y no se le recordó en las últimas 20 horas. */
  protected canRemind(participant: Participant | undefined): boolean {
    if (!participant?.linkedUserId) return false;
    return !participant.remindedAt || Date.now() - new Date(participant.remindedAt).getTime() >= REMINDER_COOLDOWN_MS;
  }

  protected async remind(participantId: string): Promise<void> {
    await this.run(
      () => this.people.remind(this.id(), participantId),
      `Le recordamos a ${this.name(participantId)}: lo verá al abrir Apaña.`,
    );
  }

  protected async confirmSettlement(id: string): Promise<void> {
    await this.run(() => this.people.confirmSettlement(this.id(), id), 'Confirmamos el pago: ya cuenta en los saldos.');
  }

  protected async rejectSettlement(id: string): Promise<void> {
    await this.run(() => this.people.deleteSettlement(this.id(), id), 'Rechazamos el aviso de pago.');
  }

  protected async removeParticipant(id: string): Promise<void> {
    await this.run(() => this.people.removeParticipant(this.id(), id));
  }

  // --- Gastos ------------------------------------------------------------------

  private emptyDraft(): ExpenseDraft {
    const participants = this.detail()?.participants ?? [];
    return {
      description: '',
      date: todayIn(this.profile.timezone()),
      payerId: participants.find((participant) => participant.isMe)?.id ?? participants[0]?.id ?? '',
      mode: 'equal',
      tip: false,
      amount: '',
      participantIds: participants.map((participant) => participant.id),
      exact: {},
      items: [],
    };
  }

  protected newItem(): ItemDraft {
    return { description: '', quantity: 1, unitPrice: '', participantIds: [] };
  }

  protected openNewExpense(): void {
    this.draft = this.emptyDraft();
    this.editingExpenseId.set(null);
    this.expenseFormOpen.set(true);
  }

  protected openEditExpense(expense: Expense): void {
    const currency = this.currency();
    this.draft = {
      description: expense.description,
      date: expense.date,
      payerId: expense.payerId,
      mode: expense.mode,
      tip: expense.tipPercent > 0,
      amount: expense.mode === 'equal' ? moneyToInput(expense.subtotal, currency) : '',
      participantIds: expense.shares.map((share) => share.participantId),
      exact: Object.fromEntries(expense.shares.map((share) => [share.participantId, moneyToInput(share.consumption, currency)])),
      items: expense.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: moneyToInput(item.unitPrice, currency),
        participantIds: [...item.participantIds],
      })),
    };
    this.editingExpenseId.set(expense.id);
    this.expenseFormOpen.set(true);
  }

  protected setMode(mode: SplitMode): void {
    this.draft.mode = mode;
    if (mode === 'items' && this.draft.items.length === 0) this.draft.items = [this.newItem()];
  }

  protected toggle(list: string[], id: string): void {
    const index = list.indexOf(id);
    if (index >= 0) list.splice(index, 1);
    else list.push(id);
  }

  protected setAll(item: ItemDraft): void {
    const all = (this.detail()?.participants ?? []).map((participant) => participant.id);
    item.participantIds = item.participantIds.length === all.length ? [] : all;
  }

  protected addItem(): void {
    this.draft.items.push(this.newItem());
  }

  protected removeItem(index: number): void {
    this.draft.items.splice(index, 1);
  }

  /** Arma el payload; si algo no cuadra, devuelve el mensaje de error. */
  private buildPayload(): ExpensePayload | string {
    const draft = this.draft;
    const currency = this.currency();
    if (!draft.description.trim()) return 'Describe el gasto (ej. "Restorán", "Bencina").';
    if (!draft.payerId) return 'Indica quién pagó.';
    const base = {
      description: draft.description.trim(),
      date: draft.date,
      payerId: draft.payerId,
      mode: draft.mode,
      tipPercent: draft.tip ? DEFAULT_TIP_PERCENT : 0,
    };
    if (draft.mode === 'equal') {
      const amount = parseMoneyInput(draft.amount, currency);
      if (amount === null || amount <= 0n) return 'Escribe el monto total (sin propina).';
      if (draft.participantIds.length === 0) return 'Elige entre quiénes se divide.';
      return { ...base, amount: String(amount), participantIds: [...draft.participantIds] };
    }
    if (draft.mode === 'exact') {
      const exact = [];
      for (const [participantId, text] of Object.entries(draft.exact)) {
        if (!text.trim()) continue;
        const amount = parseMoneyInput(text, currency);
        if (amount === null || amount < 0n) return `Revisa el monto de ${this.name(participantId)}.`;
        if (amount > 0n) exact.push({ participantId, amount: String(amount) });
      }
      if (exact.length === 0) return 'Escribe cuánto consumió cada persona.';
      return { ...base, exact };
    }
    const items = [];
    for (const [index, item] of draft.items.entries()) {
      const unitPrice = parseMoneyInput(item.unitPrice, currency);
      if (!item.description.trim() && !item.unitPrice.trim()) continue;
      if (!item.description.trim()) return `Al ítem ${index + 1} le falta la descripción.`;
      if (unitPrice === null || unitPrice <= 0n) return `Revisa el precio de "${item.description}".`;
      if (item.participantIds.length === 0) return `Elige quién consumió "${item.description}".`;
      items.push({
        description: item.description.trim(),
        quantity: Math.max(1, Math.min(99, Math.trunc(item.quantity || 1))),
        unitPrice: String(unitPrice),
        participantIds: [...item.participantIds],
      });
    }
    if (items.length === 0) return 'Agrega los ítems de la boleta.';
    return { ...base, items };
  }

  /** Vista previa con el mismo cálculo que hace el backend. */
  protected preview(): { result: SplitResult | null; error: string | null } {
    const payload = this.buildPayload();
    if (typeof payload === 'string') return { result: null, error: null };
    try {
      const result = computeSplit({
        mode: payload.mode,
        order: (this.detail()?.participants ?? []).map((participant) => participant.id),
        amount: payload.amount ? BigInt(payload.amount) : undefined,
        participantIds: payload.participantIds,
        exact: payload.exact?.map((entry) => ({ participantId: entry.participantId, amount: BigInt(entry.amount) })),
        items: payload.items?.map((item) => ({ amount: BigInt(item.unitPrice) * BigInt(item.quantity), participantIds: item.participantIds })),
        tipPercent: payload.tipPercent,
      });
      return { result, error: null };
    } catch (error) {
      return { result: null, error: error instanceof SplitError ? error.message : 'No pudimos calcular el reparto.' };
    }
  }

  protected itemTotal(item: ItemDraft): bigint | null {
    const price = parseMoneyInput(item.unitPrice, this.currency());
    return price === null ? null : price * BigInt(Math.max(1, Math.trunc(item.quantity || 1)));
  }

  protected async saveExpense(): Promise<void> {
    const payload = this.buildPayload();
    if (typeof payload === 'string') {
      this.status.set({ kind: 'error', message: payload });
      return;
    }
    const editing = this.editingExpenseId();
    const ok = await this.run(
      () => (editing ? this.people.updateExpense(this.id(), editing, payload) : this.people.createExpense(this.id(), payload)),
      'Guardamos el gasto.',
    );
    if (ok) this.expenseFormOpen.set(false);
  }

  protected async deleteExpense(expense: Expense): Promise<void> {
    await this.run(() => this.people.deleteExpense(this.id(), expense.id), 'Eliminamos el gasto.');
    this.confirmDelete.set(null);
  }

  // --- Pagos -------------------------------------------------------------------

  protected async settle(transfer: { fromId: string; toId: string; amount: string }): Promise<void> {
    await this.run(
      () => this.people.createSettlement(this.id(), { ...transfer, date: this.today }),
      `Registramos que ${this.name(transfer.fromId)} le pagó a ${this.name(transfer.toId)}.`,
    );
  }

  protected async deleteSettlement(id: string): Promise<void> {
    await this.run(() => this.people.deleteSettlement(this.id(), id));
  }

  // --- Enlace y grupo ----------------------------------------------------------

  protected async enableShare(): Promise<void> {
    await this.run(() => this.people.enableShare(this.id()), 'Listo: cualquiera con el enlace puede ver el grupo (sin editarlo).');
  }

  protected async disableShare(): Promise<void> {
    await this.run(() => this.people.disableShare(this.id()), 'Desactivamos el enlace: ya no funciona.');
  }

  protected async copyShare(): Promise<void> {
    const url = this.shareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.status.set({ kind: 'error', message: 'No pudimos copiar. Selecciona el enlace y cópialo a mano.' });
    }
  }

  protected async deleteGroup(): Promise<void> {
    this.busy.set(true);
    try {
      await this.people.deleteGroup(this.id());
      await this.router.navigate(['/personas/gastos']);
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
      this.busy.set(false);
    }
  }
}
