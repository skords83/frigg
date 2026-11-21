import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyBeforeDelete } from '../src/moveContact';

const raw = 'BEGIN:VCARD\r\nUID:synthetic\r\nFN:Synthetic\r\nX-PRIVATE:preserved\r\nEND:VCARD\r\n';
const sourceUrl = 'https://dav.invalid/source/arbitrary';
const targetUrl = 'https://dav.invalid/target/synthetic.vcf';

test('move failure matrix uses synthetic in-memory resources only', async (t) => {
  for (const failure of ['none', 'create', 'readback', 'changed-target', 'delete', 'source-conflict', 'uid-collision', 'lost-response']) {
    await t.test(failure, async () => {
      const events: string[] = [];
      let sourceExists = true;
      let targetExists = failure === 'uid-collision';
      const args = {
        sourceBook: 'https://dav.invalid/source/', targetBook: 'https://dav.invalid/target/',
        sourceUrl, uid: 'synthetic', etag: '"source"', uidOf: (data: string) => data.includes('UID:synthetic') ? 'synthetic' : null,
        source: {
          fetchVCards: async () => [{ url: sourceUrl, data: raw, etag: failure === 'source-conflict' ? '"changed"' : '"source"' }],
          createVCard: async () => { throw new Error('unused'); },
          deleteVCard: async ({ vCard }: { vCard: { url: string; etag: string } }) => {
            events.push('delete'); assert.equal(vCard.etag, '"source"'); assert.equal(vCard.url, sourceUrl);
            if (failure === 'delete') return new Response(null, { status: 412 });
            sourceExists = false; return new Response(null, { status: 204 });
          },
        },
        target: {
          fetchVCards: async ({ objectUrls }: { objectUrls?: string[] }) => {
            if (objectUrls) {
              events.push('verify');
              if (failure === 'readback') throw new Error('offline');
              return [{ url: targetUrl, etag: '"target"', data: failure === 'changed-target' ? raw.replace('preserved', 'changed') : raw }];
            }
            return targetExists ? [{ url: targetUrl, etag: '"target"', data: raw }] : [];
          },
          createVCard: async () => {
            events.push('create');
            if (failure === 'create') return new Response(null, { status: 503 });
            targetExists = true;
            if (failure === 'lost-response') throw new Error('connection lost after commit');
            return new Response(null, { status: 201 });
          },
          deleteVCard: async () => { throw new Error('target must never be rolled back'); },
        },
      };
      if (failure === 'none') {
        assert.equal((await copyBeforeDelete(args)).href, targetUrl);
        assert.deepEqual(events, ['create', 'verify', 'delete']);
        assert.equal(sourceExists, false);
      } else {
        await assert.rejects(copyBeforeDelete(args));
        assert.equal(sourceExists, true);
      }
      if (['readback', 'changed-target', 'delete', 'lost-response'].includes(failure)) {
        assert.equal(targetExists, true);
        const before = events.length;
        await assert.rejects(copyBeforeDelete(args), { message: 'target_exists' });
        assert.equal(events.length, before, 'retry creates no extra copy and deletes nothing');
      }
      assert.ok(sourceExists || targetExists);
    });
  }
});
