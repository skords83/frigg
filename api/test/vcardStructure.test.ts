import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propfind } from 'tsdav';
import { readDocument } from '../src/vcardDocument';
import { parseVCard, withNativeCards } from '../src/carddav';
import { DavError } from '../src/davSafety';
import { Diagnostics, diagnosticBook } from '../src/syncDiagnostics';
import { inspectBook } from '../src/diagnoseSync';
import { VCardStructureError, vcardStructureCategories, type VCardStructureCategory } from '../src/vcardStructureError';

const card = (extra = '', version = '4.0') => `BEGIN:VCARD\r\nVERSION:${version}\r\nUID:synthetic\r\nFN:Synthetic\r\nN:;;;;\r\n${extra}END:VCARD\r\n`;
const rejected: Array<[string, unknown, VCardStructureCategory]> = [
  ['non-string', null, 'non_string_input'],
  ['NUL', card('NOTE:a\0b\r\n'), 'nul_character'],
  ['bare CR only', card().replace(/\r\n/g, '\r'), 'bare_cr'],
  ['stray CR inside value', card('NOTE:a\rb\r\n'), 'bare_cr'],
  ['double CR', card().replace('\r\n', '\r\r\n'), 'bare_cr'],
  ['initial space', ' ' + card(), 'orphan_fold'],
  ['initial tab', '\t' + card(), 'orphan_fold'],
  ['leading empty line', '\r\n' + card(), 'empty_line'],
  ['internal empty line', card('\r\n'), 'empty_line'],
  ['folded empty line', card('\r\n \r\n'), 'empty_line'],
  ['missing property before colon', card(':synthetic\r\n'), 'empty_property_name'],
  ['unclosed parameter quote', card('X-TEST;X-P="synthetic:value\r\n'), 'unclosed_header_quote'],
  ['no separator', card('X-TEST\r\n'), 'missing_separator'],
  ['legacy quoted-printable soft break', card('NOTE;ENCODING=QUOTED-PRINTABLE:synthetic=\r\ncontinuation\r\n'), 'missing_separator'],
  ['unfolded base64 continuation', card('PHOTO;ENCODING=b:YWJj\r\nZGVm\r\n'), 'missing_separator'],
  ['UTF-8 BOM', '\uFEFF' + card(), 'leading_bom'],
  ['multiple group dots', card('one.two.X-TEST:synthetic\r\n'), 'multiple_group_separators'],
  ['empty group', card('.X-TEST:synthetic\r\n'), 'invalid_group_name'],
  ['underscore group', card('bad_group.X-TEST:synthetic\r\n'), 'invalid_group_name'],
  ['underscore property', card('X_BAD:synthetic\r\n'), 'invalid_property_name'],
  ['space property', card('X BAD:synthetic\r\n'), 'invalid_property_name'],
  ['Unicode property', card('X-Ä:synthetic\r\n'), 'invalid_property_name'],
  ['empty property after group', card('item1.:synthetic\r\n'), 'invalid_property_name'],
  ['NBSP is not a fold', card('NOTE:synthetic\r\n\u00A0X-TEST:value\r\n'), 'invalid_property_name'],
  ['empty document', '', 'missing_begin'],
  ['missing BEGIN', card().replace('BEGIN:VCARD\r\n', ''), 'missing_begin'],
  ['property before BEGIN', 'X-TEST:synthetic\r\n' + card(), 'missing_begin'],
  ['BEGIN whitespace', card().replace('BEGIN:VCARD', 'BEGIN:VCARD '), 'invalid_begin_value'],
  ['other BEGIN type', card().replace('BEGIN:VCARD', 'BEGIN:VCALENDAR'), 'invalid_begin_value'],
  ['missing END', card().replace('END:VCARD\r\n', ''), 'missing_end'],
  ['property after END', card() + 'X-TEST:synthetic\r\n', 'missing_end'],
  ['folded text after END', card() + ' synthetic\r\n', 'invalid_end_value'],
  ['other END type', card().replace('END:VCARD', 'END:VCALENDAR'), 'invalid_end_value'],
  ['extra BEGIN', card('BEGIN:VCARD\r\n'), 'boundary_count'],
  ['extra END', card('END:VCARD\r\n'), 'boundary_count'],
  ['two cards', card() + card(), 'boundary_count'],
];

