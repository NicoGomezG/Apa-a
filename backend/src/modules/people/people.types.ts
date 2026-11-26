// Tipos del módulo Personas: contactos (con cumpleaños) y reparto de gastos.
// Montos en BigInt (unidad mínima). Días como 'YYYY-MM-DD'.

import type { SplitMode } from './split.math.js';

export const RELATIONSHIPS = ['familia', 'amistad', 'pareja', 'trabajo', 'otro'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export interface ContactRecord {
  id: string;
  name: string;
  nickname: string | null;
  birthDay: number | null;
  birthMonth: number | null;
  birthYear: number | null;
  phone: string | null;
  email: string | null;
  relationship: Relationship | null;
  notes: string | null;
  /** Amigo de Apaña enlazado a este contacto (se cambia desde Amigos, no desde el contacto). */
  friendUserId: string | null;
  createdAt: Date;
}

export type ContactInput = Omit<ContactRecord, 'id' | 'createdAt' | 'friendUserId'>;

export interface GroupRecord {
  id: string;
  name: string;
  date: string | null;
  currency: string;
  shareToken: string | null;
  createdAt: Date;
}

export type GroupInput = Pick<GroupRecord, 'name' | 'date' | 'currency'>;

export interface ParticipantRecord {
  id: string;
  groupId: string;
  name: string;
  contactId: string | null;
  isMe: boolean;
  /** Amigo con cuenta que ve el grupo e informa pagos. */
  linkedUserId: string | null;
  remindedAt: Date | null;
  position: number;
}

export type ParticipantInput = Pick<ParticipantRecord, 'name' | 'contactId' | 'isMe' | 'linkedUserId'>;
export type ParticipantChanges = Partial<Pick<ParticipantRecord, 'name' | 'contactId' | 'linkedUserId' | 'remindedAt'>>;

export interface ItemRecord {
  description: string;
  quantity: number;
  unitPrice: bigint;
  amount: bigint;
  participantIds: string[];
}

export interface ShareRecord {
  participantId: string;
  consumption: bigint;
  tip: bigint;
}

export interface ExpenseRecord {
  id: string;
  groupId: string;
  description: string;
  date: string;
  payerId: string;
  mode: SplitMode;
  subtotal: bigint;
  tipPercent: number;
  tip: bigint;
  total: bigint;
  items: ItemRecord[];
  shares: ShareRecord[];
  createdAt: Date;
}

export type ExpenseInput = Omit<ExpenseRecord, 'id' | 'groupId' | 'createdAt'>;

export interface SettlementRecord {
  id: string;
  groupId: string;
  fromId: string;
  toId: string;
  amount: bigint;
  date: string;
  /** false = lo informó un amigo y el dueño aún no lo confirma (no cuenta en los saldos). */
  confirmed: boolean;
  /** Amigo que lo informó; null si lo registró el dueño. */
  reportedBy: string | null;
  createdAt: Date;
}

export type SettlementInput = Pick<SettlementRecord, 'fromId' | 'toId' | 'amount' | 'date' | 'confirmed' | 'reportedBy'>;

export interface GroupDetail {
  group: GroupRecord;
  participants: ParticipantRecord[];
  expenses: ExpenseRecord[];
  settlements: SettlementRecord[];
}

/** Grupo de otra persona en el que participas como amigo. */
export interface SharedGroup {
  ownerId: string;
  detail: GroupDetail;
}
