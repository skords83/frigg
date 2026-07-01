import cron from 'node-cron';
import { getClient, parseVCard } from './carddav';
import { query, pool } from './db';
import type { AddressBookRow } from './types';

export async function runSync(): Promise<{ synced: number; errors: number }> {
  console.log('[sync] Starting sync …');
  let synced = 0;
  let errors = 0;

  try {
    const client = await getClient();
    const books = await client.fetchAddressBooks();

    for (const book of books) {
      const bookId = book.url;
      const displayName = (book.displayName as string | undefined) ?? book.url;
      const newCtag = (book as Record<string, unknown>).ctag as string | undefined ?? null;

      // Upsert addressbook row
      await pool.query(
        `INSERT INTO addressbooks (id, display_name, url, ctag, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               ctag = EXCLUDED.ctag,
               updated_at = now()`,
        [bookId, displayName, book.url, newCtag]
      );

      // Fetch stored ctag to decide whether a delta fetch is needed
      const [stored] = await query<AddressBookRow>(
        'SELECT ctag FROM addressbooks WHERE id = $1',
        [bookId]
      );

      // Always sync on first run; afterwards only when ctag changed
      const needsSync = !stored?.ctag || stored.ctag !== newCtag;
      if (!needsSync) {
        console.log(`[sync] ${displayName}: ctag unchanged, skipping`);
        continue;
      }

      console.log(`[sync] ${displayName}: ctag changed, fetching cards …`);

      // Fetch all vCards for this address book
      const vCards = await client.fetchVCards({ addressBook: book });

      // Determine which UIDs are still on the server
      const serverUids = new Set<string>();

      for (const card of vCards) {
        const parsed = parseVCard(card.data ?? '');
        if (!parsed) { errors++; continue; }

        serverUids.add(parsed.uid);

        await pool.query(
          `INSERT INTO contacts
             (uid, addressbook_id, etag, fn, given_name, family_name, org, title,
              birthday, note, photo_data_uri, phones, emails, addresses, raw_vcard, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15, now())
           ON CONFLICT (uid) DO UPDATE SET
             addressbook_id  = EXCLUDED.addressbook_id,
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
           WHERE contacts.etag IS DISTINCT FROM EXCLUDED.etag`,
          [
            parsed.uid,
            bookId,
            card.etag ?? '',
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
        synced++;
      }

      // Delete contacts that no longer exist on the server
      const existing = await query<{ uid: string }>(
        'SELECT uid FROM contacts WHERE addressbook_id = $1',
        [bookId]
      );
      const toDelete = existing.map((r) => r.uid).filter((uid) => !serverUids.has(uid));
      if (toDelete.length) {
        await pool.query(
          `DELETE FROM contacts WHERE uid = ANY($1::text[])`,
          [toDelete]
        );
        console.log(`[sync] ${displayName}: removed ${toDelete.length} deleted contacts`);
      }

      // Update stored ctag
      await pool.query(
        'UPDATE addressbooks SET ctag = $1, updated_at = now() WHERE id = $2',
        [newCtag, bookId]
      );
    }
  } catch (err) {
    console.error('[sync] Fatal error', err);
    errors++;
  }

  console.log(`[sync] Done — synced: ${synced}, errors: ${errors}`);
  return { synced, errors };
}

export function startSyncSchedule(): void {
  // Trigger an initial sync on startup
  runSync().catch((err) => console.error('[sync] Initial sync failed', err));

  // Then every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    runSync().catch((err) => console.error('[sync] Scheduled sync failed', err));
  });
}