for (const [name, raw, subcategory] of rejected) {
  test(`structural rejection: ${name}`, () => {
    assert.throws(() => readDocument(raw as string), (error: unknown) => {
      assert.ok(error instanceof VCardStructureError);
      assert.ok(error instanceof DavError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'invalid_vcard');
      assert.equal(error.message, 'invalid_vcard');
      assert.equal(error.subcategory, subcategory);
      return true;
    });
    assert.equal(parseVCard(raw as string), null);
  });
}

test('every structural subcategory is exercised; first failing check wins', () => {
  assert.deepEqual([...new Set(rejected.map(row => row[2]))].sort(), [...vcardStructureCategories].sort());
  assert.throws(() => readDocument('\uFEFF' + card('NOTE:a\0b\r')), { subcategory: 'nul_character' });
  assert.throws(() => readDocument('\uFEFF' + card('NOTE:a\rb\r\n')), { subcategory: 'bare_cr' });
  assert.throws(() => readDocument('X-TEST:x\r\n' + card('bad_name:x\r\n')), { subcategory: 'invalid_property_name' });
});

const accepted: Array<[string, string]> = [
  ['CRLF', card()], ['LF', card().replace(/\r\n/g, '\n')],
  ['mixed CRLF/LF', card().replace('VERSION:4.0\r\n', 'VERSION:4.0\n')],
  ['no final newline', card().trimEnd()], ['trailing empty lines', card() + '\r\n\r\n'],
  ['space folding', card('NOTE:synthe\r\n tic\r\n')],
  ['tab folding', card('NOTE:synthe\r\n\ttic\r\n')],
  ['two-space folding', card('NOTE:synthetic\r\n  value\r\n')],
  ['folded property name', card('X-TE\r\n ST:synthetic\r\n')],
  ['folded parameter and quoted colon', card('X-TEST;X-P="a:\r\n b;c":synthetic\r\n')],
  ['empty quoted parameter', card('X-TEST;X-P="":synthetic\r\n')],
  ['RFC6868 parameter quoting', card('X-TEST;X-P="a^\'b":synthetic\r\n')],
  ['lowercase boundaries/properties', card().toLowerCase()],
  ['grouped property', card('item-1.X-TEST:synthetic\r\n')],
  ['Unicode in values', card('NOTE:ä漢😀\r\n')],
  ['long unfurled line', card('NOTE:' + 'a'.repeat(1000) + '\r\n')],
  ['escaped newline', card('NOTE:a\\nb\r\n')],
  ['folded base64', card('PHOTO;ENCODING=b:YWJj\r\n ZGVm\r\n', '3.0')],
  ['vCard 4 group', card('KIND:group\r\nMEMBER:urn:uuid:synthetic\r\n')],
  ['Apple group', card('X-ADDRESSBOOKSERVER-KIND:group\r\n', '3.0')],
];
for (const [name, raw] of accepted) {
  test(`unchanged structural acceptance: ${name}`, () => {
    assert.ok(readDocument(raw).length > 0);
    // The full parser must preserve input; no repair/normalization introduced here.
    assert.equal(parseVCard(raw)?.raw_vcard, raw);
  });
}

test('valid BEGIN:VCARD text and escaped AGENT reach the secondary parser, which still rejects them', async () => {
  const log = console.log;
  const events: Array<Record<string, unknown>> = [];
  console.log = line => { events.push(JSON.parse(String(line))); };
  try {
    const nested = 'BEGIN:VCARD\\nVERSION:3.0\\nUID:agent-synthetic\\nFN:Synthetic\\nN:Synthetic\\;\\;\\;\\;\\nEND:VCARD\\n';
    for (const raw of [card('NOTE:BEGIN:VCARD is text\r\n'), card('AGENT:' + nested + '\r\n', '3.0')]) {
      assert.ok(readDocument(raw).length > 0);
      await diagnosticBook('synthetic', async () => { assert.equal(parseVCard(raw), null); }, 'read_only');
    }
    const failures = events.filter(event => event.type === 'failure');
    assert.equal(failures.length, 2);
    assert.ok(failures.every(event => event.reason === 'vcf_parse_failed' && event.subcategory === undefined));
  } finally { console.log = log; }
});

test('version and UID errors remain separate from invalid_vcard', () => {
  for (const raw of [card('', '2.1'), card().replace('VERSION:4.0\r\n', ''), card('VERSION:4.0\r\n')]) {
    assert.throws(() => readDocument(raw), { code: 'unsupported_vcard_version' });
  }
  for (const raw of [card('UID:duplicate\r\n'), card().replace('UID:synthetic', 'UID:'), card().replace('UID:synthetic\r\n', '')]) {
    assert.throws(() => readDocument(raw), { code: 'invalid_uid' });
  }
});

