import {query} from './db';
import {getClientForAddressbook} from './carddav';
import {getVisibleAddressbookIds} from './auth/access';
import {readGroup,memberUid,type GroupFormat} from './groupCard';
import type {ContactRow} from './types';
import {DavError} from './davSafety';
export async function groupView(contact:ContactRow) {
  const group=readGroup(contact.raw_vcard);
  if(!group)throw new DavError(422,'not_a_group');
  const members=await query<{uid:string;vcard_uid:string}>("SELECT uid,vcard_uid FROM contacts WHERE addressbook_id=$1 AND resource_kind='contact'",[contact.addressbook_id]);
  const memberIds:string[]=[],unresolved:string[]=[];
  for(const reference of group.members) {
    const member=members.find(m=>m.vcard_uid===reference||m.vcard_uid===memberUid(reference)||m.vcard_uid.toLowerCase()===memberUid(reference).toLowerCase()&&/^[0-9a-f-]{36}$/i.test(m.vcard_uid));
    if(member) {if(!memberIds.includes(member.uid))memberIds.push(member.uid);} else unresolved.push(reference);
  }
  return {id:`dav:${contact.uid}`,kind:'carddav' as const,name:group.name,member_uids:memberIds,unresolved_members:[...new Set(unresolved)],etag:contact.etag,addressbook_id:contact.addressbook_id,format:group.format};
}
export async function listCarddavGroups(userId:string) {
  const ids=await getVisibleAddressbookIds(userId);
  const rows=await query<ContactRow>("SELECT * FROM contacts WHERE addressbook_id=ANY($1::text[]) AND resource_kind='group' ORDER BY fn",[ids]);
  return Promise.all(rows.map(groupView));
}
export async function supportedGroupFormats(bookId:string):Promise<Exclude<GroupFormat,'unknown'>[]> {
  const [book]=await query<{url:string}>('SELECT url FROM addressbooks WHERE id=$1',[bookId]);
  if(!book)throw new DavError(404,'not_found');
  const client=await getClientForAddressbook(bookId);
  const responses=await client.propfind({url:book.url,depth:'0',props:{'card:supported-address-data':{},'d:current-user-privilege-set':{}}});
  if(responses.length!==1||!responses[0].ok)throw new DavError(503,'capabilities_unavailable');
  const props=responses[0].props??{};
  const supported=props.supportedAddressData?.addressDataType;
  const types=Array.isArray(supported)?supported:supported?[supported]:[];
  const privileges=props.currentUserPrivilegeSet?.privilege;
  const allowed=Array.isArray(privileges)?privileges:privileges?[privileges]:[];
  if(!allowed.some((p:Record<string,unknown>)=>'all'in p||'write'in p||'bind'in p))return [];
  return types.filter((t:{_attributes?:Record<string,string>})=>t._attributes?.['content-type']==='text/vcard').map((t:{_attributes:Record<string,string>})=>t._attributes.version==='4.0'?'vcard4':t._attributes.version==='3.0'?'apple':null).filter((format):format is 'vcard4'|'apple'=>format!==null);
}
