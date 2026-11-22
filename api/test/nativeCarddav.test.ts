import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withNativeCards,requireDavPrivilege} from '../src/carddav';
import {guardedDavFetch} from '../src/davSafety';
const raw='BEGIN:VCARD\r\nVERSION:4.0\r\nUID:test\r\nFN:Test\r\nKIND:group\r\nX-PRIVATE:unmodified\r\nEND:VCARD\r\n';
const book={url:'https://dav.invalid/book/'};
test('native fetch keeps vCard 4 data and ETag together without GET conversion',async()=>{
  const client=withNativeCards({
    propfind:async()=>[{ok:true,status:207,props:{addressData:raw,getetag:'"native"'}}],
    addressBookQuery:async()=>[{ok:true,status:207,href:'/book/group',raw:{multistatus:{}}}],
  });
  assert.deepEqual(await client.fetchVCards({addressBook:book}),[{url:book.url+'group',etag:'"native"',data:raw}]);
});
test('only an explicitly successful empty multistatus is an empty collection',async()=>{
  for(const response of [{ok:false,status:503,href:book.url},{ok:true,status:200,href:book.url,raw:'invalid xml'},{ok:true,status:207,href:book.url,raw:'broken multistatus'},{ok:false,status:404}]) {
    const client=withNativeCards({addressBookQuery:async()=>[response]});
    await assert.rejects(client.fetchVCards({addressBook:book}));
  }
  const client=withNativeCards({addressBookQuery:async()=>[{ok:true,status:207}]});
  assert.deepEqual(await client.fetchVCards({addressBook:book}),[]);
});
test('missing native representation, weak ETag and disappearing resources fail closed',async()=>{
  for(const response of [{ok:true,status:207,props:{getetag:'"a"'}},{ok:true,status:207,props:{addressData:raw,getetag:'W/"a"'}},{ok:false,status:404}]) {
    const client=withNativeCards({propfind:async()=>[response],addressBookQuery:async()=>[{ok:true,status:207,href:'/book/group',raw:{multistatus:{}}}]});
    await assert.rejects(client.fetchVCards({addressBook:book}));
  }
});
test('read errors cannot be collapsed into a successful empty sync',async()=>{
  for(const status of [401,403,409,412,500,503])await assert.rejects(guardedDavFetch(async()=>new Response(null,{status}))(book.url,{method:'REPORT'}));
});
test('Request instances cannot bypass conditional-write checks',async()=>{
  let sent=false;
  const fetch=guardedDavFetch(async()=>{sent=true;return new Response(null,{status:204});});
  await assert.rejects(fetch(new Request(book.url,{method:'DELETE'})),{status:428});
  assert.equal(sent,false);
  await fetch(new Request(book.url,{method:'DELETE',headers:{'If-Match':'"a"'}}));assert.equal(sent,true);
});

test('operation previews require explicit server write privileges',async()=>{
  for(const privilege of ['bind','unbind','writeContent'] as const) {
    const client=(entry:Record<string,unknown>)=>({propfind:async()=>[{ok:true,props:{currentUserPrivilegeSet:{privilege:entry}}}]});
    await requireDavPrivilege(client({[privilege]:{}}),book.url,privilege);
    await requireDavPrivilege(client({write:{}}),book.url,privilege);
    await assert.rejects(requireDavPrivilege(client({read:{}}),book.url,privilege),{status:403});
    await assert.rejects(requireDavPrivilege(client({}),book.url,privilege),{status:403});
  }
});
