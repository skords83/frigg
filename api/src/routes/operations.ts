import { Router, Response } from 'express';
import { query, pool } from '../db';
import type { AuthedRequest } from '../auth/middleware';
import { canAccessAddressbook } from '../auth/access';
import type { ContactRow } from '../types';
import { readRemoteContact, publicEditContact } from '../remoteContact';
import { getClientForAddressbook } from '../carddav';
import { DavError, requireEtag } from '../davSafety';
import { projectDocument, readDocument } from '../vcardDocument';
import { mergePreview, type MergeChoices } from '../mergeVCard';
import { executeOperation, type Operation, type OperationPlan, type Snapshot } from '../operationEngine';
import { withDavLock } from '../davLock';

const router = Router();
interface StoredOperation extends Operation { owner_id: string; last_error: string | null; plan: OperationPlan & { choices?: MergeChoices } }
async function authorizedContact(userId: string, id: string): Promise<ContactRow> {
  const [contact] = await query<ContactRow>("SELECT * FROM contacts WHERE uid=$1 AND resource_kind='contact'",[id]);
  if (!contact || !(await canAccessAddressbook(userId,contact.addressbook_id))) throw new DavError(404,'not_found');
  return contact;
}
async function snapshot(contact: ContactRow): Promise<Snapshot> {
  const remote = await readRemoteContact(contact);
  const [book] = await query<{url:string}>('SELECT url FROM addressbooks WHERE id=$1',[contact.addressbook_id]);
  return { book:contact.addressbook_id, bookUrl:book.url, id:contact.uid, uid:remote.contact.vcard_uid, url:remote.url, etag:remote.contact.etag, raw:remote.contact.raw_vcard };
}
async function assertUnreferenced(source: Snapshot) {
  const client = await getClientForAddressbook(source.book);
  const cards = await client.fetchVCards({addressBook:{url:source.bookUrl},urlFilter:()=>true});
  for (const card of cards) {
    if (!card.url) throw new DavError(409,'membership_check_failed');
    const native = await client.readVCard(new URL(card.url,source.bookUrl).href);
    if (!native) throw new DavError(409,'membership_check_failed');
    if (readDocument(native.raw).some(l=>['MEMBER','X-ADDRESSBOOKSERVER-MEMBER','RELATED'].includes(l.name) && [source.uid,`urn:uuid:${source.uid}`].includes(l.value))) throw new DavError(409,'contact_is_referenced');
  }
}
async function operationFor(req: AuthedRequest): Promise<StoredOperation> {
  const [op] = await query<StoredOperation>('SELECT * FROM contact_operations WHERE id=$1 AND owner_id=$2',[req.params.id,req.user!.id]);
  if (!op) throw new DavError(404,'not_found');
  for (const book of [op.plan.source.book,op.plan.target.book]) if (!(await canAccessAddressbook(req.user!.id,book))) throw new DavError(403,'forbidden');
  return op;
}
function preview(op: StoredOperation) {
  const merged = op.kind==='merge' ? mergePreview(op.plan.target.raw,op.plan.source.raw,op.plan.choices) : null;
  return { id:op.id, kind:op.kind, status:op.status, rows:merged?.rows ?? [], unresolved:merged?.unresolved ?? false,
    source:projectDocument(op.plan.source.raw), target:op.plan.target.raw ? projectDocument(op.plan.target.raw) : null,
    result:projectDocument(op.plan.result), last_error:op.last_error };
}
function fail(res: Response, err: unknown) {
  if (err instanceof DavError) return res.status(err.status).json({error:err.code});
  if ((err as {code?:string})?.code==='23505') return res.status(409).json({error:'operation_pending'});
  return res.status(503).json({error:'operation_unconfirmed'});
}

router.get('/', async (req: AuthedRequest,res) => {
  try {
    const operations = await query<StoredOperation>("SELECT * FROM contact_operations WHERE owner_id=$1 AND status NOT IN ('complete','cancelled') ORDER BY created_at",[req.user!.id]);
    const visible = [];
    for (const op of operations) if (await canAccessAddressbook(req.user!.id,op.plan.source.book) && await canAccessAddressbook(req.user!.id,op.plan.target.book)) {
      visible.push({id:op.id, kind:op.kind, status:op.status, name:projectDocument(op.plan.source.raw).fn, last_error:op.last_error});
    }
    res.json(visible);
  } catch(err) { fail(res,err); }
});

router.post('/preview', withDavLock(async (req,res) => {
  try {
    if (!['move','merge'].includes(req.body.kind) || typeof req.body.source_uid!=='string') throw new DavError(400,'invalid_operation');
    const source = await snapshot(await authorizedContact(req.user!.id,req.body.source_uid));
    let target: Snapshot, result: string;
    if (req.body.kind==='move') {
      const bookId = req.body.target_book_id;
      if (typeof bookId!=='string' || source.book===bookId || !(await canAccessAddressbook(req.user!.id,bookId))) throw new DavError(403,'invalid_target');
      const [book] = await query<{url:string}>('SELECT url FROM addressbooks WHERE id=$1',[bookId]);
      const cards = await (await getClientForAddressbook(bookId)).fetchVCards({addressBook:{url:book.url},urlFilter:()=>true});
      for (const card of cards) if (!card.data || projectDocument(card.data).uid===source.uid) throw new DavError(409,'target_exists');
      target = { book:bookId,bookUrl:book.url,id:source.id,url:new URL(`${encodeURIComponent(source.uid)}.vcf`,book.url).href,uid:source.uid,etag:'',raw:'' };
      result=source.raw;
    } else {
      if (typeof req.body.target_uid!=='string' || req.body.target_uid===source.id) throw new DavError(400,'invalid_target');
      target=await snapshot(await authorizedContact(req.user!.id,req.body.target_uid));
      // Preserve existing remote memberships: moving a UID to another book or deleting
      // a referenced duplicate needs a separate explicit membership operation.
      result=mergePreview(target.raw,source.raw).raw;
    }
    await assertUnreferenced(source);
    const plan = {source,target,result};
    const [op] = await query<StoredOperation>('INSERT INTO contact_operations(owner_id,kind,source_uid,target_uid,plan) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *',[req.user!.id,req.body.kind,source.id,target.id,JSON.stringify(plan)]);
    res.status(201).json(preview(op));
  } catch(err) { fail(res,err); }
}));

