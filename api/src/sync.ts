import cron from 'node-cron';
import { getClientForAccount, parseVCard } from './carddav';
import { query, pool } from './db';
import type { AddressBookRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DAVBook = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DAVClient = any;

async function upsertContact(
  bookId: string,
  href: string,
  etag: string,
  data: string,
  force = false,
): Promise<boolean> {
  const parsed = parseVCard(data);
  if (!parsed) return false;

  const whereClause = force
    ? ''
    : 'WHERE contacts.etag IS DISTINCT FROM EXCLUDED.etag OR contacts.href IS DISTINCT FROM EXCLUDED.href';

  await pool.query(
    `INSERT INTO contacts
       (uid, addressbook_id, href, etag, fn, given_name, family_name, org, title,
        birthday, note, photo_data_uri, phones, emails, addresses, raw_vcard, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16, now())
     ON CONFLICT (uid) DO UPDATE SET
       addressbook_id  = EXCLUDED.addressbook_id,
       href            = EXCLUDED.href,
       etag            = EXCLUDED.etag,
       fn              = EXCLUDED.fn,
       given_name      = EXCLUDED.given_name,
       family_name     = EXCLUDED.family_name,
       org             = EXCLUDED.org,
       title           = EXCLUDED.title,
       birthday        = EXCLUDED.birthday,
       note            = EXCLUDED.note,
       photo_data_uri  = EXCLUDED.photo_data_uri,
       phones          = EXCLUDED.phones,
       emails          = EXCLUDED.emails,
       addresses       = EXCLUDED.addresses,
       raw_vcard       = EXCLUDED.raw_vcard,
       updated_at      = now()
     ${whereClause}`,
    [
      parsed.uid,
      bookId,
      href,
      etag,
      parsed.fn,
      parsed.given_name,
      parsed.family_name,
      parsed.org,
      parsed.title,
      parsed.birthday,
      parsed.note,
      parsed.photo_data_uri,
      JSON.stringify(parsed.phones),
      JSON.stringify(parsed.emails),
      JSON.stringify(parsed.addresses),
      parsed.raw_vcard,
    ]
  );
  return true;
}

async function fullSync(
  client: DAVClient,
  book: DAVBook,
  bookId: string,
  displayName: string,
  force = false,
): Promise<{ synced: number; errors: number; syncToken: string | null }> {
  console.log(`[sync] ${displayName}: full sync${force ? ' (forced re-parse)' : ''} …`);
  let synced = 0;
  let errors = 0;

  const vCards = await client.fetchVCards({ addressBook: book });
  const serverHrefs = new Set<string>();

  for (const card of vCards) {
    const href = card.url ?? '';
    const ok = await upsertContact(bookId, href, card.etag ?? '', card.data ?? '', force);
    if (ok) { serverHrefs.add(href); synced++; }
    else errors++;
  }

  // Delete contacts that no longer exist on the server
  const existing = await query<{ href: string | null; uid: string }>(
    'SELECT uid, href FROM contacts WHERE addressbook_id = $1',
    [bookId]
  );
  const toDelete = existing
    .filter((r) => r.href === null || !serverHrefs.has(r.href))
    .map((r) => r.uid);
  if (toDelete.length) {
    await pool.query('DELETE FROM contacts WHERE uid = ANY($1::text[])', [toDelete]);
    console.log(`[sync] ${displayName}: removed ${toDelete.length} stale contacts`);
  }

  const syncToken = (book as Record<string, unknown>).syncToken as string | null ?? null;
  return { synced, errors, syncToken };
}

async function deltaSync(
  client: DAVClient,
  book: DAVBook,
  bookId: string,
  displayName: string,
  storedSyncToken: string,
): Promise<{ synced: number; errors: number; syncToken: string | null }> {
  console.log(`[sync] ${displayName}: delta sync from token …`);
  let synced = 0;
  let errors = 0;

  // RFC 6578: sync-collection REPORT with the last known sync-token
  const responses: DAVClient[] = await client.syncCollection({
    url: book.url,
    props: { 'card:address-data': {}, 'd:getetag': {} },
    syncLevel: 1,
    syncToken: storedSyncToken,
  });

  // The new sync-token is in the multistatus wrapper of the first response
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newSyncToken: string | null =
    (responses[0] as any)?.raw?.multistatus?.syncToken ??
    (book as Record<string, unknown>).syncToken as string | null ??
    null;

  const vcfResponses = responses.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => (r.href as string | undefined)?.endsWith('.vcf')
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const changedHrefs = vcfResponses.filter((r: any) => r.status !== 404).map((r: any) => r.href as string);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deletedHrefs = vcfResponses.filter((r: any) => r.status === 404).map((r: any) => r.href as string);

  console.log(`[sync] ${displayName}: ${changedHrefs.length} changed, ${deletedHrefs.length} deleted`);

  // Fetch full vCard data for changed/added resources
  if (changedHrefs.length > 0) {
    const multigetResults = await client.addressBookMultiGet({
      url: book.url,
      props: { 'card:address-data': {}, 'd:getetag': {} },
      objectUrls: changedHrefs,
      depth: '1',
    });

    for (const res of multigetResults) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      const href: string = r.href ?? '';
      const etag: string = r.props?.getetag ?? '';
      const data: string = r.props?.addressData?._cdata ?? r.props?.addressData ?? '';
      if (!data) { errors++; continue; }

      const ok = await upsertContact(bookId, href, etag, data);
      if (ok) synced++; else errors++;
    }
  }

  // Delete contacts by href
  if (deletedHrefs.length > 0) {
    await pool.query(
      'DELETE FROM contacts WHERE href = ANY($1::text[]) AND addressbook_id = $2',
      [deletedHrefs, bookId]
    );
    console.log(`[sync] ${displayName}: deleted ${deletedHrefs.length} contacts`);
  }

  return { synced, errors, syncToken: newSyncToken };
}

