import { createHash } from 'node:crypto';
import { DavError } from './davSafety';
import type { PhoneEntry, EmailEntry, AddressEntry } from './types';

export interface ContentLine {
  id: string;
  name: string;
  group: string;
  header: string;
  value: string;
  original: string;
}

/** Split on delimiters outside quotes/escapes, without decoding stored content. */
export function splitValue(value: string, separator: string, useQuotes = false): string[] {
  const parts: string[] = [];
  let start = 0, escaped = false, quoted = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (useQuotes && char === '"') quoted = !quoted;
    if (char === separator && !quoted) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts;
}

export function decodeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_all, char: string) => /n/i.test(char) ? '\n' : char);
}
export function encodeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/** Fold by UTF-8 octets, never splitting a Unicode code point. */
export function foldLine(line: string): string {
  let result = '', size = 0;
  for (const char of line) {
    const length = Buffer.byteLength(char);
    if (size + length > 75) { result += '\r\n '; size = 1; }
    result += char; size += length;
  }
  return result;
}

export function readDocument(raw: string): ContentLine[] {
  if (typeof raw !== 'string' || raw.includes('\0') || /\r(?!\n)/.test(raw)) throw new DavError(422, 'invalid_vcard');
  const physical = raw.replace(/\r\n/g, '\n').split('\n');
  while (physical.at(-1) === '') physical.pop();
  const logical: string[] = [];
  for (const line of physical) {
    if (/^[ \t]/.test(line)) {
      if (!logical.length) throw new DavError(422, 'invalid_vcard');
      logical[logical.length - 1] += '\r\n' + line;
    } else logical.push(line);
  }
  const occurrences = new Map<string, number>();
  // Unfold before filtering so continuations cannot attach to the wrong property.
  // Preserve meaningful whitespace and empty property values.
  const content = logical.map(original => ({
    original, unfolded: original.replace(/\r\n[ \t]/g, ''),
  })).filter(line => line.unfolded !== '');
  const lines = content.map(({ original, unfolded }) => {
    let quoted = false, colon = -1;
    for (let i = 0; i < unfolded.length; i++) {
      if (unfolded[i] === '"') quoted = !quoted;
      if (unfolded[i] === ':' && !quoted) { colon = i; break; }
    }
    if (colon < 1) throw new DavError(422, 'invalid_vcard');
    const header = unfolded.slice(0, colon), value = unfolded.slice(colon + 1);
    const qualified = splitValue(header, ';', true)[0];
    if (!/^(?:[A-Za-z0-9-]+\.)?[A-Za-z0-9-]+$/.test(qualified)) throw new DavError(422, 'invalid_vcard');
    const dot = qualified.indexOf('.');
    const group = dot < 0 ? '' : qualified.slice(0, dot);
    const name = qualified.slice(dot + 1).toUpperCase();
    const hash = createHash('sha256').update(header).digest('hex').slice(0, 24);
    const occurrence = occurrences.get(hash) ?? 0;
    occurrences.set(hash, occurrence + 1);
    return { id: `${hash}:${occurrence}`, group, name, header, value, original };
  });
  if (lines[0]?.name !== 'BEGIN' || lines[0].value.toUpperCase() !== 'VCARD' || lines.at(-1)?.name !== 'END' || lines.at(-1)?.value.toUpperCase() !== 'VCARD' || lines.filter(l => ['BEGIN', 'END'].includes(l.name)).length !== 2) throw new DavError(422, 'invalid_vcard');
  const versions = lines.filter(l => l.name === 'VERSION');
  if (versions.length !== 1 || !['3.0', '4.0'].includes(versions[0].value)) throw new DavError(422, 'unsupported_vcard_version');
  const uids = lines.filter(l => l.name === 'UID');
  if (uids.length !== 1 || !uids[0].value) throw new DavError(422, 'invalid_uid');
  return lines;
}

export function parameter(line: ContentLine, name: string): string {
  const values = splitValue(line.header, ';', true).slice(1).filter(p => p.slice(0, p.indexOf('=')).toUpperCase() === name).map(p => p.slice(p.indexOf('=') + 1).replace(/^"|"$/g, ''));
  return values.join(',');
}
function editable(line: ContentLine): boolean {
  return !parameter(line, 'ENCODING') && (!parameter(line, 'CHARSET') || parameter(line, 'CHARSET').toUpperCase() === 'UTF-8');
}
function label(line: ContentLine, lines: ContentLine[]): string {
  const custom = line.group && lines.find(l => l.group === line.group && l.name === 'X-ABLABEL');
  if (custom) return decodeText(custom.value).replace(/^_\$!<(.*)>!\$_$/, '$1');
  const types = parameter(line, 'TYPE').toLowerCase().split(',');
  for (const [type, label] of [['cell','mobil'], ['work','arbeit'], ['home','privat'], ['fax','fax']]) if (types.includes(type)) return label;
  return types.filter(Boolean).join('/') || 'sonstige';
}