router.get('/:id', async (req:AuthedRequest,res) => {
  try { res.json(preview(await operationFor(req))); } catch(err) { fail(res,err); }
});
router.patch('/:id/preview',withDavLock(async(req,res)=>{
  try {
    const op=await operationFor(req);
    if(op.status!=='prepared' || op.kind!=='merge') throw new DavError(409,'operation_started');
    const choices = req.body.choices as MergeChoices;
    if(!choices || typeof choices!=='object' || Object.values(choices).some(v=>!['a','b'].includes(v))) throw new DavError(400,'invalid_choices');
    const merged=mergePreview(op.plan.target.raw,op.plan.source.raw,choices);
    op.plan={...op.plan,result:merged.raw,choices};
    await pool.query('UPDATE contact_operations SET plan=$1::jsonb,updated_at=now() WHERE id=$2',[JSON.stringify(op.plan),op.id]);
    res.json(preview(op));
  } catch(err) { fail(res,err); }
}));
router.post('/:id/cancel',withDavLock(async(req,res)=>{
  try {
    const op=await operationFor(req);
    if(!['prepared','writing','target_verified'].includes(op.status)) throw new DavError(409,'operation_started');
    if(op.status!=='prepared') await readRemoteContact(await authorizedContact(req.user!.id,op.plan.source.id));
    await pool.query("UPDATE contact_operations SET status='cancelled',updated_at=now() WHERE id=$1",[op.id]);
    res.status(204).end();
  } catch(err) { fail(res,err); }
}));

router.post('/:id/execute',withDavLock(async(req,res)=>{
  let op:StoredOperation | undefined;
  try {
    op=await operationFor(req);
    if(op.kind==='merge' && mergePreview(op.plan.target.raw,op.plan.source.raw,op.plan.choices).unresolved) throw new DavError(409,'merge_decisions_required');
    const operation=op;
    await executeOperation(op,{
      read:async snap=> (await getClientForAddressbook(snap.book)).readVCard(snap.url),
      write:async(snap,raw,create)=>{
        const client=await getClientForAddressbook(snap.book);
        if(create) await client.createVCard({addressBook:{url:snap.bookUrl},filename:snap.url.slice(snap.bookUrl.length),vCardString:raw});
        else await client.updateVCard({vCard:{url:snap.url,etag:snap.etag,data:raw}});
      },
      remove:async snap=>{ await assertUnreferenced(snap); await(await getClientForAddressbook(snap.book)).deleteVCard({vCard:{url:snap.url,etag:snap.etag}}); },
      checkpoint:async(status,etag)=>{ await pool.query('UPDATE contact_operations SET status=$1,target_etag=COALESCE($2,target_etag),last_error=NULL,updated_at=now() WHERE id=$3',[status,etag??null,operation.id]); },
      commit:async()=>{
        const db=await pool.connect();
        try {
          await db.query('BEGIN');
          const parsed=projectDocument(operation.plan.result), target=operation.plan.target;
          const saved=await db.query(`UPDATE contacts SET addressbook_id=$1,href=$2,etag=$3,raw_vcard=$4,
            fn=$5,given_name=$6,family_name=$7,org=$8,title=$9,birthday=$10,note=$11,
            phones=$12::jsonb,emails=$13::jsonb,addresses=$14::jsonb,photo_data_uri=$15,updated_at=now() WHERE uid=$16`,
            [target.book,target.url,operation.target_etag,operation.plan.result,parsed.fn,parsed.given_name,parsed.family_name,parsed.org,parsed.title,parsed.birthday,parsed.note,JSON.stringify(parsed.phones),JSON.stringify(parsed.emails),JSON.stringify(parsed.addresses),parsed.photo_data_uri,target.id]);
          if(saved.rowCount!==1) throw new DavError(409,'local_target_missing');
          if(operation.kind==='merge') {
            await db.query('INSERT INTO contact_group_members(group_id,contact_uid) SELECT group_id,$1 FROM contact_group_members WHERE contact_uid=$2 ON CONFLICT DO NOTHING',[target.id,operation.plan.source.id]);
            await db.query('DELETE FROM contacts WHERE uid=$1',[operation.plan.source.id]);
          }
          await db.query('COMMIT');
        } catch(err) { await db.query('ROLLBACK'); throw err; } finally { db.release(); }
      },
    });
    const [updated]=await query<ContactRow>('SELECT * FROM contacts WHERE uid=$1',[op.plan.target.id]);
    res.json({status:'complete',contact:updated ? publicEditContact(updated) : null});
  } catch(err) {
    if(op) await pool.query('UPDATE contact_operations SET last_error=$1,updated_at=now() WHERE id=$2',[err instanceof DavError ? err.code : 'operation_unconfirmed',op.id]).catch(()=>{});
    fail(res,err);
  }
}));
export default router;
