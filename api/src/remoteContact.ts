import { DavError, requireEtag, resourceUrl } from './davSafety';
import { getClientForAddressbook, parseVCard } from './carddav';
import { query } from './db';
import type { ContactRow } from './types';

export async function readRemoteContact(stored: ContactRow) {
  const [book] = await query<{ url: string }>('SELECT url FROM addressbooks WHERE id = $1', [stored.addressbook_id]);
  if (!book) throw new DavError(409, 'sync_required');
  const url = resourceUrl(book.url, stored.href);
  const client = await getClientForAddressbook(stored.addressbook_id);
  const cards = await client.fetchVCards({ addressBook: { url: book.url }, objectUrls: [url], urlFilter: () => true });
  if (cards.length !== 1 || !cards[0]?.data) throw new DavError(409, 'contact_unavailable');
  const card = cards[0];
  if (!card.url || new URL(card.url, book.url).href !== url) throw new DavError(409, 'invalid_resource_url');
  requireEtag(card.etag);
  const parsed = parseVCard(card.data);
  if (!parsed || parsed.uid !== stored.uid) throw new DavError(422, 'invalid_vcard');
  return { client, url, contact: { ...stored, ...parsed, etag: card.etag, has_photo: !!parsed.photo_data_uri } };
}

export function publicEditContact(contact: ContactRow) {
  const { raw_vcard: _raw, href: _href, ...result } = contact;
  return result;
}
