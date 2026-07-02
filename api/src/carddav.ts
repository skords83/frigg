import { createDAVClient } from 'tsdav';
import VCF from 'vcf';
import type { PhoneEntry, EmailEntry, AddressEntry } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DAVClientInstance = any;

let _client: DAVClientInstance = null;

export async function getClient(): Promise<DAVClientInstance> {
  if (_client) return _client;
  _client = await createDAVClient({
    serverUrl: process.env.CARDDAV_URL!,
    credentials: {
      username: process.env.CARDDAV_USERNAME!,
      password: process.env.CARDDAV_PASSWORD!,
    },
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
  });
  return _client;
}

export interface ParsedCard {
  uid: string;
  fn: string;
  given_name: string;
  family_name: string;
  org: string | null;
  title: string | null;
  birthday: string | null;
  note: string | null;
  photo_data_uri: string | null;
  phones: PhoneEntry[];
  emails: EmailEntry[];
  addresses: AddressEntry[];
  raw_vcard: string;
}

function getPropParams(prop: VCF.Property): Record<string, string | string[]> {
  // vcf Property.toJSON() → [field, params, type, value]
  return prop.toJSON()[1] as Record<string, string | string[]>;
}

function getTypeParam(prop: VCF.Property): string {
  const params = getPropParams(prop);
  const raw = params['TYPE'] ?? params['type'] ?? '';
  return Array.isArray(raw) ? raw.join(',') : String(raw);
}

export function parseVCard(raw: string): ParsedCard | null {
  try {
    const cards = VCF.parse(raw);
    if (!cards.length) return null;
    const c = cards[0];

    function getStr(key: string): string | null {
      const p = c.get(key);
      if (!p) return null;
      return (Array.isArray(p) ? p[0] : p).valueOf() ?? null;
    }

    const uid = getStr('uid') ?? crypto.randomUUID();
    const fn = getStr('fn') ?? '';

    // N: family;given;additional;prefix;suffix
    const nVal = getStr('n') ?? '';
    const nParts = nVal.split(';');
    const family_name = nParts[0]?.trim() ?? '';
    const given_name = nParts[1]?.trim() ?? '';

    const org = getStr('org')?.split(';')[0] ?? null;
    const title = getStr('title') ?? null;
    const note = getStr('note') ?? null;

    // Normalize birthday to YYYY-MM-DD: Apple Contacts uses YYYYMMDD (no dashes)
    let birthday = getStr('bday') ?? null;
    if (birthday && /^\d{8}$/.test(birthday)) {
      birthday = `${birthday.slice(0, 4)}-${birthday.slice(4, 6)}-${birthday.slice(6, 8)}`;
    }

    // Photo — data URI format (PHOTO:data:image/...) or traditional ENCODING=B
    let photo_data_uri: string | null = null;
    const photoProp = c.get('photo');
    if (photoProp) {
      const photoArr = Array.isArray(photoProp) ? photoProp : [photoProp];
      for (const p of photoArr) {
        const val = String(p.valueOf());
        if (val.startsWith('data:image/')) {
          photo_data_uri = val;
          break;
        }
        const params = getPropParams(p);
        const encoding = String(params['ENCODING'] ?? params['encoding'] ?? '').toLowerCase();
        if (encoding === 'b' || encoding === 'base64') {
          const type = String(params['TYPE'] ?? params['type'] ?? 'jpeg').toLowerCase();
          photo_data_uri = `data:image/${type};base64,${val}`;
          break;
        }
      }
    }

    // Phones
    const phones: PhoneEntry[] = [];
    const telProps = c.get('tel');
    if (telProps) {
      const arr = Array.isArray(telProps) ? telProps : [telProps];
      for (const p of arr) {
        phones.push({ label: normalizeTypeLabel(getTypeParam(p)), value: p.valueOf() });
      }
    }

    // Emails
    const emails: EmailEntry[] = [];
    const emailProps = c.get('email');
    if (emailProps) {
      const arr = Array.isArray(emailProps) ? emailProps : [emailProps];
      for (const p of arr) {
        emails.push({ label: normalizeTypeLabel(getTypeParam(p)), value: p.valueOf() });
      }
    }

    // Addresses
    const addresses: AddressEntry[] = [];
    const adrProps = c.get('adr');
    if (adrProps) {
      const arr = Array.isArray(adrProps) ? adrProps : [adrProps];
      for (const p of arr) {
        // ADR: PO Box;extended;street;city;state;zip;country
        // Split on unescaped semicolons only (vCard uses \; for literal semicolons)
        const adrValue = p.valueOf() as string;
        const parts = adrValue.split(/(?<!\\);/).map((s) => unescapeAdrComponent(s.trim()));
        const street = parts[2] ?? '';
        const city = parts[3] ?? '';
        // Skip entries where both street and city are empty (invalid/placeholder ADR)
        if (!street && !city) continue;
        addresses.push({
          label: normalizeTypeLabel(getTypeParam(p)),
          street,
          city,
          state: parts[4] || undefined,
          zip: parts[5] ?? '',
          country: parts[6] || undefined,
        });
      }
    }

    return {
      uid, fn, given_name, family_name, org, title, birthday, note,
      photo_data_uri, phones, emails, addresses, raw_vcard: raw,
    };
  } catch (err) {
    console.error('vCard parse error', err);
    return null;
  }
}

function unescapeAdrComponent(s: string): string {
  return s
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function normalizeTypeLabel(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes('cell') || lower.includes('mobile')) return 'mobil';
  if (lower.includes('work')) return 'arbeit';
  if (lower.includes('home')) return 'privat';
  if (lower.includes('fax')) return 'fax';
  return lower.replace(/,/g, '/') || 'sonstige';
}

export function patchPhotoInVCard(raw: string, photoDataUri: string): string {
  let result = raw.replace(
    /^PHOTO[;:][^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/gim,
    ''
  );
  result = result.replace(
    /END:VCARD/i,
    `PHOTO:${photoDataUri}\r\nEND:VCARD`
  );
  return result.replace(/(\r?\n){3,}/g, '\r\n');
}

export function patchVCard(raw: string, fields: Record<string, string>): string {
  let result = raw;
  for (const [key, value] of Object.entries(fields)) {
    const propName = key.toUpperCase();
    // Remove existing lines for this property (handles multi-line folding)
    result = result.replace(
      new RegExp(`^${propName}[;:][^\r\n]*(?:\r?\n[ \t][^\r\n]*)*`, 'gim'),
      ''
    );
    if (value) {
      result = result.replace(
        /END:VCARD/i,
        `${propName}:${value}\r\nEND:VCARD`
      );
    }
  }
  result = result.replace(/(\r?\n){3,}/g, '\r\n');
  return result;
}

// Escape a simple (non-structured) vCard property value.
export function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

// Escape a single component of a structured property (N, ADR).
// Does NOT escape ';' because ';' is the structural separator between components.
export function escapeVCardComponent(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
