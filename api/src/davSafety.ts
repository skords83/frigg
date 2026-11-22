/** Transport guard: never let a failed or unconditional DAV write look successful. */
export class DavError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

export function isStrongEtag(value: unknown): value is string {
  return typeof value === 'string' && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}

export function requireEtag(value: unknown): asserts value is string {
  if (!isStrongEtag(value)) throw new DavError(428, 'valid_etag_required');
}

export function resourceUrl(bookUrl: string, href: string | null | undefined): string {
  if (!href) throw new DavError(409, 'sync_required');
  const book = new URL(bookUrl);
  const url = new URL(href, book);
  if (url.origin !== book.origin || !url.pathname.startsWith(book.pathname.endsWith('/') ? book.pathname : `${book.pathname}/`) || url.username || url.password || url.search || url.hash) {
    throw new DavError(409, 'invalid_resource_url');
  }
  return url.href;
}

export function guardedDavFetch(transport: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const writing = method === 'PUT' || method === 'DELETE';
    if (writing) {
      const headers = new Headers(init?.headers ?? request?.headers);
      if (!(method === 'PUT' && headers.get('if-none-match') === '*')) {
        requireEtag(headers.get('if-match'));
      }
    }
    let response: Response;
    try {
      response = await transport(input, {
        ...init,
        ...(writing ? { redirect: 'error' as const } : {}),
        signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
    } catch {
      // Deliberately omit response bodies, URLs, credentials and contact data.
      throw new DavError(503, 'dav_unavailable');
    }
    if (writing && (!response.ok || ![200, 201, 204].includes(response.status))) {
      if ([404, 409, 412].includes(response.status)) throw new DavError(409, 'conflict');
      if (response.status === 401 || response.status === 403) throw new DavError(403, 'dav_forbidden');
      throw new DavError(502, 'dav_write_failed');
    }
    if (!writing && !response.ok && response.status !== 404) {
      throw new DavError(response.status === 401 || response.status === 403 ? 403 : 503, 'dav_read_failed');
    }
    return response;
  };
}
