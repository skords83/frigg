import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pool } from '../src/db';
import { encryptSecret } from '../src/crypto';
import { requireAuth,requireActive } from '../src/auth/middleware';
import contactsRouter from '../src/routes/contacts';
import operationsRouter from '../src/routes/operations';
import { runSync } from '../src/sync';
import { getClientForAccount } from '../src/carddav';
import { buildVCard } from '../src/contactOps';
import { patchDocument } from '../src/vcardDocument';

async function unusedPort() {const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return port;}

test('real Baikal 0.13 + PostgreSQL engine: authenticated CRUD, conflicts, move, merge and identities', {skip:!process.env.FRIGG_BAIKAL_RELEASE, timeout:60_000},async()=>{
  const root=resolve(process.cwd(),process.cwd().endsWith('/api')?'..':'.');
  const data=await mkdtemp(join(tmpdir(),'frigg-baikal-run-'));
  const port=await unusedPort(),url=`http://127.0.0.1:${port}/dav.php/`;
  const php=spawn(process.env.FRIGG_TEST_PHP??'php',[...(process.env.FRIGG_TEST_PHP_EXT?['-n','-d',`extension_dir=${process.env.FRIGG_TEST_PHP_EXT}`,'-d','extension=pdo_sqlite']:[]),'-d','display_errors=0','-S',`127.0.0.1:${port}`,join(root,'tests/integration/baikal-router.php')],{env:{...process.env,FRIGG_BAIKAL_DATA:data},stdio:'ignore'});
  const db=new PGlite({extensions:{pg_trgm}});
  const originalQuery=pool.query,originalConnect=pool.connect;
  let server:ReturnType<ReturnType<typeof express>['listen']>|undefined;
  const userId='00000000-0000-0000-0000-000000000001',accountId='00000000-0000-0000-0000-000000000002';
  const oldKey=process.env.CREDENTIALS_ENCRYPTION_KEY;
  try {
    for(let i=0;i<50;i++){try {if((await fetch(`http://127.0.0.1:${port}/healthz`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    for(const file of (await readdir(join(root,'db/migrations'))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(join(root,'db/migrations',file),'utf8'));
    const sql=async(text:string,args:unknown[]=[])=>{const result=await db.query(text,args);return{rows:result.rows,rowCount:result.affectedRows??result.rows.length};};
    pool.query=sql as typeof pool.query;
    pool.connect=(async()=>({query:sql,release:()=>{}})) as typeof pool.connect;
    process.env.CREDENTIALS_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
    const secret=encryptSecret('synthetic-only');
    await db.query("INSERT INTO users(id,email,password_hash) VALUES ($1,'synthetic@example.invalid','test-only')",[userId]);
    await db.query("INSERT INTO sessions(id,user_id,remember,expires_at) VALUES ('test-session',$1,false,now()+interval '1 hour')",[userId]);
    await db.query('INSERT INTO carddav_accounts(id,user_id,carddav_url,username,password_encrypted,password_iv,password_auth_tag) VALUES ($1,$2,$3,$4,$5,$6,$7)',[accountId,userId,url,'synthetic',secret.ciphertext,secret.iv,secret.authTag]);
    const client=await getClientForAccount(accountId);
    const books=await client.fetchAddressBooks();assert.equal(books.length,2);
    const bookA=books.find((b:{url:string})=>b.url.endsWith('/a/')),bookB=books.find((b:{url:string})=>b.url.endsWith('/b/'));
    await client.createVCard({addressBook:bookA,filename:'arbitrary-name',vCardString:buildVCard({uid:'shared-uid',fn:'Synthetic',phones:[{label:'mobil',value:'+123'}]})});
    await client.createVCard({addressBook:bookB,filename:'other-name',vCardString:buildVCard({uid:'shared-uid',fn:'Different book'})});
    const sync=await runSync();assert.equal(sync.errors,0);assert.equal(sync.synced,2);
    const stored=(await db.query<{uid:string;addressbook_id:string;href:string;etag:string}>('SELECT * FROM contacts ORDER BY fn')).rows;
    assert.notEqual(stored[0].uid,stored[1].uid);
    const contact=stored.find(c=>c.href.endsWith('arbitrary-name'))!;
    const localBooks=(await db.query<{id:string;url:string}>('SELECT id,url FROM addressbooks')).rows;
    const app=express();app.use(express.json());app.use(cookieParser());app.use('/api/contacts',requireAuth,requireActive,contactsRouter);app.use('/api/operations',requireAuth,requireActive,operationsRouter);
    server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const call=(path:string,method='GET',body?:unknown,etag?:string)=>fetch(base+path,{method,headers:{Cookie:'frigg_sid=test-session','Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},body:body?JSON.stringify(body):undefined});
    assert.equal((await fetch(base+'/api/contacts')).status,401);
    const edit=await(await call(`/api/contacts/${contact.uid}/edit`)).json();assert.equal(edit.uid,contact.uid);
    const updated=await call(`/api/contacts/${contact.uid}`,'PUT',{note:'Web edit'},edit.etag);assert.equal(updated.status,200);
    const after=await updated.json();assert.notEqual(after.etag,edit.etag);
    const conflict=await call(`/api/contacts/${contact.uid}`,'PUT',{note:'Stale edit'},edit.etag);assert.equal(conflict.status,409);assert.equal((await conflict.json()).server.note,'Web edit');
    const external=await client.readVCard(contact.href);
    await client.updateVCard({vCard:{url:contact.href,etag:external.etag,data:patchDocument(external.raw,{org:'External client'})}});
    const unsynced=await call(`/api/contacts/${contact.uid}`,'PUT',{note:'Do not overwrite'},after.etag);assert.equal(unsynced.status,409);assert.equal((await unsynced.json()).server.org,'External client');
    await db.query("INSERT INTO users(id,email,password_hash) VALUES ('00000000-0000-0000-0000-000000000003','other@example.invalid','test-only');");
    await db.query("INSERT INTO sessions(id,user_id,remember,expires_at) VALUES ('other-session','00000000-0000-0000-0000-000000000003',false,now()+interval '1 hour')");
    assert.equal((await fetch(base+`/api/contacts/${contact.uid}/edit`,{headers:{Cookie:'frigg_sid=other-session'}})).status,404);
    const duplicate=await call('/api/contacts','POST',{addressbook_id:contact.addressbook_id,fn:'Synthetic',emails:[{label:'arbeit',value:'synthetic@example.invalid'}]});assert.equal(duplicate.status,201);const discard=await duplicate.json();
    await db.query("INSERT INTO contact_groups(id,owner_id,name) VALUES ('00000000-0000-0000-0000-000000000004',$1,'Keep membership')",[userId]);
    await db.query("INSERT INTO contact_group_members(group_id,contact_uid) VALUES ('00000000-0000-0000-0000-000000000004',$1)",[discard.uid]);
    const prepared=await call('/api/operations/preview','POST',{kind:'merge',source_uid:discard.uid,target_uid:contact.uid});assert.equal(prepared.status,201);const plan=await prepared.json();assert.equal(plan.unresolved,false);
    assert.equal((await fetch(base+`/api/operations/${plan.id}`,{headers:{Cookie:'frigg_sid=other-session'}})).status,404);
    const merged=await call(`/api/operations/${plan.id}/execute`,'POST');assert.equal(merged.status,200);const mergedContact=(await merged.json()).contact;assert.equal(mergedContact.phones.length,1);assert.equal(mergedContact.emails.length,1);assert.equal(mergedContact.org,'External client');
    assert.equal((await db.query('SELECT contact_uid FROM contact_group_members')).rows[0].contact_uid,contact.uid);
    assert.equal((await call(`/api/operations/${plan.id}/execute`,'POST')).status,200);
    const collision=await call('/api/operations/preview','POST',{kind:'move',source_uid:contact.uid,target_book_id:localBooks.find(b=>b.url===bookB.url)!.id});assert.equal(collision.status,409);
    const movable=await(await call('/api/contacts','POST',{addressbook_id:contact.addressbook_id,fn:'Move synthetic'})).json();
    const move=await(await call('/api/operations/preview','POST',{kind:'move',source_uid:movable.uid,target_book_id:localBooks.find(b=>b.url===bookB.url)!.id})).json();
    const moved=await call(`/api/operations/${move.id}/execute`,'POST');assert.equal(moved.status,200,await moved.clone().text());const final=(await moved.json()).contact;assert.equal(final.uid,movable.uid);assert.equal(final.addressbook_id,localBooks.find(b=>b.url===bookB.url)!.id);
    assert.equal((await call(`/api/contacts/${final.uid}`,'DELETE',undefined,final.etag)).status,204);
    assert.equal((await runSync()).errors,0);
  } finally {
    if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));}
    pool.query=originalQuery;pool.connect=originalConnect;
    if(oldKey===undefined)delete process.env.CREDENTIALS_ENCRYPTION_KEY;else process.env.CREDENTIALS_ENCRYPTION_KEY=oldKey;
    php.kill();await db.close();await rm(data,{recursive:true,force:true});
  }
});
