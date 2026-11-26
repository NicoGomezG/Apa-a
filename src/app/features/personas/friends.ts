import type { BirthdayPerson } from '../../core/calendar/birthdays';
import type { Contact, Friend } from './people.models';

/** Nombre visible de un amigo. */
export function friendName(friend: Pick<Friend, 'displayName'>): string {
  return friend.displayName?.trim() || 'Amigo sin nombre';
}

/**
 * Cumpleaños de contactos y amigos, sin duplicados: si un amigo está enlazado a un contacto,
 * manda el contacto (con tu apodo y el año, si lo anotaste) y el amigo solo completa la fecha
 * cuando el contacto no la tiene.
 */
export function birthdayPeople(contacts: Contact[], friends: Friend[]): BirthdayPerson[] {
  const byFriend = new Map(friends.map((friend) => [friend.userId, friend]));
  const linked = new Set<string>();
  const people: BirthdayPerson[] = contacts.map((contact) => {
    const friend = contact.friendUserId ? byFriend.get(contact.friendUserId) : undefined;
    if (!friend) return contact;
    linked.add(friend.userId);
    if (contact.birthDay && contact.birthMonth) return contact;
    return { ...contact, birthDay: friend.birthDay, birthMonth: friend.birthMonth, birthYear: null };
  });
  for (const friend of friends) {
    if (linked.has(friend.userId)) continue;
    people.push({
      id: `amigo-${friend.userId}`,
      name: friendName(friend),
      birthDay: friend.birthDay,
      birthMonth: friend.birthMonth,
      birthYear: null,
    });
  }
  return people;
}
