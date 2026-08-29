import { normalizeFrenchPhone } from "./phone.js";

export function isUnsubscribed(telephone: string, unsubscribed: Set<string>): boolean {
  const normalized = normalizeFrenchPhone(telephone) ?? telephone;
  return unsubscribed.has(normalized);
}

export function excludeUnsubscribed<T extends { telephone: string }>(
  contacts: T[],
  unsubscribed: Set<string>,
): { kept: T[]; excluded: T[] } {
  const kept: T[] = [];
  const excluded: T[] = [];
  for (const contact of contacts) {
    if (isUnsubscribed(contact.telephone, unsubscribed)) {
      excluded.push(contact);
    } else {
      kept.push(contact);
    }
  }
  return { kept, excluded };
}
