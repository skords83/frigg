import { createServer } from 'node:http';
export const contact = { uid: 'synthetic', addressbook_id: 'test-book', etag: '"base"', fn: 'Anne Testperson', given_name: 'Anne', family_name: 'Testperson', org: 'Testfirma', title: null, birthday: '--0229', note: 'Ursprünglich', has_photo: false, photo_data_uri: null, phones: [], emails: [], addresses: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
createServer((req,res) => {
  res.setHeader('Content-Type','application/json');
  if (req.url === '/healthz') return res.end('{}');
  if (req.url === '/api/auth/me') return res.end(JSON.stringify({ user: { id:'test-user', email:'synthetic@example.invalid', role:'user', mustChangePassword:false } }));
  if (req.url === '/api/contacts') return res.end(JSON.stringify(req.headers.cookie?.includes('duplicates=yes')?[contact,{...contact,uid:'synthetic-duplicate',fn:'Anne Testperson (zweiter Eintrag)',note:'Zusätzliche Notiz'}]:[contact]));
  if (req.url === '/api/addressbooks') return res.end(JSON.stringify([{ id:'test-book', display_name:'Synthetisch', url:'https://dav.invalid/book/', contact_count:1, is_owner:true }, ...(req.headers.cookie?.includes('two-books=yes')?[{id:'second-book',display_name:'Zweites Buch',url:'https://dav.invalid/second/',contact_count:0,is_owner:true}]:[])]));
  if (req.url === '/api/operations') return res.end('[]');
  if (req.url === '/api/groups') return res.end('[]');
  if (req.url === '/api/contacts/synthetic/edit') return res.end(JSON.stringify(contact));
  res.writeHead(404).end('{}');
}).listen(4311,'127.0.0.1');