export function projectDocument(raw: string) {
  const lines = readDocument(raw);
  const first = (name: string) => lines.find(l => l.name === name);
  const text = (name: string) => { const l = first(name); return l && editable(l) ? decodeText(l.value) : null; };
  const n = splitValue(first('N')?.value ?? '', ';').map(decodeText);
  let birthday = text('BDAY');
  if (birthday && /^\d{8}$/.test(birthday)) birthday = `${birthday.slice(0,4)}-${birthday.slice(4,6)}-${birthday.slice(6)}`;
  if (birthday && /^--\d{2}-\d{2}$/.test(birthday)) birthday = birthday.replace(/^(--\d{2})-/, '$1');
  const multi = (name: string) => lines.filter(l => l.name === name && editable(l));
  const phones: PhoneEntry[] = multi('TEL').map(l => ({ property_id: l.id, label: label(l, lines), value: decodeText(l.value).replace(/^tel:/i, '') }));
  const emails: EmailEntry[] = multi('EMAIL').map(l => ({ property_id: l.id, label: label(l, lines), value: decodeText(l.value) }));
  const addresses: AddressEntry[] = multi('ADR').map(l => {
    const parts = splitValue(l.value, ';').map(decodeText);
    return { property_id: l.id, label: label(l, lines), street: parts[2] ?? '', city: parts[3] ?? '', state: parts[4] || undefined, zip: parts[5] ?? '', country: parts[6] || undefined };
  });
  let photo: string | null = null;
  const p = first('PHOTO');
  if (p?.value.startsWith('data:image/')) photo = p.value;
  else if (p && /^(b|base64)$/i.test(parameter(p, 'ENCODING'))) photo = `data:image/${parameter(p, 'TYPE').toLowerCase() || 'jpeg'};base64,${p.value}`;
  return { uid: text('UID')!, fn: text('FN') ?? '', given_name: n[1] ?? '', family_name: n[0] ?? '', org: first('ORG') ? decodeText(splitValue(first('ORG')!.value, ';')[0]) : null, title: text('TITLE'), birthday, note: text('NOTE'), photo_data_uri: photo, phones, emails, addresses, raw_vcard: raw };
}

export interface EditableFields {
  fn?: string; given_name?: string; family_name?: string; org?: string | null;
  title?: string | null; birthday?: string | null; note?: string | null;
  phones?: PhoneEntry[]; emails?: EmailEntry[]; addresses?: AddressEntry[];
  photo_data_uri?: string | null;
}

