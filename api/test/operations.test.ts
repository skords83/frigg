import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeOperation, type Operation, type Snapshot } from '../src/operationEngine';
import { mergePreview } from '../src/mergeVCard';
import { buildVCard } from '../src/contactOps';
import { projectDocument } from '../src/vcardDocument';
const sourceRaw=buildVCard({uid:'source',fn:'Name',phones:[{label:'privat',value:'+111'}],note:'source note'});
const targetRaw=buildVCard({uid:'target',fn:'Name',emails:[{label:'arbeit',value:'a@example.invalid'}]});
const snap=(id:string,raw:string):Snapshot=>({book:id,bookUrl:`https://dav.invalid/${id}/`,id,url:`https://dav.invalid/${id}/x.vcf`,uid:id,etag:`"${id}"`,raw});

test('merge combines multiple phones/emails/addresses and preserves opaque unique fields',()=>{
  const source=sourceRaw.replace('END:VCARD','X-UNIQUE:preserved\r\nEND:VCARD');
  const preview=mergePreview(targetRaw,source);
  assert.equal(preview.unresolved,false);
  const merged=projectDocument(preview.raw);
  assert.equal(merged.phones.length,1);assert.equal(merged.emails.length,1);
  assert.equal(merged.note,'source note');assert.ok(preview.raw.includes('X-UNIQUE:preserved'));
  assert.ok(preview.raw.includes('X-FRIGG-MERGED-UID:source'));
});
test('ambiguous unknown data blocks merge, scalar/photo differences require a choice',()=>{
  const a=targetRaw.replace('END:VCARD','X-PRIVATE:a\r\nEND:VCARD'),b=sourceRaw.replace('END:VCARD','X-PRIVATE:b\r\nEND:VCARD');
  assert.equal(mergePreview(a,b).rows.find(r=>r.property==='X-PRIVATE')?.blocked,true);
  const first=buildVCard({uid:'a',fn:'First',photo_data_uri:'data:image/jpeg;base64,YQ=='}),second=buildVCard({uid:'b',fn:'Second',photo_data_uri:'data:image/jpeg;base64,Yg=='});
  assert.equal(mergePreview(first,second).unresolved,true);
  const chosen=mergePreview(first,second,{FN:'a',PHOTO:'b'});
  assert.equal(chosen.unresolved,false);assert.equal(projectDocument(chosen.raw).photo_data_uri,'data:image/jpeg;base64,Yg==');
});

for(const kind of ['move','merge'] as const) {
  for(const failure of ['none','write-response','verify','delete-response','database','complete-checkpoint']) test(`${kind}: resume after ${failure} without another write or lost source`,async()=>{
    const source=snap('source',sourceRaw),target=snap('target',kind==='merge'?targetRaw:'');
    const result=kind==='merge'?mergePreview(targetRaw,sourceRaw).raw:sourceRaw;
    const operation:Operation={id:'test',kind,status:'prepared',target_etag:null,plan:{source,target,result}};
    let sourceState:{raw:string;etag:string}|null={raw:sourceRaw,etag:source.etag};
    let targetState:{raw:string;etag:string}|null=kind==='merge'?{raw:targetRaw,etag:target.etag}:null;
    let failed=false,writes=0,deletes=0,commits=0;
    const once=(point:string)=>{if(failure===point&&!failed){failed=true;throw new Error('simulated');}};
    const io={
      read:async(s:Snapshot)=>{if(s.id==='target'&&writes)once('verify');return s.id==='source'?sourceState:targetState;},
      write:async()=>{writes++;targetState={raw:result,etag:'"written"'};once('write-response');},
      remove:async()=>{assert.ok(targetState);assert.equal(targetState.raw,result);deletes++;sourceState=null;once('delete-response');},
      checkpoint:async(status:Operation['status'],etag?:string)=>{if(status==='complete')once('complete-checkpoint');operation.status=status;if(etag)operation.target_etag=etag;},
      commit:async()=>{once('database');commits++;},
    };
    if(failure!=='none') {await assert.rejects(executeOperation(operation,io));assert.ok(sourceState||targetState);}
    await executeOperation(operation,io);
    assert.equal(operation.status,'complete');assert.equal(writes,1);assert.equal(deletes,1);assert.equal(sourceState,null);
    const committed=commits;await executeOperation(operation,io);assert.equal(commits,committed);
  });
}
test('changed source blocks before target mutation; cancellation writes nothing',async()=>{
  const source=snap('source',sourceRaw),target=snap('target','');
  let writes=0;
  const op:Operation={id:'test',kind:'move',status:'prepared',target_etag:null,plan:{source,target,result:sourceRaw}};
  const io={read:async()=>({raw:sourceRaw,etag:'"other"'}),write:async()=>{writes++;},remove:async()=>{throw new Error('must not delete');},checkpoint:async()=>{},commit:async()=>{}};
  await assert.rejects(executeOperation(op,io),{message:'source_changed'});
  op.status='cancelled';await assert.rejects(executeOperation(op,io),{message:'operation_cancelled'});
  assert.equal(writes,0);
});
