// Tipos del módulo Personas tal como llegan de la API (BigInt → string).

export const RELATIONSHIPS = ['familia', 'amistad', 'pareja', 'trabajo', 'otro'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  familia: 'Familia',
  amistad: 'Amistad',
  pareja: 'Pareja',
  trabajo: 'Trabajo',
  otro: 'Otro',
};

export interface Contact {
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
}

export type ContactPayload = Omit<Contact, 'id'>;

export type SplitMode = 'equal' | 'exact' | 'items';

export const SPLIT_MODE_LABELS: Record<SplitMode, string> = {
  equal: 'Partes iguales',
  exact: 'Montos por persona',
  items: 'Boleta por ítems',
};

export interface Participant {
  id: string;
  groupId: string;
  name: string;
  contactId: string | null;
  isMe: boolean;
  position: number;
}

export interface ExpenseItem {
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
  participantIds: string[];
}

export interface Share {
  participantId: string;
  consumption: string;
  tip: string;
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  date: string;
  payerId: string;
  mode: SplitMode;
  subtotal: string;
  tipPercent: number;
  tip: string;
  total: string;
  items: ExpenseItem[];
  shares: Share[];
}

export interface Settlement {
  id: string;
  fromId: string;
  toId: string;
  amount: string;
  date: string;
}

export interface Balance {
  participantId: string;
  paid: string;
  owed: string;
  balance: string;
}

export interface Transfer {
  fromId: string;
  toId: string;
  amount: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  date: string | null;
  currency: string;
  shareToken: string | null;
}

export interface GroupDetail {
  group: GroupInfo;
  participants: Participant[];
  expenses: Expense[];
  settlements: Settlement[];
  totalSpent: string;
  balances: Balance[];
  transfers: Transfer[];
}

export interface GroupSummary {
  id: string;
  name: string;
  date: string | null;
  currency: string;
  shared: boolean;
  participants: { id: string; name: string; isMe: boolean }[];
  expenseCount: number;
  totalSpent: string;
  myBalance: string | null;
  settled: boolean;
}

export interface PublicGroup {
  group: { name: string; date: string | null; currency: string };
  participants: { id: string; name: string }[];
  expenses: Omit<Expense, 'groupId'>[];
  settlements: Settlement[];
  totalSpent: string;
  balances: Balance[];
  transfers: Transfer[];
}

export interface ExpensePayload {
  description: string;
  date: string;
  payerId: string;
  mode: SplitMode;
  tipPercent: number;
  amount?: string;
  participantIds?: string[];
  exact?: { participantId: string; amount: string }[];
  items?: { description: string; quantity: number; unitPrice: string; participantIds: string[] }[];
}
