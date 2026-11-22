import { DavError, requireEtag, resourceUrl } from './davSafety';
import { getClientForAddressbook, parseVCard } from './carddav';
import { query } from './db';
import type { ContactRow } from './types';

export async function readRemoteContact(stored: ContactRow) {
  const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [stored.addressbook_id]);
  if (!book) throw new DavError(409, 'sync_required');
  const url = resourceUrl(book.url, stored.href);
  const client = await getClientForAddressbook(stored.addressbook_id);
  const card = await client.readVCard(url);
  if (!card) throw new DavError(409, 'contact_unavailable');
  const parsed = parseVCard(card.raw);
  if (!parsed || parsed.uid !== stored.vcard_uid) throw new DavError(422, 'invalid_vcard');
  return { client, url, contact: { ...stored, ...parsed, uid: stored.uid, vcard_uid: parsed.uid, etag: card.etag, has_photo: !!parsed.photo_data_uri } };
}

export function publicEditContact(contact: ContactRow) {
  const { raw_vcard: _raw, href: _href, ...result } = contact;
  return result;
}
