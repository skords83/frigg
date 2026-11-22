import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchDocument, projectDocument, readDocument, splitValue, foldLine, encodeText } from '../src/vcardDocument';
import { buildVCard, isInvalidBirthday } from '../src/contactOps';
import { parseVCard, splitVCards } from '../src/carddav';

const fixture = (version: '3.0' | '4.0') => [
  'BEGIN:VCARD', `VERSION:${version}`, 'UID:synthetic-ä', 'FN:Dr. Änne Beispiel',
  'N:Bei\\;spiel;Änne;Zweiter\\,Name;Dr.;Jr.',
  'ORG;X-PRIVATE="a:b;c":Firma;Abteilung', 'ORG:Zweite Firma;Team',
  'item1.TEL;TYPE=CELL,VOICE;PREF=1;X-OPAQUE="a:b;c":+491234',
  'item1.X-ABLabel:Mein\\; Label',
  'EMAIL;TYPE=HOME;X-ID=preserve:a@example.invalid', 'EMAIL;TYPE=WORK:b@example.invalid',
  'ADR;TYPE=HOME;LABEL="Straße, Ort";X-ID=adr:Postfach;Etage 2;Straße\\; 1;München;Bayern;12345;Deutschland',
  'ADR;TYPE=WORK:Postfach 9;;;;;;', 'BDAY:--0229',
  'NOTE:Zeile 1\\nZeile 2\\, Test\\; Slash\\\\Ende',
  'URL;TYPE=work:https://example.invalid/path?a=1', 'IMPP:xmpp:synthetic@example.invalid',
  'ANNIVERSARY:20000101', 'RELATED;TYPE=parent:urn:uuid:parent',
  'MEMBER:urn:uuid:someone', 'X-CUSTOM;X-P="quoted:value;param":keep\\,all',
  'X-FOLDED:Äöü unbekannt', ' weiter erhalten',
  version === '3.0' ? 'PHOTO;ENCODING=b;TYPE=JPEG:YWJj' : 'PHOTO:data:image/jpeg;base64,YWJj',
  'END:VCARD', '',
].join('\r\n');

for (const version of ['3.0','4.0'] as const) {
  test(`vCard ${version}: editing one telephone preserves all other content lines`, () => {
    const raw = fixture(version);
    const parsed = projectDocument(raw);
    assert.equal(parsed.phones[0].label, 'Mein; Label');
    assert.equal(parsed.family_name, 'Bei;spiel');
    assert.equal(parsed.addresses[0].street, 'Straße; 1');
    assert.equal(parsed.addresses.length, 2);
    assert.equal(parsed.note, 'Zeile 1\nZeile 2, Test; Slash\\Ende');
    const edited = patchDocument(raw, { phones: [{ ...parsed.phones[0], value: '+499876' }] });
    const before = readDocument(raw), after = readDocument(edited);
    assert.equal(after.length, before.length);
    before.forEach((line,i) => {
      if (line.name === 'TEL') { assert.equal(after[i].header, line.header); assert.equal(after[i].value, '+499876'); }
      else assert.equal(after[i].original, line.original);
    });
    assert.equal(parseVCard(edited)?.phones[0].value, '+499876');
    assert.equal(projectDocument(edited).photo_data_uri, 'data:image/jpeg;base64,YWJj');
  });
  test(`vCard ${version}: names and addresses preserve unrepresented components`, () => {
    const raw = fixture(version), contact = projectDocument(raw);
    const edited = patchDocument(raw, { given_name: 'Neu;Vor\\name', addresses: contact.addresses.map((a,i) => i ? a : { ...a, city: 'Zürich' }) });
    const n = readDocument(edited).find(l => l.name === 'N')!;
    assert.deepEqual(splitValue(n.value, ';').slice(2), ['Zweiter\\,Name','Dr.','Jr.']);
    const adr = readDocument(edited).find(l => l.name === 'ADR')!;
    assert.deepEqual(splitValue(adr.value, ';').slice(0,2), ['Postfach','Etage 2']);
    assert.equal(projectDocument(edited).given_name, 'Neu;Vor\\name');
    assert.equal(projectDocument(edited).addresses[0].city, 'Zürich');
  });
  test(`vCard ${version}: changing primary organization preserves departments and additional organizations`, () => {
    const edited = readDocument(patchDocument(fixture(version), { org: 'Neue;Firma' })).filter(l => l.name === 'ORG');
    assert.equal(edited[0].value, 'Neue\\;Firma;Abteilung');
    assert.equal(edited[0].header, 'ORG;X-PRIVATE="a:b;c"');
    assert.equal(edited[1].value, 'Zweite Firma;Team');
  });
}

