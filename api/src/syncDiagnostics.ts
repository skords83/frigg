import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import { DavError } from './davSafety';

type Mode = 'sync' | 'read_only';
type Reason = 'document_parse_failed' | 'vcf_parse_failed' | 'uid_href_conflict' | 'missing_resource' | 'invalid_resource' | 'multiget_incomplete' | 'pending_operation' | 'dav_exception' | 'database_exception' | 'unexpected_exception' | 'projected_uid_null' | 'href_unique_conflict';
type Phase = 'discovery' | 'listing' | 'native_read' | 'parse' | 'upsert' | 'cleanup' | 'markers' | 'metadata' | 'preflight';
const safeCodes = new Set(['invalid_vcard', 'unsupported_vcard_version', 'invalid_uid', 'resource_unavailable', 'native_vcard_unavailable', 'valid_etag_required', 'invalid_collection_response', 'collection_unavailable', 'collection_changed', 'invalid_resource_url', 'sync_required', 'dav_unavailable', 'dav_read_failed', '23502', '23503', '23505', '22P02', '22021', '25006', '42501', '08006', '53300', '57014', 'diagnostic_key_required', 'database_configuration_required']);
const context = new AsyncLocalStorage<Diagnostics>();

export function diagnosticKey(): string | undefined {
  const key = process.env.SYNC_DIAGNOSTICS_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) return undefined;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (encryptionKey && Buffer.from(key, 'hex').equals(Buffer.from(encryptionKey, 'base64'))) return undefined;
  return key;
}

export class Diagnostics {
  readonly run = randomUUID();
  listed: number | null = null;
  upserts = 0;
  eligible = 0;
  markers: 'unchanged' | 'advanced' | 'write_failed' = 'unchanged';
  readonly errors: Partial<Record<Reason, number>> = {};
  private readonly seen = new Set<unknown>();
  constructor(readonly book: string, readonly mode: Mode = 'sync', private readonly key = diagnosticKey()) {}
  private ref(domain: string, value: string): string | undefined {
    return this.key ? createHmac('sha256', Buffer.from(this.key, 'hex')).update(domain + '\0' + value).digest('hex') : undefined;
  }
  private emit(fields: object) {
    // Diagnostics must never change synchronization control flow, even if logging fails.
    try { console.log(JSON.stringify({ event: 'sync_diagnostic', run_id: this.run, mode: this.mode, book_ref: this.ref('book', this.book), ...fields })); } catch { /* best effort */ }
  }
  failure(reason: Reason, phase: Phase, href?: string, code?: string) {
    this.errors[reason] = (this.errors[reason] ?? 0) + 1;
    this.emit({ type: 'failure', reason, phase, resource_ref: href ? this.ref('resource', this.book + '\0' + href) : undefined, code: code && safeCodes.has(code) ? code : undefined });
  }
  exception(err: unknown, phase: Phase, href?: string) {
    if (this.seen.has(err)) return;
    this.seen.add(err);
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    const database = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) || phase === 'upsert' || phase === 'cleanup' || phase === 'markers' || phase === 'metadata';
    this.failure(err instanceof DavError ? 'dav_exception' : database ? 'database_exception' : 'unexpected_exception', phase, href, typeof code === 'string' ? code : undefined);
  }
  summary() {
    this.emit({ type: 'book_summary', listed_resources: this.listed, successful_upserts: this.upserts, eligible_resources: this.eligible, errors_by_category: this.errors, markers: this.markers, references_enabled: !!this.key });
  }
}
export function diagnostics(): Diagnostics | undefined { return context.getStore(); }
export async function diagnosticBook<T>(book: string, task: () => Promise<T>, mode: Mode = 'sync'): Promise<T> {
  if (context.getStore()) {
    try { return await task(); }
    catch (err) { context.getStore()!.exception(err, 'discovery'); throw err; }
  }
  const diagnostic = new Diagnostics(book, mode);
  return context.run(diagnostic, async () => {
    try { return await task(); }
    catch (err) { diagnostic.exception(err, mode === 'sync' ? 'metadata' : 'discovery'); throw err; }
    finally { diagnostic.summary(); }
  });
}
export async function diagnosticStep<T>(phase: Phase, task: () => Promise<T>, href?: string): Promise<T> {
  try { return await task(); }
  catch (err) { diagnostics()?.exception(err, phase, href); throw err; }
}
export function safeSyncException(err: unknown, mode: Mode = 'sync') { new Diagnostics('process', mode).exception(err, 'discovery'); }
