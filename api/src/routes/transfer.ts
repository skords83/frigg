import { Router, Response } from 'express';
import { query } from '../db';
import { parseVCard, splitVCards } from '../carddav';
import { getVisibleAddressbookIds, canAccessAddressbook } from '../auth/access';
import { hasInvalidEmail, hasInvalidPhone, isInvalidBirthday, createContact } from '../contactOps';
import type { AuthedRequest } from '../auth/middleware';
import type { ContactRow } from '../types';

const router = Router();

const CSV_HEADERS = [
  'fn', 'given_name', 'family_name', 'org', 'title', 'birthday', 'note',
  'emails', 'phones', 'street', 'city', 'state', 'zip', 'country',
] as const;

function csvField(v: string): string {
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function toCsvRow(values: string[]): string {
  return values.map(csvField).join(',') + '\r\n';
}

function labelValuesToCsv(entries: { label: string; value: string }[]): string {
  return entries.map((e) => `${e.label}:${e.value}`).join('; ');
}

async function resolveScopeContacts(userId: string, scope: string): Promise<ContactRow[] | null> {
  const visibleIds = await getVisibleAddressbookIds(userId);

  const selectCols = `uid, addressbook_id, fn, given_name, family_name, org, title, birthday, note,
                       phones, emails, addresses, raw_vcard`;

  if (scope === 'all') {
    return query<ContactRow>(
      `SELECT ${selectCols} FROM contacts WHERE addressbook_id = ANY($1::text[]) ORDER BY family_name, given_name`,
      [visibleIds]
    );
  }

  if (scope.startsWith('book:')) {
    const bookId = scope.slice(5);
    if (!(await canAccessAddressbook(userId, bookId))) return null;
    return query<ContactRow>(
      `SELECT ${selectCols} FROM contacts WHERE addressbook_id = $1 ORDER BY family_name, given_name`,
      [bookId]
    );
  }

  if (scope.startsWith('mgroup:')) {
    const groupId = scope.slice(7);
    const [group] = await query<{ id: string }>(
      'SELECT id FROM contact_groups WHERE id = $1 AND owner_id = $2',
      [groupId, userId]
    );
    if (!group) return null;
    return query<ContactRow>(
      `SELECT ${selectCols} FROM contacts c
       JOIN contact_group_members m ON m.contact_uid = c.uid
       WHERE m.group_id = $1 AND c.addressbook_id = ANY($2::text[])
       ORDER BY c.family_name, c.given_name`,
      [groupId, visibleIds]
    );
  }

  return null;
}

// GET /api/transfer/export?format=vcard|csv&scope=all|book:<id>|mgroup:<id>
router.get('/export', async (req: AuthedRequest, res: Response) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'vcard';
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all';

    const contacts = await resolveScopeContacts(req.user!.id, scope);
    if (contacts === null) return res.status(403).json({ error: 'forbidden' });

    if (format === 'vcard') {
      const body = contacts.map((c) => c.raw_vcard).join('\r\n');
      res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="frigg-export.vcf"');
      return res.send(body);
    }

    let csv = '﻿' + toCsvRow([...CSV_HEADERS]);
    for (const c of contacts) {
      const addr = c.addresses[0];
      csv += toCsvRow([
        c.fn, c.given_name, c.family_name, c.org ?? '', c.title ?? '', c.birthday ?? '', c.note ?? '',
        labelValuesToCsv(c.emails), labelValuesToCsv(c.phones),
        addr?.street ?? '', addr?.city ?? '', addr?.state ?? '', addr?.zip ?? '', addr?.country ?? '',
      ]);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="frigg-export.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function parseLabelValuePairs(raw: string): { label: string; value: string }[] {
  if (!raw?.trim()) return [];
  return raw.split(';').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const idx = pair.indexOf(':');
    if (idx === -1) return { label: 'sonstige', value: pair };
    return { label: pair.slice(0, idx).trim() || 'sonstige', value: pair.slice(idx + 1).trim() };
  });
}

interface ImportError { line: number; message: string; }

// POST /api/transfer/import  { addressbook_id, format: 'vcard'|'csv', content: string }
router.post('/import', async (req: AuthedRequest, res: Response) => {
  try {
    const { addressbook_id: addressbookId, format, content } = req.body as {
      addressbook_id?: string; format?: string; content?: string;
    };
    if (!addressbookId || !content || (format !== 'vcard' && format !== 'csv')) {
      return res.status(400).json({ error: 'addressbook_id, format and content are required' });
    }
    if (!(await canAccessAddressbook(req.user!.id, addressbookId))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    let created = 0;
    const errors: ImportError[] = [];

    if (format === 'vcard') {
      const cards = splitVCards(content);
      for (let i = 0; i < cards.length; i++) {
        const parsed = parseVCard(cards[i]);
        if (!parsed) { errors.push({ line: i + 1, message: 'vCard konnte nicht gelesen werden' }); continue; }
        if (hasInvalidEmail(parsed.emails)) { errors.push({ line: i + 1, message: 'ungültige E-Mail-Adresse' }); continue; }
        if (hasInvalidPhone(parsed.phones)) { errors.push({ line: i + 1, message: 'ungültige Telefonnummer' }); continue; }
        if (isInvalidBirthday(parsed.birthday)) { errors.push({ line: i + 1, message: 'ungültiger Geburtstag' }); continue; }
        try {
          await createContact(addressbookId, {
            fn: parsed.fn, given_name: parsed.given_name, family_name: parsed.family_name,
            org: parsed.org, title: parsed.title, birthday: parsed.birthday, note: parsed.note,
            phones: parsed.phones, emails: parsed.emails, addresses: parsed.addresses,
          });
          created++;
        } catch (err) {
          console.error(err);
          errors.push({ line: i + 1, message: 'Kontakt konnte nicht angelegt werden' });
        }
      }
    } else {
      const rows = parseCsv(content);
      if (rows.length === 0) return res.status(400).json({ error: 'empty file' });

      const header = rows[0].map((h) => h.trim().toLowerCase());
      const colIndex = (name: string) => header.indexOf(name);

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const get = (name: string) => { const idx = colIndex(name); return idx === -1 ? '' : (row[idx] ?? '').trim(); };

        const given_name = get('given_name');
        const family_name = get('family_name');
        const fn = get('fn') || `${given_name} ${family_name}`.trim();
        if (!fn) { errors.push({ line: i + 1, message: 'Name fehlt' }); continue; }

        const emails = parseLabelValuePairs(get('emails'));
        const phones = parseLabelValuePairs(get('phones'));
        const birthday = get('birthday') || null;

        if (hasInvalidEmail(emails)) { errors.push({ line: i + 1, message: 'ungültige E-Mail-Adresse' }); continue; }
        if (hasInvalidPhone(phones)) { errors.push({ line: i + 1, message: 'ungültige Telefonnummer' }); continue; }
        if (isInvalidBirthday(birthday)) { errors.push({ line: i + 1, message: 'ungültiger Geburtstag' }); continue; }

        const street = get('street');
        const city = get('city');
        const addresses = (street || city)
          ? [{ label: 'privat', street, city, state: get('state') || undefined, zip: get('zip'), country: get('country') || undefined }]
          : [];

        try {
          await createContact(addressbookId, {
            fn, given_name, family_name,
            org: get('org') || null, title: get('title') || null, birthday, note: get('note') || null,
            phones, emails, addresses,
          });
          created++;
        } catch (err) {
          console.error(err);
          errors.push({ line: i + 1, message: 'Kontakt konnte nicht angelegt werden' });
        }
      }
    }

    res.json({ created, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