test('generated cards escape text/components and custom labels without injecting properties', () => {
  const text = 'Änne;Test, \\ und\nZeile 2';
  const card = buildVCard({ uid: 'test', given_name: text, family_name: 'Familie', note: text, org: text,
    phones: [{ label: 'custom;:\nINJECTED:test', value: '+1234' }],
    addresses: [{ label: 'privat', street: text, city: 'Ort', zip: '123' }] });
  const contact = projectDocument(card);
  assert.equal(contact.given_name, text);
  assert.equal(contact.note, text);
  assert.equal(contact.addresses[0].street, text);
  assert.equal(readDocument(card).some(l => l.name === 'INJECTED'), false);
});

test('folding uses 75 octets and preserves Unicode and backslashes', () => {
  const value = 'ä😀漢\\;'.repeat(60);
  const folded = foldLine('NOTE:' + encodeText(value));
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const card = buildVCard({ uid: 'unicode', note: value });
  assert.equal(projectDocument(card).note, value);
});

test('unsupported encodings survive unrelated edits and cannot be silently replaced', () => {
  const raw = fixture('3.0').replace('FN:Dr. Änne Beispiel', 'FN;ENCODING=QUOTED-PRINTABLE:=C3=84nne');
  const edited = patchDocument(raw, { title: 'Neu' });
  assert.ok(edited.includes('FN;ENCODING=QUOTED-PRINTABLE:=C3=84nne'));
  assert.throws(() => patchDocument(raw, { fn: 'Other' }), { message: 'unsupported_property_encoding' });
});

test('property references survive value changes but reject stale metadata and duplicate references', () => {
  const raw = fixture('4.0'), original = projectDocument(raw);
  const changed = patchDocument(raw, { phones: [{ ...original.phones[0], value: '+222' }] });
  assert.equal(projectDocument(changed).phones[0].property_id, original.phones[0].property_id);
  assert.throws(() => patchDocument(raw, { phones: [{ ...original.phones[0], property_id: 'stale' }] }), { message: 'stale_property' });
  assert.throws(() => patchDocument(raw, { phones: [original.phones[0], original.phones[0]] }), { message: 'stale_property' });
});

test('partial dates validate without inventing a year', () => {
  assert.equal(isInvalidBirthday('--0229'), false);
  assert.equal(isInvalidBirthday('--02-29'), false);
  assert.equal(isInvalidBirthday('--0230'), true);
});

test('import splitting ignores BEGIN:VCARD inside an escaped note', () => {
  const first = buildVCard({ uid: 'one', note: 'BEGIN:VCARD is text' });
  const second = buildVCard({ uid: 'two' });
  const cards = splitVCards(first + second);
  assert.equal(cards.length, 2);
  assert.equal(projectDocument(cards[0]).note, 'BEGIN:VCARD is text');
});

for (const version of ['3.0', '4.0'] as const) {
  for (const newline of ['\r\n', '\n']) {
    test(`vCard ${version}: blank lines, folds and empty values (${JSON.stringify(newline)})`, () => {
      const raw = ['', 'BEGIN:VCARD', '', `VERSION:${version}`, 'UID:blank-lines', '',
        'FN: Synthetic ', 'NOTE: left ', '  right', '\t\ttail ', '',
        'TITLE:', 'X-EMPTY:', '', 'X-FOLDED:one', ' two', '', 'END:VCARD', ''].join(newline);
      const parsed = parseVCard(raw)!;
      assert.ok(parsed);
      assert.equal(parsed.raw_vcard, raw);
      assert.equal(parsed.fn, ' Synthetic ');
      assert.equal(parsed.note, ' left  right\ttail ');
      assert.equal(parsed.title, '');
      assert.equal(readDocument(raw).find(l => l.name === 'X-EMPTY')?.value, '');
      assert.equal(patchDocument(raw, {}), raw);
      const edited = patchDocument(raw, { title: 'New' });
      for (const line of readDocument(raw).filter(l => l.name !== 'TITLE')) {
        assert.deepEqual(readDocument(edited).find(l => l.id === line.id), line);
      }
    });
  }
}

test('blank physical lines are not removed before unfolding and whitespace is not trimmed', () => {
  const wrap = (extra: string) => 'BEGIN:VCARD\r\nVERSION:4.0\r\nUID:blank\r\nNOTE:first\r\n' + extra + 'END:VCARD\r\n';
  assert.throws(() => readDocument(wrap('\r\n continuation\r\n')), { subcategory: 'missing_separator' });
  assert.throws(() => readDocument(wrap('\r\n  \r\n')), { subcategory: 'missing_separator' });
  assert.throws(() => readDocument(wrap('\r\n\u00a0\r\n')), { subcategory: 'missing_separator' });
  assert.throws(() => readDocument(wrap('\r\n :value\r\n')), { subcategory: 'empty_property_name' });
  assert.equal(projectDocument(wrap(' \r\n')).note, 'first');
  assert.equal(projectDocument(wrap('  \r\n')).note, 'first ');
  assert.equal(projectDocument(wrap('\t\t\r\n')).note, 'first\t');
});
