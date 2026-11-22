import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { Client } from 'pg';

type Message = {event:string;[key:string]:any};
async function worker(root: string) {
  const child=fork(join(root,'api/test/nativePostgresWorker.ts'),[],{execArgv:['--import','tsx'],env:{...process.env},stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr!.on('data',c=>stderr+=c);
  const messages: Message[]=[];child.on('message',(m:Message)=>messages.push(m));
  async function wait(event:string):Promise<Message>{
    const end=Date.now()+10_000;
    while(Date.now()<end){const index=messages.findIndex(m=>m.event===event);if(index>=0)return messages.splice(index,1)[0];if(child.exitCode!==null||child.signalCode)throw new Error(`worker exited: ${stderr}`);await new Promise(r=>setTimeout(r,10));}
    throw new Error(`worker timeout: ${event} ${stderr}`);
  }
  const {port}=await wait('ready');
  return {child,messages,wait,
    async gate(point:string){child.send({action:'gate',point});await wait('armed');},
    release(){child.send({action:'release'});},
    call(path:string,method='GET',body?:unknown,etag?:string){return fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Cookie:'frigg_sid=test-session','Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},body:body?JSON.stringify(body):undefined});},
    async sync(){child.send({action:'sync'});return (await wait('sync')).result;},
    async stop(){if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}},
  };
}

export async function nativeConcurrency({root,call,db,client,bookA,bookB,data}:any) {
  const workers:Awaited<ReturnType<typeof worker>>[]=[];
  const start=async()=>{const w=await worker(root);workers.push(w);return w;};
  const row=async(id:string)=>(await db.query('SELECT * FROM contact_operations WHERE id=$1',[id])).rows[0];
  const create=async(name:string)=>{const response=await call('/api/contacts','POST',{addressbook_id:bookA,fn:name});assert.equal(response.status,201);return response.json();};
  const prepare=async(source:any,kind='move',target?:any)=>{const response=await call('/api/operations/preview','POST',{kind,source_uid:source.uid,...(target?{target_uid:target.uid}:{target_book_id:bookB})});assert.equal(response.status,201,await response.clone().text());return response.json();};
  const execute=(w:any,id:string)=>w.call(`/api/operations/${id}/execute`,'POST');
  const check=async(id:string)=>{
    const op=await row(id);assert.equal(op.status,'complete');assert.equal(op.last_error,null);
    assert.equal(await client.readVCard(op.plan.source.url),null);
    const target=await client.readVCard(op.plan.target.url);assert.ok(target);assert.equal(target.raw.replace(/\r?\n$/, ''),op.plan.result.replace(/\r?\n$/, ''));
    const contacts=(await db.query('SELECT * FROM contacts WHERE uid=ANY($1)',[[op.source_uid,op.target_uid]])).rows;
    assert.equal(contacts.length,1);assert.equal(contacts[0].uid,op.target_uid);assert.equal(contacts[0].etag,target.etag);
  };
  try {
    const a=await start(),b=await start();
    const c=await create('Parallel synthetic');
    await a.gate('PUT');const first=a.call(`/api/contacts/${c.uid}`,'PUT',{note:'winner'},c.etag);await a.wait('paused');
    const contender=await b.call(`/api/contacts/${c.uid}`,'PUT',{note:'loser'},c.etag);assert.equal(contender.status,423);assert.equal((await contender.json()).error,'operation_busy');
    assert.deepEqual(await b.sync(),{synced:0,errors:0});
    a.release();assert.equal((await first).status,200);
    assert.equal((await b.call(`/api/contacts/${c.uid}`,'PUT',{note:'loser'},c.etag)).status,409);
    assert.equal((await db.query('SELECT note FROM contacts WHERE uid=$1',[c.uid])).rows[0].note,'winner');
    console.log('POSTGRES PASS: two API processes / concurrent sync and contact edit / stale ETag');

    const move=await prepare(await create('Concurrent move'));
    await a.gate('target-written');const moving=execute(a,move.id);await a.wait('paused');
    assert.equal((await execute(b,move.id)).status,423);
    assert.deepEqual(await b.sync(),{synced:0,errors:0});
    a.release();assert.equal((await moving).status,200);await check(move.id);
    const before=b.messages.filter(m=>m.event==='dav').length;
    assert.equal((await execute(b,move.id)).status,200);assert.equal(b.messages.filter(m=>m.event==='dav').length,before);
    console.log('POSTGRES PASS: simultaneous move resume / idempotency / no second DAV write or delete');

    const target=await create('Merge concurrency'),source=await create('Merge concurrency');
    const merge=await prepare(source,'merge',target);
    await b.gate('PROPFIND');const syncing=b.sync();await b.wait('paused');
    assert.equal((await execute(a,merge.id)).status,423);b.release();const pendingSync=await syncing;assert.ok(pendingSync.errors>0);
    assert.equal((await execute(a,merge.id)).status,200);await check(merge.id);
    console.log('POSTGRES PASS: merge during independent sync / pending journal protects books');

    for(const failure of ['SIGKILL','lock-connection','database-query','after-delete','after-commit']) {
      const w=await start(),op=await prepare(await create(`Recovery ${failure}`));
      await w.gate(failure==='database-query'?'database-break':failure==='after-delete'?'checkpoint-source_deleted':failure==='after-commit'?'checkpoint-complete':'target-written');
      const running=execute(w,op.id).then((r:any)=>r.status,()=>0);
      if(failure==='database-query') {
        let pid=0;
        for(let i=0;i<500&&!pid;i++){const result=await db.query("SELECT pid FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(30)%' AND state='active'");pid=result.rows[0]?.pid; if(!pid)await new Promise(r=>setTimeout(r,10));}
        assert.ok(pid);await db.query('SELECT pg_terminate_backend($1)',[pid]);assert.equal(await running,503);
        assert.equal((await row(op.id)).last_error,'operation_unconfirmed');
      } else {
        await w.wait('paused');
        if(['SIGKILL','after-delete','after-commit'].includes(failure))await w.stop();
        else {
          const held=await db.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=186702 AND objid=1 AND granted");assert.equal(held.rows.length,1);
          const exited=once(w.child,'exit');await db.query('SELECT pg_terminate_backend($1)',[held.rows[0].pid]);await exited;
          assert.notEqual(w.child.exitCode,0); // pg's unhandled checked-out-client error is fail-stop.
        }
        await running;
      }
      assert.equal((await row(op.id)).status,failure==='after-delete'?'target_verified':failure==='after-commit'?'source_deleted':'writing');
      assert.ok((await b.sync()).errors>0);
      const recovery=await start();assert.equal((await execute(recovery,op.id)).status,200);await check(op.id);
      assert.equal(recovery.messages.filter(m=>m.event==='dav'&&m.method==='PUT').length,0);
      assert.equal(recovery.messages.filter(m=>m.event==='dav'&&m.method==='DELETE'&&m.status>=200&&m.status<300).length,['after-delete','after-commit'].includes(failure)?0:1);
      assert.equal((await execute(recovery,op.id)).status,200);
      console.log(`POSTGRES PASS: ${failure} / lock release / new-process recovery / persistent journal`);
    }

    // Native PostgreSQL timeout and deadlock detection using independent sessions.
    const x=new Client(),y=new Client();await x.connect();await y.connect();
    try {
      await x.query('BEGIN');await x.query('SELECT pg_advisory_xact_lock(700001)');
      await y.query("SET lock_timeout='100ms'");await assert.rejects(y.query('SELECT pg_advisory_lock(700001)'),(e:any)=>e.code==='55P03');await x.query('ROLLBACK');
      await y.query("SET lock_timeout='3s'");await x.query('BEGIN');await y.query('BEGIN');
      await x.query('SELECT pg_advisory_xact_lock(700001)');await y.query('SELECT pg_advisory_xact_lock(700002)');
      const results=await Promise.allSettled([x.query('SELECT pg_advisory_xact_lock(700002)').catch(async e=>{await x.query('ROLLBACK');throw e;}),y.query('SELECT pg_advisory_xact_lock(700001)').catch(async e=>{await y.query('ROLLBACK');throw e;})]);
      assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='40P01').length,1);
      await x.query('ROLLBACK');await y.query('ROLLBACK');
    } finally {await x.end();await y.end();}
    assert.equal((await db.query("SELECT * FROM pg_locks WHERE locktype='advisory' AND classid=186702 AND objid=1")).rows.length,0);
    console.log('POSTGRES PASS: lock timeout / detected deadlock / no leaked application lock');
    for(const w of workers)await w.stop();
    const journals=(await db.query('SELECT * FROM contact_operations ORDER BY id')).rows;
    execFileSync(join(process.env.FRIGG_TEST_PG_BIN!,'pg_ctl'),['-D',join(process.env.FRIGG_NATIVE_PG!,'data'),'-l',join(process.env.FRIGG_NATIVE_PG!,'server.log'),'-m','fast','-w','restart'],{stdio:'pipe'});
    // A server restart invalidates existing pooled sockets. Let pg process their close events.
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.deepEqual((await db.query('SELECT * FROM contact_operations ORDER BY id')).rows,journals);
    console.log('POSTGRES PASS: server restart preserves complete journal');
    await migrationRestore(root,db,data);
  } finally {for(const w of workers)await w.stop();}
}

