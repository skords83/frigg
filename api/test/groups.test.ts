import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGroup,readGroup,patchGroup,memberReference} from '../src/groupCard';
const uid='00000000-0000-4000-8000-000000000001';
for(const format of ['vcard4','apple'] as const) {
  test(`${format}: group create, rename, members and unknown properties round-trip`,()=>{
    const raw=buildGroup('group-id','Gruppe; Änne',format).replace('END:VCARD','X-PRIVATE;X-P="x:y":preserved\r\nEND:VCARD');
    assert.equal(readGroup(raw)?.format,format);
    const added=patchGroup(raw,{add:memberReference(uid)});
    assert.deepEqual(readGroup(added)?.members,[`urn:uuid:${uid}`]);
    assert.equal(patchGroup(added,{add:memberReference(uid)}),added);
    const renamed=patchGroup(added,{name:'Neuer Name'});assert.equal(readGroup(renamed)?.name,'Neuer Name');
    assert.ok(renamed.includes('X-PRIVATE;X-P="x:y":preserved'));
    const removed=patchGroup(renamed,{remove:memberReference(uid)});assert.deepEqual(readGroup(removed)?.members,[]);
  });
  test(`${format}: removing a member removes its duplicates but preserves dangling references`,()=>{
    const prop=format==='vcard4'?'MEMBER':'X-ADDRESSBOOKSERVER-MEMBER';
    const raw=buildGroup('group-id','Name',format).replace('END:VCARD',`${prop}:urn:uuid:${uid}\r\n${prop}:urn:uuid:${uid}\r\n${prop}:mailto:missing@example.invalid\r\nEND:VCARD`);
    const next=patchGroup(raw,{remove:memberReference(uid)});
    assert.deepEqual(readGroup(next)?.members,['mailto:missing@example.invalid']);
  });
}
test('mixed/unknown formats are read but never rewritten',()=>{
  const raw=buildGroup('id','Name','vcard4').replace('END:VCARD','X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:unknown\r\nEND:VCARD');
  assert.equal(readGroup(raw)?.format,'unknown');
  assert.throws(()=>patchGroup(raw,{name:'Changed'}),{message:'unsupported_group_format'});
  assert.throws(()=>memberReference('not-a-uri-or-uuid'),{message:'unsupported_member_uid'});
});