test('read-only scan emits only allowlisted structural subcategories and keeps 122/113/9 totals', async () => {
  const log = console.log, oldKey = process.env.SYNC_DIAGNOSTICS_KEY;
  const output: string[] = [];
  console.log = line => { output.push(String(line)); };
  process.env.SYNC_DIAGNOSTICS_KEY = 'cd'.repeat(32);
  try {
    for (const [index, total, invalid] of [[0, 45, 5], [1, 40, 2], [2, 37, 2]]) {
      const url = `https://synthetic.invalid/book${index}/`;
      const failures = await inspectBook({
        addressBookQuery: async () => Array.from({ length: total }, (_, i) => ({ ok: true, status: 200, href: url + i, raw: { multistatus: {} } })),
        readVCard: async href => {
          const i = Number(href.slice(url.length));
          return { raw: (i < invalid ? card('\r\n') : card()).replace('UID:synthetic', `UID:synthetic-${i}`), etag: '"synthetic"' };
        },
      }, { url }, `book${index}`, []);
      assert.equal(failures, invalid);
    }
    const events = output.map(line => JSON.parse(line));
    const summaries = events.filter(e => e.type === 'book_summary');
    assert.equal(summaries.reduce((n, e) => n + e.listed_resources, 0), 122);
    assert.equal(summaries.reduce((n, e) => n + e.eligible_resources, 0), 113);
    assert.deepEqual(summaries.map(e => e.parser_errors_by_subcategory), [{ empty_line: 5 }, { empty_line: 2 }, { empty_line: 2 }]);
    assert.ok(summaries.every(e => e.successful_upserts === 0 && e.markers === 'unchanged'));
    const failures = events.filter(e => e.type === 'failure');
    assert.equal(failures.length, 9);
    assert.ok(failures.every(e => e.code === 'invalid_vcard' && e.subcategory === 'empty_line' && e.phase === 'parse' && e.reason === 'document_parse_failed' && /^[0-9a-f]{64}$/.test(e.resource_ref)));
    const d = new Diagnostics('sensitive-book');
    d.failure('document_parse_failed', 'parse', 'https://sensitive.invalid/resource', 'invalid_vcard', 'sensitive-unknown');
    assert.equal(JSON.parse(output.at(-1)!).subcategory, undefined);
    d.summary();
    assert.deepEqual(JSON.parse(output.at(-1)!).parser_errors_by_subcategory, {});
    for (const secret of ['synthetic.invalid', 'UID:', 'FN:', 'synthetic-', 'sensitive-book', 'sensitive.invalid', 'sensitive-unknown']) assert.equal(output.join('').includes(secret), false);
  } finally {
    console.log = log;
    if (oldKey === undefined) delete process.env.SYNC_DIAGNOSTICS_KEY; else process.env.SYNC_DIAGNOSTICS_KEY = oldKey;
  }
});

test('native adapter passes structurally invalid cards unchanged to the parser', async () => {
  for (const raw of ['\uFEFF' + card(), card('\r\n'), card().replace(/\r\n/g, '\r')]) {
    const client = withNativeCards({ propfind: async () => [{ ok: true, status: 200, props: { addressData: { _cdata: raw }, getetag: '"synthetic"' } }] });
    assert.equal((await client.readVCard('https://synthetic.invalid/book/card')).raw, raw);
  }
});

test('actual tsdav XML decoding trims outer whitespace/BOM but preserves interior structure', async () => {
  for (const cdata of [true, false]) {
    for (const raw of [card(), '\uFEFF' + card(), '\r\n' + card(), card('\r\n'), card().replace(/\r\n/g, '\r')]) {
      const value = cdata ? `<![CDATA[${raw}]]>` : raw;
      const client = withNativeCards({ propfind: (args: object) => propfind({ ...args, url: 'https://synthetic.invalid/book/card',
        fetch: async () => new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:response><d:href>/book/card</d:href><d:propstat><d:prop><c:address-data>${value}</c:address-data><d:getetag>"synthetic"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, { status: 207, headers: { 'Content-Type': 'application/xml' } }),
      }) });
      const native = await client.readVCard('https://synthetic.invalid/book/card');
      assert.equal(native.raw, raw.trim());
      if (raw === card('\r\n')) assert.throws(() => readDocument(native.raw), { subcategory: 'empty_line' });
      else if (!raw.includes('\n')) assert.throws(() => readDocument(native.raw), { subcategory: 'bare_cr' });
      else assert.ok(readDocument(native.raw).length > 0);
    }
  }
});
