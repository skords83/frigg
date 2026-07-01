import { Router, Request, Response } from 'express';
import { query, pool } from '../db';
import { getClient, parseVCard, patchVCard } from '../carddav';
import type { ContactRow } from '../types';

const router = Router();

// GET /api/contacts
router.get('/', async (_req: Request, res: Response) => {
  try {
    const contacts = await query<ContactRow>(
      `SELECT uid, addressbook_id, etag, fn, given_name, family_name, org, title,
              birthday, note, photo_data_uri, phones, emails, addresses, created_at, updated_at
       FROM contacts
       ORDER BY family_name, given_name`
    );
    res.json(contacts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// GET /api/contacts/:uid
router.get('/:uid', async (req: Request, res: Response) => {
  try {
    const [contact] = await query<ContactRow>(
      `SELECT uid, addressbook_id, etag, fn, given_name, family_name, org, title,
              birthday, note, photo_data_uri, phones, emails, addresses, created_at, updated_at
       FROM contacts WHERE uid = $1`,
      [req.params.uid]
    );
    if (!contact) return res.status(404).json({ error: 'not found' });
    res.json(contact);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// POST /api/contacts — create new contact
router.post('/', async (req: Request, res: Response) => {
  try {
    const { addressbook_id, fn, given_name, family_name, org, title, birthday, note, phones, emails, addresses } = req.body;

    const uid = crypto.randomUUID();
    const rawVcard = buildVCard({ uid, fn, given_name, family_name, org, title, birthday, note, phones, emails, addresses });

    const client = await getClient();
    const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [addressbook_id]);
    if (!book) return res.status(400).json({ error: 'address book not found' });

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
      [uid, addressbook_id, etag, fn ?? `${given_name} ${family_name}`.trim(),
       given_name ?? '', family_name ?? '', org ?? null, title ?? null,
       birthday ?? null, note ?? null,
       JSON.stringify(phones ?? []),
       JSON.stringify(emails ?? []),
       JSON.stringify(addresses ?? []),
       rawVcard]
    );

    const [created] = await query<ContactRow>('SELECT * FROM contacts WHERE uid = $1', [uid]);
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// PUT /api/contacts/:uid — update existing contact
router.put('/:uid', async (req: Request, res: Response) => {
  try {
    const [stored] = await query<{ etag: string; raw_vcard: string; addressbook_id: string }>(
      'SELECT etag, raw_vcard, addressbook_id FROM contacts WHERE uid = $1',
      [req.params.uid]
    );
    if (!stored) return res.status(404).json({ error: 'not found' });

    // ETag conflict check
    const clientEtag = req.headers['if-match'];
    if (clientEtag && clientEtag !== stored.etag) {
      return res.status(409).json({ error: 'conflict', serverEtag: stored.etag });
    }

    const { fn, given_name, family_name, org, title, birthday, note, phones, emails, addresses } = req.body;

    // Patch only the known fields into the raw vCard (preserves unknown properties)
    const patchFields: Record<string, string> = {};
    if (fn !== undefined) patchFields['FN'] = fn;
    if (given_name !== undefined || family_name !== undefined) {
      const g = given_name ?? '';
      const f = family_name ?? '';
      patchFields['N'] = `${f};${g};;;`;
    }
    if (org !== undefined) patchFields['ORG'] = org;
    if (title !== undefined) patchFields['TITLE'] = title;
    if (birthday !== undefined) patchFields['BDAY'] = birthday;
    if (note !== undefined) patchFields['NOTE'] = note;

    const newRawVcard = patchVCard(stored.raw_vcard, patchFields);

    const client = await getClient();
    const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [stored.addressbook_id]);
    if (!book) return res.status(500).json({ error: 'address book not found' });

    const vcardUrl = `${book.url}${req.params.uid}.vcf`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateResult: any = await client.updateVCard({
      vCard: { url: vcardUrl, data: newRawVcard, etag: stored.etag },
    });
    const newEtag = (updateResult?.etag as string | undefined) ?? stored.etag;

    // Rebuild the parsed data from the new raw vCard
    const parsed = parseVCard(newRawVcard);

    await pool.query(
      `UPDATE contacts SET
         etag = $1, fn = $2, given_name = $3, family_name = $4, org = $5, title = $6,
         birthday = $7, note = $8, phones = $9::jsonb, emails = $10::jsonb,
         addresses = $11::jsonb, raw_vcard = $12, updated_at = now()
       WHERE uid = $13`,
      [
        newEtag,
        parsed?.fn ?? fn ?? '',
        parsed?.given_name ?? given_name ?? '',
        parsed?.family_name ?? family_name ?? '',
        parsed?.org ?? org ?? null,
        parsed?.title ?? title ?? null,
        parsed?.birthday ?? birthday ?? null,
        parsed?.note ?? note ?? null,
        JSON.stringify(phones !== undefined ? phones : (parsed?.phones ?? [])),
        JSON.stringify(emails !== undefined ? emails : (parsed?.emails ?? [])),
        JSON.stringify(addresses !== undefined ? addresses : (parsed?.addresses ?? [])),
        newRawVcard,
        req.params.uid,
      ]
    );

    const [updated] = await query<ContactRow>(
      `SELECT uid, addressbook_id, etag, fn, given_name, family_name, org, title,
              birthday, note, photo_data_uri, phones, emails, addresses, created_at, updated_at
       FROM contacts WHERE uid = $1`,
      [req.params.uid]
    );
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// DELETE /api/contacts/:uid
router.delete('/:uid', async (req: Request, res: Response) => {
  try {
    const [stored] = await query<{ etag: string; addressbook_id: string }>(
      'SELECT etag, addressbook_id FROM contacts WHERE uid = $1',
      [req.params.uid]
    );
    if (!stored) return res.status(404).json({ error: 'not found' });

    const clientEtag = req.headers['if-match'];
    if (clientEtag && clientEtag !== stored.etag) {
      return res.status(409).json({ error: 'conflict', serverEtag: stored.etag });
    }

    const client = await getClient();
    const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [stored.addressbook_id]);
    if (book) {
      const vcardUrl = `${book.url}${req.params.uid}.vcf`;
      await client.deleteVCard({ vCard: { url: vcardUrl, etag: stored.etag } as never });
    }

    await pool.query('DELETE FROM contacts WHERE uid = $1', [req.params.uid]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

function buildVCard(fields: {
  uid: string;
  fn?: string;
  given_name?: string;
  family_name?: string;
  org?: string;
  title?: string;
  birthday?: string;
  note?: string;
  phones?: Array<{ label: string; value: string }>;
  emails?: Array<{ label: string; value: string }>;
  addresses?: Array<{ label: string; street: string; city: string; zip: string; state?: string; country?: string }>;
}): string {
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

function labelToVCardType(label: string): string {
  const map: Record<string, string> = {
    mobil: 'cell', mobile: 'cell', arbeit: 'work', privat: 'home', zuhause: 'home',
  };
  return map[label.toLowerCase()] ?? label;
}

export default router;