export async function runSync(force = false): Promise<{ synced: number; errors: number }> {
  console.log(`[sync] Starting sync${force ? ' (forced re-parse of all contacts)' : ''} …`);
  let synced = 0;
  let errors = 0;

  const accounts = await query<{ id: string }>('SELECT id FROM carddav_accounts');
  if (accounts.length === 0) {
    console.warn('[sync] no carddav_accounts configured — nothing to sync');
    return { synced, errors };
  }

  for (const account of accounts) {
    try {
      const client = await getClientForAccount(account.id);
      const books = await client.fetchAddressBooks();

      for (const book of books) {
        const bookId = book.url;
        const displayName = (book.displayName as string | undefined) ?? book.url;
        const newCtag = (book as Record<string, unknown>).ctag as string | undefined ?? null;

        // Read stored state BEFORE upserting so we can compare old vs new ctag
        const [stored] = await query<AddressBookRow>(
          'SELECT ctag, sync_token FROM addressbooks WHERE id = $1',
          [bookId]
        );

        // Upsert addressbook metadata (sync_token is managed separately below)
        await pool.query(
          `INSERT INTO addressbooks (id, display_name, url, ctag, carddav_account_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO UPDATE
             SET display_name = EXCLUDED.display_name,
                 ctag         = EXCLUDED.ctag,
                 carddav_account_id = EXCLUDED.carddav_account_id,
                 updated_at   = now()`,
          [bookId, displayName, book.url, newCtag, account.id]
        );

        const needsSync = force || !stored?.ctag || stored.ctag !== newCtag;
        if (!needsSync) {
          console.log(`[sync] ${displayName}: ctag unchanged, skipping`);
          continue;
        }

        let result: { synced: number; errors: number; syncToken: string | null };

        const [{ count }] = await query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM contacts WHERE addressbook_id = $1',
          [bookId]
        );
        const hasLocalContacts = parseInt(count, 10) > 0;

        if (!force && stored?.sync_token && hasLocalContacts) {
          try {
            result = await deltaSync(client, book, bookId, displayName, stored.sync_token);
          } catch (err) {
            // Server rejected the sync-token (expired / invalid) → fall back to full sync
            console.warn(`[sync] ${displayName}: delta sync failed (${(err as Error).message}), falling back to full sync`);
            result = await fullSync(client, book, bookId, displayName);
          }
        } else {
          result = await fullSync(client, book, bookId, displayName, force);
        }

        synced += result.synced;
        errors += result.errors;

        // Persist the new sync-token from the server
        await pool.query(
          'UPDATE addressbooks SET sync_token = $1, updated_at = now() WHERE id = $2',
          [result.syncToken, bookId]
        );
      }
    } catch (err) {
      // One account's failure (e.g. wrong/expired Baïkal password) shouldn't stop
      // the others from syncing.
      console.error(`[sync] Fatal error for carddav_account ${account.id}`, err);
      errors++;
    }
  }

  console.log(`[sync] Done — synced: ${synced}, errors: ${errors}`);
  return { synced, errors };
}

export function startSyncSchedule(): void {
  runSync().catch((err) => console.error('[sync] Initial sync failed', err));

  cron.schedule('*/5 * * * *', () => {
    runSync().catch((err) => console.error('[sync] Scheduled sync failed', err));
  });
}
