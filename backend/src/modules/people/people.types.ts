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
  createdAt: Date;
}

export type ContactInput = Omit<ContactRecord, 'id' | 'createdAt'>;

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
  position: number;
}

export type ParticipantInput = Pick<ParticipantRecord, 'name' | 'contactId' | 'isMe'>;

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
  createdAt: Date;
}

export type SettlementInput = Pick<SettlementRecord, 'fromId' | 'toId' | 'amount' | 'date'>;

export interface GroupDetail {
  group: GroupRecord;
  participants: ParticipantRecord[];
  expenses: ExpenseRecord[];
  settlements: SettlementRecord[];
}
