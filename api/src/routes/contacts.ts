import { Router, Response } from 'express';
import { query, pool } from '../db';
import { getClientForAddressbook, parseVCard } from '../carddav';
import { getVisibleAddressbookIds, canAccessAddressbook } from '../auth/access';
import { hasInvalidEmail, hasInvalidPhone, isInvalidBirthday, withoutEmptyPhones, createContact } from '../contactOps';
import type { AuthedRequest } from '../auth/middleware';
import type { ContactRow } from '../types';

import { DavError, requireEtag, resourceUrl } from '../davSafety';
import { withDavLock } from '../davLock';
import { readRemoteContact, publicEditContact } from '../remoteContact';
import { patchDocument, projectDocument, type EditableFields } from '../vcardDocument';

const router = Router();

// GET /api/contacts
router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const visibleIds = await getVisibleAddressbookIds(req.user!.id);
    const contacts = await query<ContactRow>(
      `SELECT uid, addressbook_id, etag, fn, given_name, family_name, org, title,
              birthday, note, (photo_data_uri IS NOT NULL) AS has_photo, phones, emails, addresses, created_at, updated_at
       FROM contacts
       WHERE addressbook_id = ANY($1::text[])
       ORDER BY family_name, given_name`,
      [visibleIds]
    );
    res.json(contacts);
  } catch (err) {
    if (err instanceof DavError) return res.status(err.status).json({ error: err.code });
    console.error('Contact operation failed');
    res.status(500).json({ error: 'internal' });
  }
});

// GET /api/contacts/:uid
router.get('/:uid', async (req: AuthedRequest, res: Response) => {
  try {
    const [contact] = await query<ContactRow>(
      `SELECT uid, addressbook_id, etag, fn, given_name, family_name, org, title,
              birthday, note, (photo_data_uri IS NOT NULL) AS has_photo, phones, emails, addresses, created_at, updated_at
       FROM contacts WHERE uid = $1`,
      [req.params.uid]
    );
    if (!contact) return res.status(404).json({ error: 'not found' });
    if (!(await canAccessAddressbook(req.user!.id, contact.addressbook_id))) {
      return res.status(404).json({ error: 'not found' });
    }
    res.json(contact);
  } catch (err) {
    if (err instanceof DavError) return res.status(err.status).json({ error: err.code });
    console.error('Contact operation failed');
    res.status(500).json({ error: 'internal' });
  }
});

// GET /api/contacts/:uid/photo — serves the photo as a real cacheable image
// response instead of embedding it as base64 in every contact list payload.
router.get('/:uid/photo', async (req: AuthedRequest, res: Response) => {
  try {
    const [row] = await query<{ photo_data_uri: string | null; etag: string; addressbook_id: string }>(
      'SELECT photo_data_uri, etag, addressbook_id FROM contacts WHERE uid = $1',
      [req.params.uid]
    );
    if (!row || !row.photo_data_uri) return res.status(404).end();
    if (!(await canAccessAddressbook(req.user!.id, row.addressbook_id))) return res.status(404).end();

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
    if (err instanceof DavError) return res.status(err.status).json({ error: err.code });
    console.error('Contact operation failed');
    res.status(500).json({ error: 'internal' });
  }
});

// POST /api/contacts — create new contact
router.post('/', withDavLock(async (req: AuthedRequest, res: Response) => {
  try {
    const { addressbook_id, fn, given_name, family_name, org, title, birthday, note, emails, addresses } = req.body;
    const phones = withoutEmptyPhones(req.body.phones);

    if (hasInvalidEmail(emails)) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    if (hasInvalidPhone(phones)) {
      return res.status(400).json({ error: 'invalid_phone' });
    }
    if (isInvalidBirthday(birthday)) {
      return res.status(400).json({ error: 'invalid_birthday' });
    }

    if (!(await canAccessAddressbook(req.user!.id, addressbook_id))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const created = await createContact(addressbook_id, {
      fn, given_name, family_name, org, title, birthday, note, phones, emails, addresses,
    });
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof DavError) return res.status(err.status).json({ error: err.code });
    console.error('Contact operation failed');
    res.status(500).json({ error: 'internal' });
  }
}));

