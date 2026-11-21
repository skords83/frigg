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
): Promise<boolean> {
  const parsed = parseVCard(data);
  if (!parsed) return false;

  // Preserve internal IDs and local memberships while scoping remote UIDs to a book.
  const result = await pool.query(
    `INSERT INTO contacts
       (uid, vcard_uid, addressbook_id, href, etag, fn, given_name, family_name, org, title,
        birthday, note, photo_data_uri, phones, emails, addresses, raw_vcard, updated_at)
     VALUES ($17,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16, now())
     ON CONFLICT (addressbook_id, vcard_uid) DO UPDATE SET
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
     WHERE contacts.addressbook_id = EXCLUDED.addressbook_id
       AND (contacts.href IS NULL OR contacts.href = EXCLUDED.href OR contacts.href = $18)`,
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
      crypto.randomUUID(),
      new URL(href).pathname,
    ]
  );
  return result.rowCount === 1;
}

export async function fullSync(
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
    const href = card.url ? new URL(card.url, book.url).href : '';
    if (!href || !card.data) { errors++; continue; }
    serverHrefs.add(href);
    const ok = await upsertContact(bookId, href, card.etag ?? '', card.data ?? '');
    if (ok) synced++;
    else errors++;
  }

  // Delete contacts that no longer exist on the server
  const existing = await query<{ href: string | null; uid: string }>(
    'SELECT uid, href FROM contacts WHERE addressbook_id = $1',
    [bookId]
  );
  const toDelete = (errors ? [] : existing)
    .filter((r) => r.href !== null && !serverHrefs.has(new URL(r.href, book.url).href))
    .map((r) => r.uid);
  if (toDelete.length) {
    await pool.query('DELETE FROM contacts WHERE uid = ANY($1::text[]) AND addressbook_id = $2', [toDelete, bookId]);
    console.log(`[sync] ${displayName}: removed ${toDelete.length} stale contacts`);
  }

  const syncToken = (book as Record<string, unknown>).syncToken as string | null ?? null;
  return { synced, errors, syncToken };
}

export async function deltaSync(
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
    null;
  if (!newSyncToken || responses.some((r) => ![200, 201, 204, 207, 404].includes(r.status))) {
    throw new Error('Invalid sync response');
  }

  const vcfResponses = responses.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => typeof r.href === 'string' && new URL(r.href, book.url).href !== new URL(book.url).href
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const changedHrefs = vcfResponses.filter((r: any) => r.status !== 404).map((r: any) => new URL(r.href, book.url).href);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deletedHrefs = vcfResponses.filter((r: any) => r.status === 404).map((r: any) => new URL(r.href, book.url).href);

  console.log(`[sync] ${displayName}: ${changedHrefs.length} changed, ${deletedHrefs.length} deleted`);

  // Fetch full vCard data for changed/added resources
  if (changedHrefs.length > 0) {
    const multigetResults = await client.addressBookMultiGet({
      url: book.url,
      props: { 'card:address-data': {}, 'd:getetag': {} },
      objectUrls: changedHrefs,
      depth: '1',
    });

    const returned = new Set(multigetResults.map((r: DAVClient) => r.href ? new URL(r.href, book.url).href : ''));
    if (returned.size !== changedHrefs.length || changedHrefs.some((href: string) => !returned.has(href))) errors++;
    for (const res of multigetResults) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = res as any;
      const href: string = r.href ? new URL(r.href, book.url).href : '';
      const etag: string = r.props?.getetag ?? '';
      const data: string = r.props?.addressData?._cdata ?? r.props?.addressData ?? '';
      if (!data || !href || r.status >= 400) { errors++; continue; }

      const ok = await upsertContact(bookId, href, etag, data);
      if (ok) synced++; else errors++;
    }
  }

  // Delete contacts by href
  if (errors === 0 && deletedHrefs.length > 0) {
    await pool.query(
      'DELETE FROM contacts WHERE href = ANY($1::text[]) AND addressbook_id = $2',
      [deletedHrefs, bookId]
    );
    console.log(`[sync] ${displayName}: deleted ${deletedHrefs.length} contacts`);
  }

  return { synced, errors, syncToken: newSyncToken };
}

async function runSyncUnlocked(force = false): Promise<{ synced: number; errors: number }> {
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
        const [knownBook] = await query<{ id: string }>('SELECT id FROM addressbooks WHERE url = $1 AND carddav_account_id = $2', [book.url, account.id]);
        const bookId = knownBook?.id ?? crypto.randomUUID();
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
                 carddav_account_id = EXCLUDED.carddav_account_id,
                 updated_at   = now()`,
          [bookId, displayName, book.url, null, account.id]
        );

        const [pending] = await query<{count:string}>("SELECT COUNT(*)::text AS count FROM contact_operations WHERE status NOT IN ('complete','cancelled') AND (plan->'source'->>'book'=$1 OR plan->'target'->>'book'=$1)",[bookId]);
        if (Number(pending.count)>0) { errors++; continue; }
        const needsSync = force || !newCtag || !stored?.ctag || stored.ctag !== newCtag;
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
            console.warn('[sync] Delta sync failed; falling back to full sync');
            result = await fullSync(client, book, bookId, displayName);
          }
        } else {
          result = await fullSync(client, book, bookId, displayName, force);
        }

        synced += result.synced;
        errors += result.errors;

        // Persist the new sync-token from the server
        if (result.errors === 0) await pool.query(
          'UPDATE addressbooks SET sync_token = $1, ctag = $3, updated_at = now() WHERE id = $2',
          [result.syncToken, bookId, newCtag]
        );
      }
    } catch (err) {
      // One account's failure (e.g. wrong/expired Baïkal password) shouldn't stop
      // the others from syncing.
      console.error('[sync] Account synchronization failed');
      errors++;
    }
  }

  console.log(`[sync] Done — synced: ${synced}, errors: ${errors}`);
  return { synced, errors };
}

// Dedicated connection holds the lock across all queries and remote requests.
export async function runSync(force = false): Promise<{ synced: number; errors: number }> {
  const connection = await pool.connect();
  let locked = false;
  try {
    const result = await connection.query('SELECT pg_try_advisory_lock(186702, 1) AS locked');
    locked = result.rows[0].locked;
    if (!locked) return { synced: 0, errors: 0 };
    return await runSyncUnlocked(force);
  } finally {
    try {
      if (locked) await connection.query('SELECT pg_advisory_unlock(186702, 1)');
    } catch (err) {
      connection.release(true);
      throw err;
    }
    connection.release();
  }
}

export function startSyncSchedule(): void {
  runSync().catch((err) => console.error('[sync] Initial sync failed', err));

  cron.schedule('*/5 * * * *', () => {
    runSync().catch((err) => console.error('[sync] Scheduled sync failed', err));
  });
}
