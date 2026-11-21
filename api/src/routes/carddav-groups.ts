import {Router,Response} from 'express';
import type {AuthedRequest} from '../auth/middleware';
import {canAccessAddressbook} from '../auth/access';
import {query,pool} from '../db';
import type {ContactRow} from '../types';
import {withDavLock} from '../davLock';
import {DavError,requireEtag} from '../davSafety';
import {readRemoteContact} from '../remoteContact';
import {buildGroup,patchGroup,memberReference,readGroup} from '../groupCard';
import {groupView,supportedGroupFormats} from '../carddavGroups';
import {createContact} from '../contactOps';
import {projectDocument} from '../vcardDocument';
import {equivalentCard} from '../operationEngine';
const router=Router();
function fail(res:Response,err:unknown){return res.status(err instanceof DavError?err.status:503).json({error:err instanceof DavError?err.code:'group_unavailable'});}
async function current(req:AuthedRequest) {
  const id=req.params.id.replace(/^dav:/,'');
  const [stored]=await query<ContactRow>("SELECT * FROM contacts WHERE uid=$1 AND resource_kind='group'",[id]);
  if(!stored||!(await canAccessAddressbook(req.user!.id,stored.addressbook_id)))throw new DavError(404,'not_found');
  if((await query("SELECT 1 FROM contact_operations WHERE status NOT IN ('complete','cancelled') AND (plan->'source'->>'book'=$1 OR plan->'target'->>'book'=$1)",[stored.addressbook_id])).length)throw new DavError(409,'operation_pending');
  const remote=await readRemoteContact(stored);
  if(remote.contact.etag!==stored.etag)await pool.query('UPDATE contacts SET etag=$1,raw_vcard=$2,fn=$3,updated_at=now() WHERE uid=$4 AND etag=$5',[remote.contact.etag,remote.contact.raw_vcard,remote.contact.fn,stored.uid,stored.etag]);
  return remote;
}
router.get('/capabilities',async(req:AuthedRequest,res)=>{
  try {
    const id=req.query.addressbook_id;
    if(typeof id!=='string'||!(await canAccessAddressbook(req.user!.id,id)))throw new DavError(404,'not_found');
    res.json({formats:await supportedGroupFormats(id)});
  }catch(err){fail(res,err);}
});
router.post('/',withDavLock(async(req,res)=>{
  try {
    const {addressbook_id,name,format}=req.body;
    if(typeof name!=='string'||!name.trim()||!['vcard4','apple'].includes(format)||typeof addressbook_id!=='string')throw new DavError(400,'invalid_group');
    if(!(await canAccessAddressbook(req.user!.id,addressbook_id)))throw new DavError(403,'forbidden');
    if(!(await supportedGroupFormats(addressbook_id)).includes(format))throw new DavError(422,'unsupported_group_format');
    const created=await createContact(addressbook_id,{},buildGroup(crypto.randomUUID(),name.trim(),format));
    res.status(201).json(await groupView(created));
  }catch(err){fail(res,err);}
}));
router.get('/:id',async(req:AuthedRequest,res)=>{
  try {res.json(await groupView((await current(req)).contact));}catch(err){fail(res,err);}
});
async function mutate(req:AuthedRequest,res:Response,action:'rename'|'add'|'remove'|'delete') {
  try {
    requireEtag(req.headers['if-match']);
    const remote=await current(req), group=readGroup(remote.contact.raw_vcard);
    if(!group||group.format==='unknown')throw new DavError(422,'unsupported_group_format');
    if(req.headers['if-match']!==remote.contact.etag)return res.status(409).json({error:'conflict',server:await groupView(remote.contact)});
    if(action==='delete') {
      await remote.client.deleteVCard({vCard:{url:remote.url,etag:remote.contact.etag}});
      await pool.query('DELETE FROM contacts WHERE uid=$1',[remote.contact.uid]);return res.status(204).end();
    }
    let change:{name?:string;add?:string;remove?:string};
    if(action==='rename') {
      if(typeof req.body.name!=='string'||!req.body.name.trim())throw new DavError(400,'invalid_name');
      change={name:req.body.name.trim()};
    } else {
      const id=action==='add'?req.body.contact_uid:req.params.contact_uid;
      const [contact]=await query<ContactRow>("SELECT * FROM contacts WHERE uid=$1 AND addressbook_id=$2 AND resource_kind='contact'",[id,remote.contact.addressbook_id]);
      if(!contact)throw new DavError(404,'member_not_found');
      // Require a live member resource; a stale local row must not create a dangling ref.
      await readRemoteContact(contact);
      const reference=memberReference(contact.vcard_uid);
      change=action==='add'?{add:reference}:{remove:reference};
    }
    const raw=patchGroup(remote.contact.raw_vcard,change);
    if(raw===remote.contact.raw_vcard)return res.json(await groupView(remote.contact));
    await remote.client.updateVCard({vCard:{url:remote.url,etag:remote.contact.etag,data:raw}});
    const verified=await remote.client.readVCard(remote.url);
    if(!verified||!equivalentCard(verified.raw,raw))throw new DavError(409,'group_verification_failed');
    const parsed=projectDocument(verified.raw);
    await pool.query('UPDATE contacts SET raw_vcard=$1,etag=$2,fn=$3,updated_at=now() WHERE uid=$4',[verified.raw,verified.etag,parsed.fn,remote.contact.uid]);
    res.json(await groupView({...remote.contact,raw_vcard:verified.raw,etag:verified.etag,fn:parsed.fn}));
  }catch(err){fail(res,err);}
}
router.patch('/:id',withDavLock((req,res)=>mutate(req,res,'rename')));
router.delete('/:id',withDavLock((req,res)=>mutate(req,res,'delete')));
router.post('/:id/members',withDavLock((req,res)=>mutate(req,res,'add')));
router.delete('/:id/members/:contact_uid',withDavLock((req,res)=>mutate(req,res,'remove')));
export default router;
