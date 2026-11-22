import { createDAVClient } from 'tsdav';
import VCF from 'vcf';
import { projectDocument } from './vcardDocument';
import { DavError, requireEtag, guardedDavFetch, resourceUrl } from './davSafety';
import type { PhoneEntry, EmailEntry, AddressEntry } from './types';
import { query } from './db';
import { decryptSecret } from './crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DAVClientInstance = any;

interface CardDavAccountRow {
  id: string;
  carddav_url: string;
  username: string;
  password_encrypted: string;
  password_iv: string;
  password_auth_tag: string;
}

// One DAVClient per carddav_accounts row, cached for the process lifetime.
// invalidateAccountClient() must be called whenever a row's credentials change.
const clientCache = new Map<string, DAVClientInstance>();

async function buildClient(account: CardDavAccountRow): Promise<DAVClientInstance> {
  const password = decryptSecret({
    ciphertext: account.password_encrypted,
    iv: account.password_iv,
    authTag: account.password_auth_tag,
  });
  const client = await createDAVClient({
    serverUrl: account.carddav_url,
    credentials: { username: account.username, password },
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
    fetch: guardedDavFetch(),
  });
  return withNativeCards(client);
}

export function withNativeCards(client: DAVClientInstance): DAVClientInstance {
  // Baïkal/sabre converts GET and multiget bodies to vCard 3 by default,
  // even while returning the ETag of the stored vCard 4 resource. Its direct
  // address-data property exposes the original representation without conversion.
  // Fail closed on servers without this capability; a converted card must never
  // become the baseline for a supposedly lossless edit.
  const nativeClient = Object.assign(client, {
    readVCard: async (url: string) => {
      const responses = await client.propfind({
        url, depth: '0', props: { 'card:address-data': {}, 'd:getetag': {} },
      });
      if (responses.length === 1 && responses[0].status === 404) return null;
      if (responses.length !== 1 || !responses[0].ok) throw new DavError(503, 'resource_unavailable');
      const props = responses[0].props;
      const raw = props?.addressData?._cdata ?? props?.addressData;
      const etag = props?.getetag;
      if (typeof raw !== 'string' || !raw) throw new DavError(422, 'native_vcard_unavailable');
      requireEtag(etag);
      return { raw, etag };
    },
  });
  // tsdav's fetchVCards maps away DAV error statuses and can turn a failed
  // collection query into an empty list. Never use such a list for deletions.
  return Object.assign(nativeClient, {
    fetchVCards: async ({ addressBook }: { addressBook: { url: string } }) => {
      const responses = await client.addressBookQuery({url:addressBook.url,depth:'1',props:{'d:getetag':{}}});
      if (!Array.isArray(responses) || !responses.length) throw new DavError(503,'invalid_collection_response');
      const cards = [];
      for (const response of responses) {
        if (!response.ok || response.error) throw new DavError(503,'collection_unavailable');
        // tsdav represents a valid, empty DAV multistatus by this sentinel.
        if (!response.href && response.status === 207 && !response.raw) continue;
        if (!response.href || !response.raw?.multistatus) throw new DavError(503,'invalid_collection_response');
        const url = resourceUrl(addressBook.url,response.href);
        const native = await nativeClient.readVCard(url);
        if (!native) throw new DavError(409,'collection_changed');
        cards.push({url,data:native.raw,etag:native.etag});
      }
      return cards;
    },
  });
}

export async function getClientForAccount(accountId: string): Promise<DAVClientInstance> {
  const cached = clientCache.get(accountId);
  if (cached) return cached;

  const [account] = await query<CardDavAccountRow>(
    `SELECT id, carddav_url, username, password_encrypted, password_iv, password_auth_tag
     FROM carddav_accounts WHERE id = $1`,
    [accountId]
  );
  if (!account) throw new Error(`carddav_accounts row ${accountId} not found`);

  const client = await buildClient(account);
  clientCache.set(accountId, client);
  return client;
}

export async function getClientForAddressbook(addressbookId: string): Promise<DAVClientInstance> {
  const [row] = await query<{ carddav_account_id: string | null }>(
    `SELECT carddav_account_id FROM addressbooks WHERE id = $1`,
    [addressbookId]
  );
  if (!row?.carddav_account_id) {
    throw new Error(`addressbook ${addressbookId} has no linked CardDAV account`);
  }
  return getClientForAccount(row.carddav_account_id);
}

export function invalidateAccountClient(accountId: string): void {
  clientCache.delete(accountId);
}

// Splits a multi-card vCard blob (e.g. an imported .vcf file with several
// contacts concatenated) into individual per-card raw strings, each of which
// can be fed to parseVCard() on its own.
export function splitVCards(raw: string): string[] {
  const cards: string[] = [];
  let current: string[] | null = null;
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if (/^BEGIN:VCARD$/i.test(line)) {
      if (current) throw new Error('Invalid vCard collection');
      current = [line];
    } else if (/^END:VCARD$/i.test(line)) {
      if (!current) throw new Error('Invalid vCard collection');
      current.push(line); cards.push(current.join('\r\n') + '\r\n'); current = null;
    } else if (current) current.push(line);
    else if (line.trim()) throw new Error('Invalid vCard collection');
  }
  if (current) throw new Error('Invalid vCard collection');
  return cards;
}

export interface ParsedCard {
  uid: string;
  fn: string;
  given_name: string;
  family_name: string;
  org: string | null;
  title: string | null;
  birthday: string | null;
  note: string | null;
  photo_data_uri: string | null;
  phones: PhoneEntry[];
  emails: EmailEntry[];
  addresses: AddressEntry[];
  raw_vcard: string;
}

export function parseVCard(raw: string): ParsedCard | null {
  try {
    // Preserve the original syntax; vcf remains a secondary interoperability check.
    const projected = projectDocument(raw);
    VCF.parse(raw.replace(/\r?\n/g, '\r\n'));
    return projected;
  } catch {
    return null;
  }
}

/** Preview checks improve feedback; the conditional write still enforces authority. */
export async function requireDavPrivilege(client: DAVClientInstance, url: string, privilege: 'bind'|'unbind'|'writeContent'): Promise<void> {
  const responses = await client.propfind({url,depth:'0',props:{'d:current-user-privilege-set':{}}});
  if (responses.length !== 1 || !responses[0].ok) throw new DavError(503,'privileges_unavailable');
  const value = responses[0].props?.currentUserPrivilegeSet?.privilege;
  const privileges = Array.isArray(value) ? value : value ? [value] : [];
  if (!privileges.some((entry: Record<string,unknown>) => 'all' in entry || 'write' in entry || privilege in entry)) {
    throw new DavError(403,'dav_forbidden');
  }
}
