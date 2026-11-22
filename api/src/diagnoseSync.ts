/** Standalone entry point: never import index.ts, bootstrap.ts or sync.ts. */
import { Pool } from 'pg';
import { buildClient, parseVCard } from './carddav';
import { diagnosticBook, diagnosticKey, diagnostics, diagnosticStep, safeSyncException } from './syncDiagnostics';
import { resourceUrl, DavError } from './davSafety';

export function readOnlyDavFetch(transport: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS', 'PROPFIND', 'REPORT'].includes(method)) throw new DavError(403, 'diagnostic_write_blocked');
    return transport(input, { ...init, redirect: 'error' });
  };
}
interface CachedResource { addressbook_id: string; vcard_uid: string; href: string | null }
interface Book { url: string }
interface Reader {
  addressBookQuery(args: object): Promise<Array<{ ok: boolean; error?: unknown; href?: string; status: number; raw?: { multistatus?: unknown } }>>;
  readVCard(url: string): Promise<{ raw: string; etag: string } | null>;
}

/** No database or DAV mutation capabilities are accepted by this scanner. */
export async function inspectBook(client: Reader, book: Book, bookId: string | undefined, cached: CachedResource[]) {
  return diagnosticBook(book.url, async () => {
    const d = diagnostics()!;
    const responses = await diagnosticStep('listing', () => client.addressBookQuery({ url: book.url, depth: '1', props: { 'd:getetag': {} } }));
    if (!Array.isArray(responses) || !responses.length) {
      const err = new DavError(503, 'invalid_collection_response');
      d.exception(err, 'listing'); throw err;
    }
    d.listed = responses.filter(r => r.href).length;
    // Simulate successful earlier upserts only in memory, to expose duplicate remote UIDs.
    const rows = cached.map(row => ({ ...row }));
    for (const response of responses) {
      let href: string | undefined;
      try {
        href = response.href ? resourceUrl(book.url, response.href) : undefined;
        if (!response.ok || response.error) { d.failure('invalid_resource', 'listing', href); continue; }
        if (!response.href && response.status === 207 && !response.raw) continue;
        if (!response.href || !response.raw?.multistatus) { d.failure('invalid_resource', 'listing', href); continue; }
        href = resourceUrl(book.url, response.href);
        const native = await diagnosticStep('native_read', () => client.readVCard(href!), href);
        if (!native) { d.failure('missing_resource', 'native_read', href); continue; }
        const parsed = parseVCard(native.raw, href);
        if (!parsed) continue;
        if (parsed.uid == null) { d.failure('projected_uid_null', 'preflight', href); continue; }
        const existing = rows.find(row => row.addressbook_id === (bookId ?? '') && row.vcard_uid === parsed.uid);
        if (existing && existing.href !== null && existing.href !== href && existing.href !== new URL(href).pathname) {
          d.failure('uid_href_conflict', 'preflight', href); continue;
        }
        if (rows.some(row => row !== existing && row.href === href)) { d.failure('href_unique_conflict', 'preflight', href); continue; }
        if (existing) existing.href = href;
        else rows.push({ addressbook_id: bookId ?? '', vcard_uid: parsed.uid, href });
        d.eligible++;
      } catch (err) { d.exception(err, 'native_read', href); }
    }
    return Object.values(d.errors).reduce((sum, count) => sum + count, 0);
  }, 'read_only');
}

export async function main() {
  // Fail before any connection. Never fall back to encryption credentials as HMAC key.
  if (!diagnosticKey()) throw new DavError(400, 'diagnostic_key_required');
  if (!process.env.DATABASE_URL) throw new DavError(400, 'database_configuration_required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: '-c default_transaction_read_only=on' });
  pool.on('error', err => safeSyncException(err, 'read_only'));
  let failures = 0;
  try {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const accounts = await connection.query('SELECT id, carddav_url, username, password_encrypted, password_iv, password_auth_tag FROM carddav_accounts');
        const books = await connection.query('SELECT id, url, carddav_account_id FROM addressbooks');
        const cached = await connection.query<CachedResource>('SELECT addressbook_id, vcard_uid, href FROM contacts');
        for (const account of accounts.rows) {
          try {
            const client = await buildClient(account, readOnlyDavFetch());
            const remoteBooks = await client.fetchAddressBooks();
            for (const book of remoteBooks) {
              const known = books.rows.find(row => row.carddav_account_id === account.id && row.url === book.url);
              try { failures += await inspectBook(client, book, known?.id, cached.rows); }
              catch { failures++; /* diagnosticBook already emitted sanitized failure */ }
            }
          } catch (err) { safeSyncException(err, 'read_only'); failures++; }
        }
      } finally { await connection.query('ROLLBACK'); }
    } finally { connection.release(); }
  } finally { await pool.end(); }
  return failures ? 2 : 0;
}
if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(err => { safeSyncException(err, 'read_only'); process.exitCode = 1; });
}
