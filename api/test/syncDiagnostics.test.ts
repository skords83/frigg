import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import VCF from 'vcf';
import { pool } from '../src/db';
import { encryptSecret } from '../src/crypto';
import { fullSync, runSync } from '../src/sync';
import { parseVCard, withNativeCards } from '../src/carddav';
import { DavError } from '../src/davSafety';
import { diagnosticBook, diagnosticKey, Diagnostics } from '../src/syncDiagnostics';
import { inspectBook, main, readOnlyDavFetch } from '../src/diagnoseSync';

const book = { url: 'https://private.invalid/private-book/', syncToken: 'secret-token' };
const href = book.url + 'secret-resource';
const raw = 'BEGIN:VCARD\r\nVERSION:4.0\r\nUID:private-uid\r\nFN:Private Name\r\nEND:VCARD\r\n';
const key = 'ab'.repeat(32);

test('private structured diagnostics and read-only inspection', async t => {
  const logs: string[] = [];
  const log = console.log;
  const query = pool.query;
  const oldKey = process.env.SYNC_DIAGNOSTICS_KEY;
  const oldEncryption = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.SYNC_DIAGNOSTICS_KEY = key;
  console.log = (...args) => { logs.push(args.join(' ')); };
  const events = () => logs.filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const summary = () => events().findLast(e => e.type === 'book_summary');
  try {
    await t.test('HMAC is stable, domain-separated and never contains identifiers or exception text', () => {
      const d = new Diagnostics(book.url);
      d.exception(Object.assign(new Error('Private Name secret-password'), { code: '23505', detail: href }), 'upsert', href);
      d.summary();
      const event = events()[0];
      assert.equal(event.code, '23505');
      assert.equal(event.resource_ref, createHmac('sha256', Buffer.from(key, 'hex')).update('resource\0' + book.url + '\0' + href).digest('hex'));
      assert.notEqual(event.resource_ref, event.book_ref);
      const another = new Diagnostics(book.url);
      another.failure('missing_resource', 'native_read', href);
      assert.equal(events()[2].resource_ref, event.resource_ref);
      for (const secret of ['private.invalid', 'Private Name', 'secret-password', 'secret-resource', 'secret-token', 'private-uid', key]) assert.equal(logs.join('').includes(secret), false);
      logs.length = 0;
    });
    await t.test('missing/invalid/reused key never falls back to credentials', () => {
      delete process.env.SYNC_DIAGNOSTICS_KEY;
      new Diagnostics(book.url).failure('missing_resource', 'native_read', href);
      assert.equal(events()[0].resource_ref, undefined);
      process.env.SYNC_DIAGNOSTICS_KEY = 'bad';
      assert.equal(diagnosticKey(), undefined);
      process.env.SYNC_DIAGNOSTICS_KEY = key;
      process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.from(key, 'hex').toString('base64');
      assert.equal(diagnosticKey(), undefined);
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      logs.length = 0;
    });
    await t.test('both parser stages report safe reasons and retain null contract', async () => {
      await diagnosticBook(book.url, async () => {
        assert.equal(parseVCard(raw.replace('4.0', '2.1'), href), null);
        const original = VCF.parse;
        VCF.parse = () => { throw new Error('Private Name'); };
        try { assert.equal(parseVCard(raw, href), null); } finally { VCF.parse = original; }
      });
      assert.deepEqual(summary().errors_by_category, { document_parse_failed: 1, vcf_parse_failed: 1 });
      assert.equal(events()[0].code, 'unsupported_vcard_version');
      assert.equal(logs.join('').includes('Private Name'), false);
      logs.length = 0;
    });
    await t.test('full sync counts parser, missing and UID/href errors without cleanup', async () => {
      const sql: string[] = [];
      pool.query = (async (statement: string) => { sql.push(statement); return { rows: [], rowCount: 0 }; }) as typeof pool.query;
      let reads = 0;
      const result = await fullSync({
        fetchVCards: async () => [0, 1, 2].map(n => ({ url: href + n, data: raw })),
        readVCard: async () => ++reads === 1 ? { raw: 'invalid', etag: '"secret"' } : reads === 2 ? null : { raw, etag: '"secret"' },
      }, book, 'book', 'Private Name');
      assert.deepEqual(result, { synced: 0, errors: 3, syncToken: 'secret-token' });
      assert.deepEqual(summary().errors_by_category, { document_parse_failed: 1, missing_resource: 1, uid_href_conflict: 1 });
      assert.equal(summary().listed_resources, 3);
      assert.equal(summary().markers, 'unchanged');
      assert.equal(sql.some(s => /DELETE|UPDATE addressbooks/.test(s)), false);
      assert.equal(logs.join('').includes('Private Name'), false);
      logs.length = 0;
    });
    await t.test('database exception keeps identity and partial-success count without swallowing', async () => {
      const error = Object.assign(new Error('private-uid'), { code: '23505', detail: href });
      let inserts = 0;
      pool.query = (async () => { if (++inserts === 2) throw error; return { rows: [], rowCount: 1 }; }) as typeof pool.query;
      await assert.rejects(fullSync({ fetchVCards: async () => [0, 1].map(n => ({ url: href + n, data: raw })), readVCard: async () => ({ raw, etag: '"x"' }) }, book, 'book', 'Private Name'), err => err === error);
      assert.equal(summary().successful_upserts, 1);
      assert.equal(summary().markers, 'unchanged');
      assert.deepEqual(summary().errors_by_category, { database_exception: 1 });
      assert.equal(events()[0].code, '23505');
      logs.length = 0;
    });
    await t.test('native prefetch exceptions retain resource reference before fullSync loop', async () => {
      const client = withNativeCards({ addressBookQuery: async () => [{ ok: true, href, raw: { multistatus: {} } }], propfind: async () => { throw new DavError(503, 'dav_read_failed'); } });
      await assert.rejects(fullSync(client, book, 'book', 'Private Name'));
      assert.equal(events()[0].reason, 'dav_exception');
      assert.equal(events()[0].phase, 'native_read');
      assert.ok(events()[0].resource_ref);
      assert.equal(summary().listed_resources, 1);
      logs.length = 0;
    });
    await t.test('read-only scanner continues after errors, simulates conflicts, accepts groups and performs no DB calls', async () => {
      pool.query = (async () => { throw new Error('Unexpected database access'); }) as typeof pool.query;
      const cards = [raw.replace('4.0', '2.1'), null, new DavError(503, 'dav_read_failed'), raw, raw, raw.replace('private-uid', 'other-uid'), raw.replace('UID:private-uid', 'UID;ENCODING=b:encoded'), raw.replace('private-uid', 'group-uid').replace('END:VCARD', 'KIND:group\r\nMEMBER:urn:uuid:unresolved\r\nEND:VCARD')];
      const failures = await inspectBook({
        addressBookQuery: async () => cards.map((_, n) => ({ ok: true, href: href + n, status: 200, raw: { multistatus: {} } })),
        readVCard: async url => { const value = cards[Number(url.slice(-1))]; if (value instanceof Error) throw value; return value === null ? null : { raw: value, etag: '"x"' }; },
      }, book, 'book', [{ addressbook_id: 'other-book', vcard_uid: 'other', href: href + 5 }]);
      assert.equal(failures, 6);
      assert.equal(summary().mode, 'read_only');
      assert.equal(summary().listed_resources, 8);
      assert.equal(summary().successful_upserts, 0);
      assert.equal(summary().eligible_resources, 2);
      assert.equal(summary().markers, 'unchanged');
      assert.deepEqual(summary().errors_by_category, { document_parse_failed: 1, missing_resource: 1, dav_exception: 1, uid_href_conflict: 1, href_unique_conflict: 1, projected_uid_null: 1 });
      assert.equal(logs.join('').includes('private-uid'), false);
      logs.length = 0;
    });
    await t.test('DAV allowlist blocks every write, including Request objects, before transport', async () => {
      const methods: string[] = [];
      const transport = readOnlyDavFetch(async (_input, init) => { methods.push(init?.method ?? 'GET'); assert.equal(init?.redirect, 'error'); return new Response(); });
      for (const method of ['PUT', 'DELETE', 'MOVE', 'COPY', 'POST', 'MKCOL', 'PROPPATCH', 'PATCH']) {
        await assert.rejects(transport(href, { method }));
        await assert.rejects(transport(new Request(href, { method })));
      }
      assert.equal(methods.length, 0);
      for (const method of ['GET', 'HEAD', 'OPTIONS', 'PROPFIND', 'REPORT']) await transport(href, { method });
      assert.equal(methods.length, 5);
    });
    await t.test('orchestrator preserves marker and return-value decisions for success, rejection, pending and marker failure', async () => {
      const tsdav = require('tsdav');
      const create = tsdav.createDAVClient;
      const connect = pool.connect;
      process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
      const secret = encryptSecret('secret-password');
      try {
        for (const scenario of ['success', 'parse', 'pending', 'marker-failure']) {
          logs.length = 0;
          const statements: string[] = [];
          const accountId = 'synthetic-' + scenario;
          tsdav.createDAVClient = async () => ({
            fetchAddressBooks: async () => [{ ...book, displayName: 'Private Name', ctag: 'secret-ctag' }],
            addressBookQuery: async () => [{ ok: true, href, status: 200, raw: { multistatus: {} } }],
            propfind: async () => [{ ok: true, status: 200, props: { addressData: scenario === 'parse' ? 'bad' : raw, getetag: '\"x\"' } }],
          });
          pool.connect = (async () => ({ query: async () => ({ rows: [{ locked: true }] }), release: () => {} })) as typeof pool.connect;
          pool.query = (async (sql: string) => {
            statements.push(sql);
            if (sql === 'SELECT id FROM carddav_accounts') return { rows: [{ id: accountId }] };
            if (sql.includes('password_encrypted')) return { rows: [{ id: accountId, carddav_url: book.url, username: 'secret-user', password_encrypted: secret.ciphertext, password_iv: secret.iv, password_auth_tag: secret.authTag }] };
            if (sql.startsWith('SELECT id FROM addressbooks')) return { rows: [{ id: 'book' }] };
            if (sql.startsWith('SELECT ctag')) return { rows: [{ ctag: null, sync_token: null }] };
            if (sql.includes('COUNT(*)')) return { rows: [{ count: sql.includes('contact_operations') && scenario === 'pending' ? '1' : '0' }] };
            if (sql.startsWith('UPDATE addressbooks') && scenario === 'marker-failure') throw Object.assign(new Error('secret-token'), { code: '08006' });
            return { rows: [], rowCount: 1 };
          }) as typeof pool.query;
          const result = await runSync();
          assert.deepEqual(result, { synced: ['success', 'marker-failure'].includes(scenario) ? 1 : 0, errors: scenario === 'success' ? 0 : 1 });
          assert.equal(statements.some(sql => sql.startsWith('UPDATE addressbooks')), ['success', 'marker-failure'].includes(scenario));
          assert.equal(summary().markers, scenario === 'success' ? 'advanced' : scenario === 'marker-failure' ? 'write_failed' : 'unchanged');
          assert.equal(summary().successful_upserts, result.synced);
          for (const value of ['Private Name', 'secret-token', 'secret-ctag', 'secret-password', 'secret-user', href]) assert.equal(logs.join('').includes(value), false);
        }
      } finally { tsdav.createDAVClient = create; pool.connect = connect; delete process.env.CREDENTIALS_ENCRYPTION_KEY; logs.length = 0; }
    });
    await t.test('CLI fails before connect without key; valid run uses only read-only transaction and SELECT', async () => {
      const originalConnect = Pool.prototype.connect;
      const originalEnd = Pool.prototype.end;
      const oldUrl = process.env.DATABASE_URL;
      const sql: string[] = [];
      let connects = 0, released = false;
      Pool.prototype.connect = (async function(this: Pool) {
        connects++;
        assert.equal(this.options.options, '-c default_transaction_read_only=on');
        return { query: async (statement: string) => { sql.push(statement); return { rows: [] }; }, release: () => { released = true; } };
      }) as typeof Pool.prototype.connect;
      Pool.prototype.end = (async () => {}) as typeof Pool.prototype.end;
      try {
        delete process.env.SYNC_DIAGNOSTICS_KEY;
        await assert.rejects(main());
        assert.equal(connects, 0);
        process.env.SYNC_DIAGNOSTICS_KEY = key;
        process.env.DATABASE_URL = 'postgres://synthetic.invalid/db';
        assert.equal(await main(), 0);
        assert.equal(sql[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        assert.equal(sql.at(-1), 'ROLLBACK');
        assert.ok(sql.slice(1, -1).every(s => s.startsWith('SELECT ')));
        assert.equal(released, true);
      } finally {
        Pool.prototype.connect = originalConnect; Pool.prototype.end = originalEnd;
        if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
      }
    });
  } finally {
    console.log = log; pool.query = query;
    if (oldKey === undefined) delete process.env.SYNC_DIAGNOSTICS_KEY; else process.env.SYNC_DIAGNOSTICS_KEY = oldKey;
    if (oldEncryption === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY; else process.env.CREDENTIALS_ENCRYPTION_KEY = oldEncryption;
  }
});
