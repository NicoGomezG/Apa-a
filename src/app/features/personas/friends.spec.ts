import { describe, expect, it } from 'vitest';
import { birthdayPeople, friendName } from './friends';
import type { Contact, Friend } from './people.models';

const contact = (data: Partial<Contact>): Contact => ({
  id: 'c1',
  name: 'Camila',
  nickname: null,
  birthDay: null,
  birthMonth: null,
  birthYear: null,
  phone: null,
  email: null,
  relationship: null,
  notes: null,
  friendUserId: null,
  ...data,
});

const friend = (data: Partial<Friend>): Friend => ({
  userId: 'u1',
  displayName: 'Cami R.',
  birthDay: 3,
  birthMonth: 12,
  phone: null,
  nickname: null,
  since: '2026-11-25T12:00:00Z',
  contactId: null,
  ...data,
});

describe('friendName', () => {
  it('usa tu apodo si le pusiste uno, si no su nombre', () => {
    expect(friendName(friend({ nickname: 'Cuca' }))).toBe('Cuca');
    expect(friendName(friend({ nickname: '  ' }))).toBe('Cami R.');
    expect(friendName(friend({ displayName: null }))).toBe('Amigo sin nombre');
  });
});

describe('birthdayPeople', () => {
  it('suma amigos sin contacto enlazado', () => {
    const people = birthdayPeople([contact({ id: 'c2', name: 'Otro' })], [friend({})]);
    expect(people.map((person) => person.name)).toEqual(['Otro', 'Cami R.']);
    expect(people[1]).toMatchObject({ birthDay: 3, birthMonth: 12, birthYear: null });
  });

  it('no duplica: el contacto enlazado manda y el amigo completa la fecha si falta', () => {
    const withDate = birthdayPeople([contact({ friendUserId: 'u1', birthDay: 4, birthMonth: 12, birthYear: 1994 })], [friend({})]);
    expect(withDate).toHaveLength(1);
    expect(withDate[0]).toMatchObject({ name: 'Camila', birthDay: 4, birthYear: 1994 });

    const withoutDate = birthdayPeople([contact({ friendUserId: 'u1' })], [friend({})]);
    expect(withoutDate).toHaveLength(1);
    expect(withoutDate[0]).toMatchObject({ name: 'Camila', birthDay: 3, birthMonth: 12 });
  });
});
