import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db';
import { fullSync, deltaSync, runSync } from '../src/sync';

const book = { url: 'https://dav.invalid/book/', syncToken: 'token-new' };
const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:synthetic\r\nFN:Synthetic\r\nEND:VCARD\r\n';

// All database entry points are replaced. These tests never connect to a database.
test('synchronization failure regression tests', async (t) => {
  let statements: { sql: string; args: unknown[] }[] = [];
  let collision = false;
  const original = pool.query;
  const originalConnect = pool.connect;
  pool.query = (async (sql: string, args: unknown[] = []) => {
    statements.push({ sql, args });
    if (sql.startsWith('SELECT uid, href')) return { rows: [{ uid: 'existing', href: '/book/existing' }, { uid: 'legacy', href: null }] };
    return { rows: [], rowCount: collision ? 0 : 1 };
  }) as typeof pool.query;
  try {
    await t.test('parse failure preserves old rows and reports an error', async () => {
      statements = [];
      const result = await fullSync({ fetchVCards: async () => [{ url: book.url + 'existing', data: 'invalid', etag: '"x"' }] }, book, 'book', 'synthetic');
      assert.equal(result.errors, 1);
      assert.equal(statements.some(s => s.sql.startsWith('DELETE')), false);
    });
    await t.test('UID collisions cannot reassign a contact to another book', async () => {
      statements = []; collision = true;
      const result = await fullSync({ fetchVCards: async () => [{ url: book.url + 'random', data: card, etag: '"x"' }] }, book, 'book', 'synthetic');
      assert.equal(result.errors, 1);
      assert.match(statements[0].sql, /WHERE contacts.addressbook_id = EXCLUDED.addressbook_id/);
      assert.equal(statements.some(s => s.sql.startsWith('DELETE')), false);
      collision = false;
    });
    await t.test('full sync retains legacy rows without href and scopes deletion to the book', async () => {
      statements = [];
      await fullSync({ fetchVCards: async () => [] }, book, 'book', 'synthetic');
      const deletion = statements.find(s => s.sql.startsWith('DELETE'))!;
      assert.deepEqual(deletion.args, [['existing'], 'book']);
      assert.match(deletion.sql, /AND addressbook_id = \$2/);
    });
    await t.test('failed full fetch performs no local mutations', async () => {
      statements = [];
      await assert.rejects(fullSync({ fetchVCards: async () => { throw new Error('offline'); } }, book, 'book', 'synthetic'));
      assert.equal(statements.length, 0);
    });
    await t.test('failed delta status is not interpreted as an empty successful sync', async () => {
      statements = [];
      await assert.rejects(deltaSync({ syncCollection: async () => [{ status: 503 }] }, book, 'book', 'synthetic', 'old'));
      assert.equal(statements.length, 0);
    });
    await t.test('delta requires its own token, not the discovery token', async () => {
      await assert.rejects(deltaSync({ syncCollection: async () => [] }, book, 'book', 'synthetic', 'old'));
    });
    await t.test('partial multiget failure prevents delta deletions', async () => {
      statements = [];
      const result = await deltaSync({
        syncCollection: async () => [
          { status: 200, href: '/book/no-extension', raw: { multistatus: { syncToken: 'new' } } },
          { status: 404, href: '/book/deleted' },
        ],
        addressBookMultiGet: async () => [],
      }, book, 'book', 'synthetic', 'old');
      assert.equal(result.errors, 1);
      assert.equal(statements.some(s => s.sql.startsWith('DELETE')), false);
    });
    await t.test('extensionless resources are synchronized with absolute hrefs', async () => {
      statements = [];
      const result = await deltaSync({
        syncCollection: async () => [{ status: 200, href: '/book/no-extension', raw: { multistatus: { syncToken: 'new' } } }],
        addressBookMultiGet: async () => [{ status: 200, href: '/book/no-extension', props: { getetag: '"new"', addressData: card } }],
      }, book, 'book', 'synthetic', 'old');
      assert.equal(result.synced, 1);
      assert.equal(statements[0].args[2], book.url + 'no-extension');
    });
    await t.test('another process holding the advisory lock prevents concurrent sync', async () => {
      let released = false;
      pool.connect = (async () => ({ query: async () => ({ rows: [{ locked: false }] }), release: () => { released = true; } })) as typeof pool.connect;
      statements = [];
      assert.deepEqual(await runSync(), { synced: 0, errors: 0 });
      assert.equal(released, true);
      assert.equal(statements.length, 0);
    });
  } finally {
    pool.query = original;
    pool.connect = originalConnect;
  }
});