async function migrationRestore(root:string,db:any,data:string) {
  const bin=process.env.FRIGG_TEST_PG_BIN!;
  const run=(command:string,args:string[])=>execFileSync(join(bin,command),args,{stdio:'pipe'});
  const dump=join(process.env.FRIGG_NATIVE_PG!,'post-migration.dump');
  run('pg_dump',['-Fc','-f',dump]);run('createdb',['frigg_restore']);run('pg_restore',['--exit-on-error','-d','frigg_restore',dump]);
  const restored=new Client({database:'frigg_restore'});await restored.connect();
  try {
    for(const table of ['contacts','contact_groups','contact_group_members','contact_operations','addressbooks']) {
      const sql=`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`;
      assert.deepEqual((await restored.query(sql)).rows,(await db.query(sql)).rows);
    }
    for(const file of ['005_contact_identity_operations.sql','006_carddav_groups.sql'])await restored.query(await readFile(join(root,'db/migrations',file),'utf8'));
    assert.deepEqual((await restored.query('SELECT uid,vcard_uid,resource_kind FROM contacts ORDER BY uid')).rows,(await db.query('SELECT uid,vcard_uid,resource_kind FROM contacts ORDER BY uid')).rows);
  } finally {await restored.end();}
  // A separate legacy database exercises actual backup, forward migration and restore.
  run('createdb',['frigg_legacy']);const legacy=new Client({database:'frigg_legacy'});await legacy.connect();
  try {
    const files=(await readdir(join(root,'db/migrations'))).filter(f=>f.endsWith('.sql')).sort();
    for(const file of files.slice(0,4))await legacy.query(await readFile(join(root,'db/migrations',file),'utf8'));
    await legacy.query(`INSERT INTO addressbooks(id,display_name,url) VALUES ('a','Synthetic','https://synthetic.invalid/a'),('b','B','https://synthetic.invalid/b');
      INSERT INTO contacts(uid,addressbook_id,raw_vcard) VALUES ('legacy','a','BEGIN:VCARD\r\nVERSION:3.0\r\nUID:legacy\r\nFN:Synthetic\r\nEND:VCARD');
      INSERT INTO users(id,email,password_hash) VALUES ('00000000-0000-0000-0000-000000000001','legacy@example.invalid','test');
      INSERT INTO contact_groups(id,owner_id,name) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Local');
      INSERT INTO contact_group_members(group_id,contact_uid) VALUES ('00000000-0000-0000-0000-000000000002','legacy');`);
    const before=(await legacy.query('SELECT * FROM contacts')).rows;
    const backup=join(process.env.FRIGG_NATIVE_PG!,'legacy.dump');run('pg_dump',['-d','frigg_legacy','-Fc','-f',backup]);
    for(let i=0;i<2;i++)for(const file of files.slice(4))await legacy.query(await readFile(join(root,'db/migrations',file),'utf8'));
    assert.equal((await legacy.query('SELECT uid,vcard_uid FROM contacts')).rows[0].vcard_uid,'legacy');
    assert.equal((await legacy.query('SELECT contact_uid FROM contact_group_members')).rows[0].contact_uid,'legacy');
    await legacy.query("INSERT INTO contacts(uid,vcard_uid,addressbook_id) VALUES ('new','legacy','b')");
    await assert.rejects(legacy.query("INSERT INTO contacts(uid,vcard_uid,addressbook_id) VALUES ('collision','legacy','a')"),(e:any)=>e.code==='23505');
    run('createdb',['frigg_rollback']);run('pg_restore',['--exit-on-error','-d','frigg_rollback',backup]);
    const rollback=new Client({database:'frigg_rollback'});await rollback.connect();
    try {assert.deepEqual((await rollback.query('SELECT * FROM contacts')).rows,before);assert.equal((await rollback.query('SELECT contact_uid FROM contact_group_members')).rows[0].contact_uid,'legacy');}finally{await rollback.end();}
    // Quiescent synthetic Baikal backup and SQLite integrity/content verification.
    execFileSync('python3',['-c',`import sqlite3,sys
s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d)
assert d.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert s.execute('SELECT * FROM cards ORDER BY id').fetchall()==d.execute('SELECT * FROM cards ORDER BY id').fetchall()
d.close(); s.close()`,join(data,'db.sqlite'),join(process.env.FRIGG_NATIVE_PG!,'baikal-backup.sqlite')]);
    console.log('POSTGRES PASS: native 005/006 repeatability / legacy IDs and memberships / scoped UIDs / pg_dump + pg_restore / exact journal restore / Baikal SQLite backup');
  } finally {await legacy.end();}
}
