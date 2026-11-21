import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedFields, compareVersions, resolveVersions, type EditContact } from '../../web/components/conflicts';
const base = { uid: 'synthetic', etag: '"base"', given_name: 'Anne', family_name: 'Test', fn: 'Anne Test', org: 'Firma', note: '', phones: [], emails: [], addresses: [] } as unknown as EditContact;

test('different fields merge against the latest server version', () => {
  const mine = { ...base, note: 'mine' }, server = { ...base, org: 'server', etag: '"next"' };
  const merged = resolveVersions(base, mine, server, {})!;
  assert.equal(merged.org, 'server'); assert.equal(merged.note, 'mine'); assert.equal(merged.etag, '"next"');
  assert.deepEqual(changedFields(server, merged), { note: 'mine' });
});
test('same field needs an explicit decision and never defaults to overwriting', () => {
  const mine = { ...base, note: 'mine' }, server = { ...base, note: 'server' };
  assert.equal(resolveVersions(base, mine, server, {}), null);
  assert.equal(resolveVersions(base, mine, server, { note: 'mine' })!.note, 'mine');
  assert.equal(resolveVersions(base, mine, server, { note: 'server' })!.note, 'server');
  assert.deepEqual(compareVersions(base,mine,server).find(r => r.key === 'note'), { key: 'note', mineChanged: true, serverChanged: true, differs: true });
});
test('equal concurrent edits need no redundant choice', () => {
  const edited = { ...base, note: 'same' };
  assert.equal(resolveVersions(base, edited, edited, {})!.note, 'same');
});
test('a second conflict compares the attempted resolution with the newer baseline', () => {
  const server = { ...base, note: 'first', etag: '"first"' };
  const selected = resolveVersions(base, { ...base, note: 'mine' }, server, { note: 'mine' })!;
  const newer = { ...server, note: 'second', etag: '"second"' };
  assert.equal(resolveVersions(server, selected, newer, {}), null);
  assert.equal(resolveVersions(server, selected, newer, { note: 'server' })!.note, 'second');
});
test('comparison/cancellation never mutate the original snapshots', () => {
  const mine = { ...base, note: 'mine' }, server = { ...base, note: 'server' };
  const snapshot = JSON.stringify([base,mine,server]);
  resolveVersions(base,mine,server,{note:'mine'});
  assert.equal(JSON.stringify([base,mine,server]), snapshot);
});
