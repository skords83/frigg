import { query, pool } from './db';
import { getClientForAddressbook, labelToVCardType } from './carddav';
import type { ContactRow } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hasInvalidEmail(emails: unknown): boolean {
  if (!Array.isArray(emails)) return false;
  return (emails as { value: string }[]).some((e) => e.value?.trim() && !EMAIL_RE.test(e.value.trim()));
}

const PHONE_RE = /^[0-9+\s()-]+$/;

export function hasInvalidPhone(phones: unknown): boolean {
  if (!Array.isArray(phones)) return false;
  return (phones as { value: string }[]).some((p) => p.value?.trim() && !PHONE_RE.test(p.value.trim()));
}

const BIRTHDAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isInvalidBirthday(birthday: unknown): boolean {
  if (typeof birthday !== 'string' || !birthday.trim()) return false;
  const m = birthday.trim().match(BIRTHDAY_RE);
  if (!m) return true;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(year, month - 1, day);
  // Date rolls over invalid days (e.g. Feb 31) into the next month, so a mismatch means the date doesn't exist.
  return date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day;
}

// Entries with a selected type but an empty value must never be persisted.
export function withoutEmptyPhones(phones: unknown): { label: string; value: string }[] {
  if (!Array.isArray(phones)) return [];
  return (phones as { label: string; value: string }[]).filter((p) => p?.value?.trim());
}

export interface ContactFields {
  fn?: string;
  given_name?: string;
  family_name?: string;
  org?: string | null;
  title?: string | null;
  birthday?: string | null;
  note?: string | null;
  phones?: Array<{ label: string; value: string }>;
  emails?: Array<{ label: string; value: string }>;
  addresses?: Array<{ label: string; street: string; city: string; zip: string; state?: string; country?: string }>;
}

export function buildVCard(fields: ContactFields & { uid: string }): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:4.0', `UID:${fields.uid}`];

  const fn = fields.fn ?? `${fields.given_name ?? ''} ${fields.family_name ?? ''}`.trim();
  lines.push(`FN:${fn}`);
  lines.push(`N:${fields.family_name ?? ''};${fields.given_name ?? ''};;;`);

  if (fields.org) lines.push(`ORG:${fields.org}`);
  if (fields.title) lines.push(`TITLE:${fields.title}`);
  if (fields.birthday) lines.push(`BDAY:${fields.birthday}`);
  if (fields.note) lines.push(`NOTE:${fields.note.replace(/\n/g, '\\n')}`);

  for (const p of fields.phones ?? []) {
    const type = labelToVCardType(p.label);
    lines.push(`TEL;TYPE=${type}:${p.value}`);
  }
  for (const e of fields.emails ?? []) {
    const type = labelToVCardType(e.label);
    lines.push(`EMAIL;TYPE=${type}:${e.value}`);
  }
  for (const a of fields.addresses ?? []) {
    const type = labelToVCardType(a.label);
    lines.push(`ADR;TYPE=${type}:;;${a.street};${a.city};${a.state ?? ''};${a.zip};${a.country ?? ''}`);
  }

  lines.push('END:VCARD');
  return lines.join('\r\n');
}

// Shared by POST /api/contacts and the bulk vCard/CSV importer: builds a vCard,
// pushes it to the CardDAV server for the target addressbook, and inserts the
// resulting row.
export async function createContact(addressbookId: string, fields: ContactFields): Promise<ContactRow> {
  const uid = crypto.randomUUID();
  const phones = withoutEmptyPhones(fields.phones);
  const rawVcard = buildVCard({ ...fields, uid, phones });

  const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [addressbookId]);
  if (!book) throw new Error('address book not found');
  const client = await getClientForAddressbook(addressbookId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await client.createVCard({
    addressBook: { url: book.url },
    filename: `${uid}.vcf`,
    vCardString: rawVcard,
  });
  const etag = (result?.etag as string | undefined) ?? '';

  await pool.query(
    `INSERT INTO contacts
       (uid, addressbook_id, etag, fn, given_name, family_name, org, title,
        birthday, note, photo_data_uri, phones, emails, addresses, raw_vcard)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11::jsonb,$12::jsonb,$13::jsonb,$14)`,
    [
      uid, addressbookId, etag,
      fields.fn ?? `${fields.given_name ?? ''} ${fields.family_name ?? ''}`.trim(),
      fields.given_name ?? '', fields.family_name ?? '', fields.org ?? null, fields.title ?? null,
      fields.birthday ?? null, fields.note ?? null,
      JSON.stringify(phones ?? []),
      JSON.stringify(fields.emails ?? []),
      JSON.stringify(fields.addresses ?? []),
      rawVcard,
    ]
  );

  const [created] = await query<ContactRow>('SELECT * FROM contacts WHERE uid = $1', [uid]);
  return created;
}