// GET /api/contacts/:uid/edit — a fresh, authorized editing baseline.
router.get('/:uid/edit', async (req: AuthedRequest, res: Response) => {
  try {
    const [stored] = await query<ContactRow>('SELECT * FROM contacts WHERE uid = $1', [req.params.uid]);
    if (!stored || !(await canAccessAddressbook(req.user!.id, stored.addressbook_id))) return res.status(404).json({ error: 'not found' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(publicEditContact((await readRemoteContact(stored)).contact));
  } catch (err) {
    if (err instanceof DavError) return res.status(err.status).json({ error: err.code });
    res.status(503).json({ error: 'dav_unavailable' });
  }
});

async function saveContact(req: AuthedRequest, res: Response, photoOnly = false) {
  let stored: ContactRow | undefined;
  try {
    [stored] = await query<ContactRow>('SELECT * FROM contacts WHERE uid = $1', [req.params.uid]);
    if (!stored || !(await canAccessAddressbook(req.user!.id, stored.addressbook_id))) return res.status(404).json({ error: 'not found' });
    if ((await query("SELECT 1 FROM contact_operations WHERE status NOT IN ('complete','cancelled') AND (source_uid=$1 OR target_uid=$1)",[stored.uid])).length) throw new DavError(409,'operation_pending');
    const etag = req.headers['if-match'];
    requireEtag(etag);
    const latest = await readRemoteContact(stored);
    if (latest.contact.etag !== etag) return res.status(409).json({ error: 'conflict', server: publicEditContact(latest.contact) });
    const fields: EditableFields = {};
    const allowed = photoOnly ? ['photo_data_uri'] : ['fn', 'given_name', 'family_name', 'org', 'title', 'birthday', 'note', 'phones', 'emails', 'addresses', 'photo_data_uri'];
    for (const key of allowed) if (req.body[key] !== undefined) Object.assign(fields, { [key]: req.body[key] });
    // Validate only changed values; externally created values must survive unrelated edits.
    if (fields.birthday !== undefined && fields.birthday !== latest.contact.birthday && isInvalidBirthday(fields.birthday)) return res.status(400).json({ error: 'invalid_birthday' });
    const raw = patchDocument(latest.contact.raw_vcard, fields);
    if (raw === latest.contact.raw_vcard) return res.json(publicEditContact(latest.contact));
    const response = await latest.client.updateVCard({ vCard: { url: latest.url, etag, data: raw } });
    const parsed = projectDocument(raw);
    const newEtag = response.headers.get('etag') ?? '';
    await pool.query(
      `UPDATE contacts SET etag=$1, fn=$2, given_name=$3, family_name=$4, org=$5, title=$6,
       birthday=$7, note=$8, phones=$9::jsonb, emails=$10::jsonb, addresses=$11::jsonb,
       raw_vcard=$12, photo_data_uri=$13, updated_at=now() WHERE uid=$14`,
      [newEtag, parsed.fn, parsed.given_name, parsed.family_name, parsed.org, parsed.title,
       parsed.birthday, parsed.note, JSON.stringify(parsed.phones), JSON.stringify(parsed.emails),
       JSON.stringify(parsed.addresses), raw, parsed.photo_data_uri, stored.uid]
    );
    return res.json(publicEditContact({ ...latest.contact, ...parsed, uid: stored.uid, vcard_uid: parsed.uid, etag: newEtag, has_photo: !!parsed.photo_data_uri }));
  } catch (err) {
    if (err instanceof DavError && err.code === 'conflict' && stored) {
      try {
        return res.status(409).json({ error: 'conflict', server: publicEditContact((await readRemoteContact(stored)).contact) });
      } catch { return res.status(409).json({ error: 'contact_unavailable' }); }
    }
    if (err instanceof DavError) return res.status(err.status).json({ error: err.code });
    console.error('Contact save failed');
    return res.status(503).json({ error: 'save_unconfirmed' });
  }
}
router.put('/:uid', withDavLock((req, res) => saveContact(req, res)));
router.patch('/:uid/photo', withDavLock((req, res) => saveContact(req, res, true)));

// Legacy clients must use the preview/execute operation API to obtain resumability.
router.patch('/:uid/move', (_req, res) => res.status(409).json({ error: 'operation_preview_required' }));

// DELETE /api/contacts/:uid
router.delete('/:uid', withDavLock(async (req: AuthedRequest, res: Response) => {
  try {
    const [stored] = await query<{ etag: string; addressbook_id: string; href: string | null }>(
      'SELECT etag, addressbook_id, href FROM contacts WHERE uid = $1',
      [req.params.uid]
    );
    if (!stored) return res.status(404).json({ error: 'not found' });
    if (!(await canAccessAddressbook(req.user!.id, stored.addressbook_id))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    if ((await query("SELECT 1 FROM contact_operations WHERE status NOT IN ('complete','cancelled') AND (source_uid=$1 OR target_uid=$1)",[req.params.uid])).length) throw new DavError(409,'operation_pending');
    const clientEtag = req.headers['if-match'];
    requireEtag(clientEtag);
    if (clientEtag && clientEtag !== stored.etag) {
      return res.status(409).json({ error: 'conflict', serverEtag: stored.etag });
    }

    const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [stored.addressbook_id]);
    const client = await getClientForAddressbook(stored.addressbook_id);
    if (!book) throw new DavError(409, 'sync_required');
    if (book) {
      const vcardUrl = resourceUrl(book.url, stored.href);
      await client.deleteVCard({ vCard: { url: vcardUrl, etag: stored.etag } as never });
    }

    await pool.query('DELETE FROM contacts WHERE uid = $1', [req.params.uid]);
    res.status(204).end();
  } catch (err) {
    if (err instanceof DavError) return res.status(err.status).json({ error: err.code });
    console.error('Contact operation failed');
    res.status(500).json({ error: 'internal' });
  }
}));

export default router;