export function patchDocument(raw: string, changes: EditableFields): string {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (['phones', 'emails', 'addresses'].includes(key)) {
      if (!Array.isArray(value)) throw new DavError(422, 'invalid_fields');
      for (const entry of value) {
        if (!entry || typeof entry !== 'object' || typeof entry.label !== 'string' || (entry.property_id !== undefined && typeof entry.property_id !== 'string')) throw new DavError(422, 'invalid_fields');
        const keys = key === 'addresses' ? ['street','city','zip'] : ['value'];
        if (keys.some(k => typeof entry[k] !== 'string') || ['state','country'].some(k => entry[k] !== undefined && typeof entry[k] !== 'string')) throw new DavError(422, 'invalid_fields');
      }
    } else if (value !== null && typeof value !== 'string') throw new DavError(422, 'invalid_fields');
  }
  const lines = readDocument(raw), before = projectDocument(raw);
  const replaced = new Map<string, string | null>(), added: string[] = [];
  const set = (line: ContentLine, value: string, header = line.header) => {
    if (!editable(line)) throw new DavError(422, 'unsupported_property_encoding');
    replaced.set(line.id, foldLine(`${header}:${value}`));
  };
  const scalar = (name: string, value: string | null) => {
    const line = lines.find(l => l.name === name);
    if (line) { if (value === null) replaced.set(line.id, null); else set(line, value); }
    else if (value !== null) added.push(foldLine(`${name}:${value}`));
  };
  for (const [field, name] of [['fn','FN'], ['title','TITLE'], ['note','NOTE'], ['birthday','BDAY']] as const) {
    if (changes[field] !== undefined && changes[field] !== before[field]) scalar(name, changes[field] ? encodeText(changes[field]!) : null);
  }
  if ((changes.given_name !== undefined && changes.given_name !== before.given_name) || (changes.family_name !== undefined && changes.family_name !== before.family_name)) {
    const parts = splitValue(lines.find(l => l.name === 'N')?.value ?? ';;;;', ';');
    while (parts.length < 5) parts.push('');
    if (changes.given_name !== undefined && changes.given_name !== before.given_name) parts[1] = encodeText(changes.given_name);
    if (changes.family_name !== undefined && changes.family_name !== before.family_name) parts[0] = encodeText(changes.family_name);
    scalar('N', parts.join(';'));
  }
  if (changes.org !== undefined && changes.org !== before.org) {
    const parts = splitValue(lines.find(l => l.name === 'ORG')?.value ?? '', ';');
    parts[0] = encodeText(changes.org ?? '');
    scalar('ORG', parts.join(';'));
  }
  for (const [field, name] of [['phones','TEL'], ['emails','EMAIL'], ['addresses','ADR']] as const) {
    const entries = changes[field];
    if (entries === undefined || JSON.stringify(entries) === JSON.stringify(before[field])) continue;
    const originals = lines.filter(l => l.name === name && editable(l));
    const used = new Set<string>();
    for (const entry of entries) {
      // Old clients without property IDs may not replace parameter-bearing data.
      const original = entry.property_id ? originals.find(l => l.id === entry.property_id) : undefined;
      if (entry.property_id && (!original || used.has(entry.property_id))) throw new DavError(409, 'stale_property');
      if (original) used.add(original.id);
      const previous = before[field].find(e => e.property_id === original?.id);
      if (original && JSON.stringify(previous) === JSON.stringify(entry)) continue;
      let value: string;
      if (field === 'addresses') {
        const adr = entry as AddressEntry;
        const parts = splitValue(original?.value ?? ';;;;;;', ';');
        while (parts.length < 7) parts.push('');
        for (const [key, index] of [['street',2], ['city',3], ['state',4], ['zip',5], ['country',6]] as const) {
          if (!previous || adr[key] !== (previous as AddressEntry)[key]) parts[index] = encodeText(adr[key] ?? '');
        }
        value = parts.join(';');
      } else {
        value = encodeText((entry as PhoneEntry).value);
        if (name === 'TEL' && original?.value.toLowerCase().startsWith('tel:')) {
          if (/[\r\n\\]/.test((entry as PhoneEntry).value)) throw new DavError(422, 'invalid_phone_uri');
          value = 'tel:' + (entry as PhoneEntry).value;
        }
      }
      let header = original?.header ?? name;
      if (!original || entry.label !== previous?.label) {
        const types: Record<string, string> = { mobil: 'CELL', privat: 'HOME', arbeit: 'WORK', fax: 'FAX', sonstige: 'OTHER' };
        const type = types[entry.label.toLowerCase()];
        // Preserve all opaque parameters and TYPE qualifiers such as VOICE/PREF.
        const parameters = splitValue(header, ';', true);
        const qualifiers = parameter(original ?? { header } as ContentLine, 'TYPE').split(',').filter(t => t && !['HOME','WORK','CELL','FAX','OTHER'].includes(t.toUpperCase()));
        if (qualifiers.some(t => !/^[A-Za-z0-9-]+$/.test(t))) throw new DavError(422, 'unsupported_type_parameter');
        header = parameters.filter((p,i) => i === 0 || !/^TYPE=/i.test(p)).join(';');
        if (type || qualifiers.length) header += ';TYPE=' + [...qualifiers, ...(type ? [type] : [])].join(',');
        const custom = original?.group && lines.find(l => l.group === original.group && l.name === 'X-ABLABEL');
        if (custom) set(custom, encodeText(entry.label));
        else if (!type) {
          const group = original?.group || `frigg${createHash('sha256').update(entry.label + header + value).digest('hex').slice(0,12)}`;
          if (!original?.group) header = `${group}.${header}`;
          added.push(foldLine(`${group}.X-ABLabel:${encodeText(entry.label)}`));
        }
      }
      if (original) set(original, value, header); else added.push(foldLine(`${header}:${value}`));
    }
    for (const original of originals) if (!used.has(original.id)) {
      if (entries.some(e => !e.property_id) && originals.length && !entries.some(e => e.property_id)) throw new DavError(409, 'reload_required');
      replaced.set(original.id, null);
    }
  }
  if (changes.photo_data_uri !== undefined && changes.photo_data_uri !== before.photo_data_uri) {
    for (const photo of lines.filter(l => l.name === 'PHOTO')) replaced.set(photo.id, null);
    if (changes.photo_data_uri) {
      if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(changes.photo_data_uri)) throw new DavError(422, 'invalid_photo');
      const version = lines.find(l => l.name === 'VERSION')!.value;
      const [, mime, data] = /^data:image\/([^;]+);base64,(.*)$/.exec(changes.photo_data_uri)!;
      added.push(foldLine(version === '3.0' ? `PHOTO;ENCODING=b;TYPE=${mime.toUpperCase()}:${data}` : `PHOTO:${changes.photo_data_uri}`));
    }
  }
  if (!replaced.size && !added.length) return raw;
  const output: string[] = [];
  for (const line of lines) {
    if (line.name === 'END') output.push(...added);
    const value = replaced.has(line.id) ? replaced.get(line.id) : line.original;
    if (value !== null && value !== undefined) output.push(value);
  }
  const result = output.join('\r\n') + '\r\n';
  readDocument(result);
  return result;
}
