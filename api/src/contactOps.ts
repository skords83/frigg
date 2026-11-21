import { query, pool } from './db';
import { getClientForAddressbook } from './carddav';
import type { ContactRow } from './types';
import { encodeText, foldLine, patchDocument, projectDocument, type EditableFields } from './vcardDocument';
import { DavError } from './davSafety';

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
  const partial = birthday.trim().match(/^--(\d{2})-?(\d{2})$/);
  if (partial) return isInvalidBirthday(`2000-${partial[1]}-${partial[2]}`);
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

export type ContactFields = EditableFields;

export function buildVCard(fields: ContactFields & { uid: string }): string {
  const base = ['BEGIN:VCARD', 'VERSION:4.0', `UID:${encodeText(fields.uid)}`, 'FN:', 'N:;;;;', 'END:VCARD'].map(foldLine).join('\r\n') + '\r\n';
  return patchDocument(base, { ...fields, fn: fields.fn ?? `${fields.given_name ?? ''} ${fields.family_name ?? ''}`.trim() });
}

// Shared by POST /api/contacts and the bulk vCard/CSV importer: builds a vCard,
// pushes it to the CardDAV server for the target addressbook, and inserts the
// resulting row.
export async function createContact(addressbookId: string, fields: ContactFields, originalVCard?: string): Promise<ContactRow> {
  const uid = originalVCard ? projectDocument(originalVCard).uid : crypto.randomUUID();
  if ((await query('SELECT 1 FROM contacts WHERE uid = $1', [uid])).length) throw new DavError(409, 'uid_exists');
  const phones = withoutEmptyPhones(fields.phones);
  const rawVcard = originalVCard ?? buildVCard({ ...fields, uid, phones });
  const parsed = projectDocument(rawVcard);

  const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [addressbookId]);
  if (!book) throw new Error('address book not found');
  const client = await getClientForAddressbook(addressbookId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await client.createVCard({
    addressBook: { url: book.url },
    filename: `${encodeURIComponent(uid)}.vcf`,
    vCardString: rawVcard,
  });
  const etag = result.headers.get('etag') ?? '';

  await pool.query(
    `INSERT INTO contacts
       (uid, addressbook_id, href, etag, fn, given_name, family_name, org, title,
        birthday, note, photo_data_uri, phones, emails, addresses, raw_vcard)
     VALUES ($1,$2,$15,$3,$4,$5,$6,$7,$8,$9,$10,$16,$11::jsonb,$12::jsonb,$13::jsonb,$14)`,
    [
      uid, addressbookId, etag,
      parsed.fn, parsed.given_name, parsed.family_name, parsed.org, parsed.title,
      parsed.birthday, parsed.note,
      JSON.stringify(parsed.phones), JSON.stringify(parsed.emails), JSON.stringify(parsed.addresses),
      rawVcard,
      new URL(`${encodeURIComponent(uid)}.vcf`, book.url).href,
      parsed.photo_data_uri,
    ]
  );

  const [created] = await query<ContactRow>('SELECT * FROM contacts WHERE uid = $1', [uid]);
  return created;
}
