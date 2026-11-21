import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const migrations = resolve(process.cwd(), process.cwd().endsWith('/api') ? '../db/migrations' : 'db/migrations');

test('additive identity migration preserves synthetic contacts/groups and is repeatable', async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    for (const file of ['001_init.sql','002_add_contact_href.sql','003_add_auth.sql','004_add_manual_groups.sql']) await db.exec(await readFile(resolve(migrations,file),'utf8'));
    await db.exec(`INSERT INTO addressbooks(id,display_name,url) VALUES ('a','A','https://dav.invalid/a/'),('b','B','https://dav.invalid/b/');
      INSERT INTO contacts(uid,addressbook_id,raw_vcard) VALUES ('legacy','a','synthetic original');
      INSERT INTO users(id,email,password_hash) VALUES ('00000000-0000-0000-0000-000000000001','test@example.invalid','not-a-real-hash');
      INSERT INTO contact_groups(id,owner_id,name) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Original group');
      INSERT INTO contact_group_members(group_id,contact_uid) VALUES ('00000000-0000-0000-0000-000000000002','legacy');`);
    const sql = await readFile(resolve(migrations,'005_contact_identity_operations.sql'),'utf8');
    await db.exec(sql); await db.exec(sql);
    const contact = (await db.query('SELECT uid,vcard_uid,raw_vcard FROM contacts')).rows[0];
    assert.deepEqual(contact, { uid:'legacy', vcard_uid:'legacy', raw_vcard:'synthetic original' });
    assert.equal((await db.query('SELECT * FROM contact_group_members')).rows.length,1);
    await db.exec("INSERT INTO contacts(uid,vcard_uid,addressbook_id) VALUES ('new-internal-id','legacy','b')");
    assert.equal((await db.query('SELECT * FROM contacts')).rows.length,2);
    await assert.rejects(db.exec("INSERT INTO contacts(uid,vcard_uid,addressbook_id) VALUES ('another-id','legacy','a')"));
    await db.exec(sql);
    assert.equal((await db.query("SELECT contact_uid FROM contact_group_members")).rows[0].contact_uid,'legacy');
  } finally { await db.close(); }
});
