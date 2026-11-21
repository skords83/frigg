import { DavError, requireEtag } from './davSafety';

interface Card { url?: string; etag?: string; data?: string }
interface MoveClient {
  fetchVCards(args: { addressBook: { url: string }; objectUrls?: string[]; urlFilter: (url: string) => boolean }): Promise<Card[]>;
  createVCard(args: { addressBook: { url: string }; filename: string; vCardString: string }): Promise<Response>;
  deleteVCard(args: { vCard: { url: string; etag: string } }): Promise<Response>;
}

/** Conservative verification: normalization beyond folding/line endings fails closed. */
function unfolded(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').trimEnd();
}

export async function copyBeforeDelete(args: {
  source: MoveClient; target: MoveClient; sourceBook: string; targetBook: string;
  sourceUrl: string; uid: string; etag: string;
  uidOf: (data: string) => string | null;
}): Promise<{ etag: string; href: string; raw: string }> {
  requireEtag(args.etag);
  const read = (client: MoveClient, book: string, urls?: string[]) => client.fetchVCards({ addressBook: { url: book }, objectUrls: urls, urlFilter: () => true });
  const sources = await read(args.source, args.sourceBook, [args.sourceUrl]);
  const source = sources[0];
  if (sources.length !== 1 || !source?.data || source.etag !== args.etag || !source.url || new URL(source.url, args.sourceBook).href !== args.sourceUrl || args.uidOf(source.data) !== args.uid) {
    throw new DavError(409, 'conflict');
  }
  const filename = `${encodeURIComponent(args.uid)}.vcf`;
  const href = new URL(filename, args.targetBook).href;
  const targets = await read(args.target, args.targetBook);
  for (const card of targets) {
    if (!card.data || !card.url) throw new DavError(409, 'target_verification_failed');
    const uid = args.uidOf(card.data);
    if (!uid) throw new DavError(409, 'target_verification_failed');
    if (uid === args.uid || new URL(card.url, args.targetBook).href === href) throw new DavError(409, 'target_exists');
  }
  const created = await args.target.createVCard({ addressBook: { url: args.targetBook }, filename, vCardString: source.data });
  if (!created.ok) throw new DavError(502, 'dav_write_failed');
  // No rollback deletion: a timeout or transformed card leaves the source intact.
  const verified = await read(args.target, args.targetBook, [href]);
  const target = verified[0];
  if (verified.length !== 1 || !target?.url || new URL(target.url, args.targetBook).href !== href || !target.data || args.uidOf(target.data) !== args.uid || unfolded(target.data) !== unfolded(source.data)) {
    throw new DavError(409, 'target_verification_failed');
  }
  requireEtag(target.etag);
  const deleted = await args.source.deleteVCard({ vCard: { url: args.sourceUrl, etag: args.etag } });
  if (!deleted.ok) throw new DavError(409, 'source_delete_failed');
  return { etag: target.etag, href, raw: target.data };
}
