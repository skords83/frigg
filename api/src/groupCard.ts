import { readDocument,encodeText,decodeText,foldLine,patchDocument } from './vcardDocument';
import { DavError } from './davSafety';
export type GroupFormat='vcard4'|'apple'|'unknown';
export interface ParsedGroup {uid:string;name:string;format:GroupFormat;members:string[]}
export function readGroup(raw:string):ParsedGroup|null {
  const lines=readDocument(raw);
  const markers=lines.filter(l=>['KIND','X-ADDRESSBOOKSERVER-KIND'].includes(l.name));
  if(!markers.some(l=>l.value.toLowerCase()==='group'))return null;
  const version=lines.find(l=>l.name==='VERSION')!.value;
  let format:GroupFormat=markers.length===1&&markers[0].name==='KIND'&&version==='4.0'?'vcard4':markers.length===1&&markers[0].name==='X-ADDRESSBOOKSERVER-KIND'&&version==='3.0'?'apple':'unknown';
  const members=lines.filter(l=>['MEMBER','X-ADDRESSBOOKSERVER-MEMBER'].includes(l.name));
  if(members.some(l=>l.name!==(format==='vcard4'?'MEMBER':'X-ADDRESSBOOKSERVER-MEMBER')))format='unknown';
  return {uid:decodeText(lines.find(l=>l.name==='UID')!.value),name:decodeText(lines.find(l=>l.name==='FN')?.value??''),format,members:members.map(l=>l.value)};
}
export function memberReference(uid:string):string {
  if(/^[a-z][a-z0-9+.-]*:[^\r\n\s]+$/i.test(uid))return uid;
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid))return `urn:uuid:${uid}`;
  throw new DavError(422,'unsupported_member_uid');
}
export function memberUid(ref:string):string {return ref.replace(/^urn:uuid:/i,'');}
export function buildGroup(uid:string,name:string,format:Exclude<GroupFormat,'unknown'>):string {
  const lines=['BEGIN:VCARD',`VERSION:${format==='vcard4'?'4.0':'3.0'}`,`UID:${encodeText(uid)}`,`FN:${encodeText(name)}`,'N:;;;;',`${format==='vcard4'?'KIND':'X-ADDRESSBOOKSERVER-KIND'}:group`,'END:VCARD'];
  return lines.map(foldLine).join('\r\n')+'\r\n';
}
export function patchGroup(raw:string,change:{name?:string;add?:string;remove?:string}):string {
  const group=readGroup(raw);
  if(!group||group.format==='unknown')throw new DavError(422,'unsupported_group_format');
  let result=change.name===undefined?raw:patchDocument(raw,{fn:change.name});
  const prop=group.format==='vcard4'?'MEMBER':'X-ADDRESSBOOKSERVER-MEMBER';
  const canonical=(ref:string)=>{const id=memberUid(ref);return /^[0-9a-f-]{36}$/i.test(id)?id.toLowerCase():id;};
  if(change.add && group.members.some(m=>canonical(m)===canonical(change.add!)))return result;
  const lines=readDocument(result),output:string[]=[];
  for(const line of lines) {
    if(change.remove&&line.name===prop&&canonical(line.value)===canonical(change.remove))continue;
    if(line.name==='END'&&change.add)output.push(foldLine(`${prop}:${change.add}`));
    output.push(line.original);
  }
  return output.join('\r\n')+'\r\n';
}
