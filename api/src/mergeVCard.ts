import { readDocument, foldLine, type ContentLine } from './vcardDocument';
import { DavError } from './davSafety';

const ignored = new Set(['BEGIN','END','VERSION','UID']);
const multi = new Set(['TEL','EMAIL','ADR','URL','IMPP','CATEGORIES','RELATED','ORG','NICKNAME','X-FRIGG-MERGED-UID']);
const single = new Set(['FN','N','BDAY','ANNIVERSARY','TITLE','ROLE','NOTE','PHOTO','KIND','GENDER','PRODID','REV']);
const key = (line: ContentLine) => `${line.header}:${line.value}`;
export interface MergeRow { property: string; a: string[]; b: string[]; result: string[]; conflict: boolean; blocked: boolean }
export type MergeChoices = Record<string, 'a' | 'b'>;

/** Every difference, including opaque fields, is included in the preview. */
export function mergePreview(targetRaw: string, sourceRaw: string, choices: MergeChoices = {}) {
  const target = readDocument(targetRaw), source = readDocument(sourceRaw);
  if (target.find(l=>l.name==='VERSION')!.value !== source.find(l=>l.name==='VERSION')!.value) throw new DavError(422,'merge_version_mismatch');
  // A group prefix joins properties/labels. Remapping unknown references is unsafe.
  const targetGroups = new Set(target.map(l=>l.group).filter(Boolean));
  for (const group of targetGroups) {
    const a = target.filter(l=>l.group===group).map(key), b = source.filter(l=>l.group===group).map(key);
    if (b.length && JSON.stringify(a)!==JSON.stringify(b)) throw new DavError(422,'merge_group_collision');
  }
  const names = [...new Set([...target,...source].map(l=>l.name))].filter(n=>!ignored.has(n));
  const rows: MergeRow[] = [];
  const selected = new Map<string,string[]>();
  for (const name of names) {
    const a = target.filter(l=>l.name===name).map(key), b = source.filter(l=>l.name===name).map(key);
    const same = JSON.stringify(a)===JSON.stringify(b);
    const conflict = !!(a.length && b.length && !same && !multi.has(name));
    const blocked = conflict && !single.has(name);
    const result = conflict ? (choices[name]==='b' ? b : a) : [...new Set([...a,...b])];
    rows.push({ property:name, a, b, result, conflict, blocked });
    selected.set(name,result);
  }
  // Keep target order and syntax; append new properties in source order.
  const output:string[]=[];
  const emitted=new Set<string>();
  for(const line of target) {
    if(line.name==='END') continue;
    const row=rows.find(r=>r.property===line.name);
    if(row?.conflict && choices[line.name]==='b') {
      if(!emitted.has(line.name)) output.push(...row.b.map(foldLine));
      emitted.add(line.name);
    } else output.push(line.original);
  }
  const present=new Set(output.map(s=>s.replace(/\r\n[ \t]/g,'')));
  for(const line of source) {
    if(ignored.has(line.name)) continue;
    if(selected.get(line.name)?.includes(key(line)) && !present.has(key(line))) {
      output.push(line.original);present.add(key(line));
    }
  }
  const sourceUid = source.find(l=>l.name==='UID')!.value;
  if (sourceUid !== target.find(l=>l.name==='UID')!.value) output.push(`X-FRIGG-MERGED-UID:${sourceUid}`);
  output.push('END:VCARD');
  const unresolved = rows.some(row=>row.blocked || row.conflict && !choices[row.property]);
  return { rows, raw: output.join('\r\n')+'\r\n', unresolved };
}
