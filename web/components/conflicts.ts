import type { Contact } from '../types/contact';

export const editKeys = ['fn','given_name','family_name','org','title','birthday','note','phones','emails','addresses','photo_data_uri'] as const;
export type EditKey = typeof editKeys[number];
export type EditContact = Contact & { photo_data_uri?: string | null };
export type Choices = Partial<Record<EditKey, 'mine' | 'server'>>;
export const fieldNames: Record<EditKey, string> = { fn: 'Anzeigename', given_name: 'Vorname', family_name: 'Nachname', org: 'Organisation', title: 'Titel', birthday: 'Geburtstag', note: 'Notiz', phones: 'Telefonnummern', emails: 'E-Mail-Adressen', addresses: 'Anschriften', photo_data_uri: 'Foto' };
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function compareVersions(base: EditContact, mine: EditContact, server: EditContact) {
  return editKeys.map(key => ({ key, mineChanged: !equal(base[key], mine[key]), serverChanged: !equal(base[key], server[key]), differs: !equal(mine[key], server[key]) }));
}
export function resolveVersions(base: EditContact, mine: EditContact, server: EditContact, choices: Choices): EditContact | null {
  const result = { ...server };
  for (const row of compareVersions(base, mine, server)) {
    if (row.mineChanged && row.serverChanged && row.differs && !choices[row.key]) return null;
    if (row.mineChanged && (!row.serverChanged || choices[row.key] === 'mine')) Object.assign(result, { [row.key]: mine[row.key] });
  }
  return result;
}
export function changedFields(base: EditContact, next: EditContact) {
  return Object.fromEntries(editKeys.filter(key => !equal(base[key], next[key])).map(key => [key, next[key]]));
}
export function displayValue(key: EditKey, value: unknown): string {
  if (key === 'photo_data_uri') return value ? 'Foto vorhanden' : 'Kein Foto';
  if (Array.isArray(value)) return value.map(v => Object.entries(v).filter(([k]) => k !== 'property_id').map(([, val]) => val).filter(Boolean).join(' · ')).join('\n') || '–';
  return value ? String(value) : '–';
}
