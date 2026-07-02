import { Router, Request, Response } from 'express';
import { query, pool } from '../db';
import { getClient, parseVCard, patchVCard, patchPhotoInVCard, escapeVCardValue, escapeVCardComponent, labelToVCardType } from '../carddav';
import type { ContactRow } from '../types';

const router = Router();

// GET /api/contacts
router.get('/', async (_req: Request, res: Response) => {
  try {
    const contacts = await query<ContactRow>(
      `SELECT uid, addressbook_id, etag, fn, given_name, family_name, org, title,
              birthday, note, (photo_data_uri IS NOT NULL) AS has_photo, phones, emails, addresses, created_at, updated_at
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
              birthday, note, (photo_data_uri IS NOT NULL) AS has_photo, phones, emails, addresses, created_at, updated_at
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

// GET /api/contacts/:uid/photo — serves the photo as a real cacheable image
// response instead of embedding it as base64 in every contact list payload.
router.get('/:uid/photo', async (req: Request, res: Response) => {
  try {
    const [row] = await query<{ photo_data_uri: string | null; etag: string }>(
      'SELECT photo_data_uri, etag FROM contacts WHERE uid = $1',
      [req.params.uid]
    );
    if (!row || !row.photo_data_uri) return res.status(404).end();

    const etag = `"photo-${row.etag}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    const match = /^data:([^;]+);base64,(.+)$/.exec(row.photo_data_uri);
    if (!match) return res.status(404).end();
    const [, mimeType, base64] = match;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('ETag', etag);
    res.send(Buffer.from(base64, 'base64'));
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

    // Patch only the known fields into the raw vCard (preserves unknown properties).
    // Each value is pre-escaped by the caller; patchVCard writes them as-is.
    // Trailing backslashes are stripped from name fields to recover previously corrupted data.
    const patchFields: Record<string, string> = {};
    if (fn !== undefined) patchFields['FN'] = escapeVCardValue((fn ?? '').replace(/\\+$/g, ''));
    if (given_name !== undefined || family_name !== undefined) {
      const g = escapeVCardComponent(((given_name ?? '') as string).replace(/\\+$/g, ''));
      const f = escapeVCardComponent(((family_name ?? '') as string).replace(/\\+$/g, ''));
      patchFields['N'] = `${f};${g};;;`;
    }
    if (org !== undefined) patchFields['ORG'] = org ? escapeVCardValue(org) : '';
    if (title !== undefined) patchFields['TITLE'] = title ? escapeVCardValue(title) : '';
    if (birthday !== undefined) patchFields['BDAY'] = birthday ?? '';
    if (note !== undefined) patchFields['NOTE'] = note ? escapeVCardValue(note) : '';

    // Multi-value fields: replace all TEL/EMAIL/ADR lines in the raw vCard so the
    // CardDAV server gets the authoritative data (not stale values from a previous sync).
    const multiFields: Record<string, string[]> = {};
    if (phones !== undefined) {
      multiFields['TEL'] = (phones as { label: string; value: string }[]).map(
        (p) => `TEL;TYPE=${labelToVCardType(p.label)}:${escapeVCardValue(p.value)}`
      );
    }
    if (emails !== undefined) {
      multiFields['EMAIL'] = (emails as { label: string; value: string }[]).map(
        (e) => `EMAIL;TYPE=${labelToVCardType(e.label)}:${escapeVCardValue(e.value)}`
      );
    }
    if (addresses !== undefined) {
      multiFields['ADR'] = (addresses as { label: string; street: string; city: string; state?: string; zip: string; country?: string }[]).map(
        (a) => `ADR;TYPE=${labelToVCardType(a.label)}:;;${escapeVCardComponent(a.street)};${escapeVCardComponent(a.city)};${escapeVCardComponent(a.state ?? '')};${escapeVCardComponent(a.zip)};${escapeVCardComponent(a.country ?? '')}`
      );
    }

    const newRawVcard = patchVCard(stored.raw_vcard, patchFields, multiFields);

    const client = await getClient();
    const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [stored.addressbook_id]);
    if (!book) return res.status(500).json({ error: 'address book not found' });

    const vcardUrl = `${book.url}${req.params.uid}.vcf`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateResult: any = await client.updateVCard({
      vCard: { url: vcardUrl, data: newRawVcard, etag: stored.etag },
    });
    // tsdav returns a raw Fetch Response; the ETag is in the response headers
    const newEtag: string = updateResult?.headers?.get?.('etag') ?? updateResult?.etag ?? stored.etag;

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
              birthday, note, (photo_data_uri IS NOT NULL) AS has_photo, phones, emails, addresses, created_at, updated_at
       FROM contacts WHERE uid = $1`,
      [req.params.uid]
    );
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// PATCH /api/contacts/:uid/photo
router.patch('/:uid/photo', async (req: Request, res: Response) => {
  try {
    const [stored] = await query<{ etag: string; raw_vcard: string; addressbook_id: string }>(
      'SELECT etag, raw_vcard, addressbook_id FROM contacts WHERE uid = $1',
      [req.params.uid]
    );
    if (!stored) return res.status(404).json({ error: 'not found' });

    const { photo_data_uri } = req.body as { photo_data_uri?: string | null };
    const removing = photo_data_uri === null || photo_data_uri === '';
    if (!removing && !photo_data_uri?.startsWith('data:image/')) {
      return res.status(400).json({ error: 'invalid photo_data_uri' });
    }

    const newRawVcard = removing
      ? stored.raw_vcard.replace(/^PHOTO[;:][^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/gim, '').replace(/(\r?\n){3,}/g, '\r\n')
      : patchPhotoInVCard(stored.raw_vcard, photo_data_uri!);

    const client = await getClient();
    const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [stored.addressbook_id]);
    if (!book) return res.status(500).json({ error: 'address book not found' });

    const vcardUrl = `${book.url}${req.params.uid}.vcf`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateResult: any = await client.updateVCard({
      vCard: { url: vcardUrl, data: newRawVcard, etag: stored.etag },
    });
    const newEtag: string = updateResult?.headers?.get?.('etag') ?? updateResult?.etag ?? stored.etag;

    await pool.query(
      `UPDATE contacts SET etag = $1, photo_data_uri = $2, raw_vcard = $3, updated_at = now() WHERE uid = $4`,
      [newEtag, removing ? null : photo_data_uri, newRawVcard, req.params.uid]
    );

    const [updated] = await query<ContactRow>(
      `SELECT uid, addressbook_id, etag, fn, given_name, family_name, org, title,
              birthday, note, (photo_data_uri IS NOT NULL) AS has_photo, phones, emails, addresses, created_at, updated_at
       FROM contacts WHERE uid = $1`,
      [req.params.uid]
    );
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// PATCH /api/contacts/:uid/move — move to a different address book
router.patch('/:uid/move', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const { addressbook_id: newBookId } = req.body as { addressbook_id?: string };
    if (!newBookId) return res.status(400).json({ error: 'addressbook_id required' });

    const [stored] = await query<{ etag: string; addressbook_id: string; raw_vcard: string }>(
      'SELECT etag, addressbook_id, raw_vcard FROM contacts WHERE uid = $1',
      [uid]
    );
    if (!stored) return res.status(404).json({ error: 'not found' });

    if (stored.addressbook_id === newBookId) {
      const [current] = await query<ContactRow>(
        `SELECT uid, addressbook_id, etag, fn, given_name, family_name, org, title,
                birthday, note, (photo_data_uri IS NOT NULL) AS has_photo, phones, emails, addresses, created_at, updated_at
         FROM contacts WHERE uid = $1`,
        [uid]
      );
      return res.json(current);
    }

    const [[oldBook], [newBook]] = await Promise.all([
      query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [stored.addressbook_id]),
      query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [newBookId]),
    ]);
    if (!newBook) return res.status(404).json({ error: 'target address book not found' });

    const client = await getClient();

    if (oldBook) {
      await client.deleteVCard({ vCard: { url: `${oldBook.url}${uid}.vcf`, etag: stored.etag } as never });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createResult: any = await client.createVCard({
      addressBook: { url: newBook.url },
      filename: `${uid}.vcf`,
      vCardString: stored.raw_vcard,
    });
    const newEtag: string = createResult?.etag ?? stored.etag;

    await pool.query(
      'UPDATE contacts SET addressbook_id = $1, etag = $2, updated_at = now() WHERE uid = $3',
      [newBookId, newEtag, uid]
    );

    const [updated] = await query<ContactRow>(
      `SELECT uid, addressbook_id, etag, fn, given_name, family_name, org, title,
              birthday, note, (photo_data_uri IS NOT NULL) AS has_photo, phones, emails, addresses, created_at, updated_at
       FROM contacts WHERE uid = $1`,
      [uid]
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

export default router;
