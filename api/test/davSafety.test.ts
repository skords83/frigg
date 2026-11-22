import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createVCard, updateVCard, deleteVCard } from 'tsdav';
import { DavError, guardedDavFetch, isStrongEtag, resourceUrl } from '../src/davSafety';

const card = 'BEGIN:VCARD\r\nVERSION:4.0\r\nUID:synthetic\r\nFN:Test\r\nEND:VCARD\r\n';

test('only a single, quoted, strong ETag authorizes replacement', () => {
  for (const value of ['', '*', 'W/"one"', 'one', '"a", "b"', '"a\r\nb"', undefined]) assert.equal(isStrongEtag(value), false);
  assert.equal(isStrongEtag('"a-123"'), true);
});

test('resource URLs use the actual href, never a guessed UID filename', () => {
  assert.equal(resourceUrl('https://dav.invalid/book/', '/book/arbitrary'), 'https://dav.invalid/book/arbitrary');
  for (const href of [null, 'https://evil.invalid/book/x', '../other/x', '/book-2/x', 'x?foo', 'x#bar']) {
    assert.throws(() => resourceUrl('https://dav.invalid/book/', href), DavError);
  }
});

test('invalid preconditions stop before any network request', async () => {
  let called = false;
  const guarded = guardedDavFetch(async () => { called = true; return new Response(); });
  for (const method of ['PUT', 'DELETE']) {
    await assert.rejects(guarded('https://dav.invalid/test', { method }), { status: 428 });
  }
  assert.equal(called, false);
});

for (const [status, expected] of [[202,502], [207,502], [302,502], [404,409], [409,409], [412,409], [500,502], [503,502], [403,403]]) {
  test(`HTTP ${status} cannot be mistaken for a committed write`, async () => {
    const guarded = guardedDavFetch(async () => new Response('private contact content', { status }));
    await assert.rejects(guarded('https://dav.invalid/test', { method: 'PUT', headers: { 'If-Match': '"old"' } }),
      (error: unknown) => error instanceof DavError && error.status === expected && !error.message.includes('private'));
  });
}

test('network failures are sanitized and never authorize a local commit', async () => {
  const guarded = guardedDavFetch(async () => { throw new Error('credentials and contact data'); });
  await assert.rejects(guarded('https://dav.invalid/test', { method: 'DELETE', headers: { 'If-Match': '"old"' } }), { status: 503, message: 'dav_unavailable' });
});

test('real tsdav HTTP writes preserve preconditions, reject stale clients and return the new ETag', async () => {
  let etag = '"one"';
  let content = card;
  let exists = true;
  const requests: { method?: string; match?: string; none?: string }[] = [];
  const server = createServer(async (req, res) => {
    requests.push({ method: req.method, match: req.headers['if-match'], none: req.headers['if-none-match'] });
    if (req.headers['if-none-match'] === '*') {
      if (exists) { res.writeHead(412).end(); return; }
    } else if (!exists) { res.writeHead(404).end(); return; }
    else if (req.headers['if-match'] !== etag) { res.writeHead(412).end(); return; }
    if (req.method === 'DELETE') { exists = false; res.writeHead(204).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    content = body; exists = true; etag = '"two"';
    res.writeHead(201, { ETag: etag }).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/book/random-name`;
  const fetch = guardedDavFetch();
  try {
    const result = await updateVCard({ vCard: { url, data: card + '\r\n', etag }, fetch });
    assert.equal(result.headers.get('etag'), '"two"');
    await assert.rejects(updateVCard({ vCard: { url, data: 'stale-client', etag: '"one"' }, fetch }), { status: 409 });
    assert.equal(content, card + '\r\n');
    await assert.rejects(createVCard({ addressBook: { url: url + '/' }, filename: 'new.vcf', vCardString: card, fetch }), { status: 409 });
    await assert.rejects(deleteVCard({ vCard: { url, etag: '"one"' }, fetch }), { status: 409 });
    assert.equal(exists, true);
    await deleteVCard({ vCard: { url, etag }, fetch });
    await assert.rejects(updateVCard({ vCard: { url, data: card, etag }, fetch }), { status: 409 });
    assert.equal(exists, false);
    assert.equal(requests[0].match, '"one"');
    assert.equal(requests[2].none, '*');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});


test('transport receives timeout and redirect protection on writes', async () => {
  const guarded = guardedDavFetch(async (_input, init) => {
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(null, { status: 204 });
  });
  await guarded('https://dav.invalid/test', { method: 'DELETE', headers: { 'If-Match': '"one"' } });
});
