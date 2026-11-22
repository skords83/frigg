import { DavError, requireEtag } from './davSafety';
import { readDocument } from './vcardDocument';

export interface Snapshot { book: string; bookUrl: string; id: string; url: string; uid: string; etag: string; raw: string }
export interface OperationPlan { source: Snapshot; target: Snapshot; result: string }
export type OperationStatus = 'prepared'|'writing'|'target_verified'|'source_deleted'|'complete'|'cancelled';
export interface Operation { id: string; kind: 'move'|'merge'; status: OperationStatus; plan: OperationPlan; target_etag: string | null }
export interface OperationIO {
  read(snapshot: Snapshot): Promise<{ raw:string; etag:string } | null>;
  write(snapshot: Snapshot, raw: string, create: boolean): Promise<void>;
  remove(snapshot: Snapshot): Promise<void>;
  checkpoint(status: OperationStatus, etag?: string): Promise<void>;
  commit(): Promise<void>;
}
// Permit only folding/newline changes. Any more aggressive transformation blocks deletion.
export function equivalentCard(a: string, b: string): boolean {
  const semantic = (raw: string) => readDocument(raw).map(l=>`${l.header}:${l.value}`);
  return JSON.stringify(semantic(a)) === JSON.stringify(semantic(b));
}

/** Persist intent before PUT; after a lost response reconcile by reading the fixed URL. */
export async function executeOperation(operation: Operation, io: OperationIO): Promise<void> {
  if (operation.status === 'complete') return;
  if (operation.status === 'cancelled') throw new DavError(409,'operation_cancelled');
  const { source, target, result } = operation.plan;
  requireEtag(source.etag);
  const currentSource = await io.read(source);
  if (currentSource && (currentSource.etag !== source.etag || !equivalentCard(currentSource.raw, source.raw))) throw new DavError(409,'source_changed');
  if (!currentSource && ['prepared','writing'].includes(operation.status)) throw new DavError(409,'source_missing');
  let currentTarget = await io.read(target);
  if (operation.status === 'prepared') {
    if (operation.kind === 'move' ? currentTarget !== null : !currentTarget || currentTarget.etag !== target.etag || !equivalentCard(currentTarget.raw,target.raw)) throw new DavError(409,'target_changed');
    await io.checkpoint('writing'); operation.status = 'writing';
  }
  if (operation.status === 'writing') {
    if (!currentTarget || !equivalentCard(currentTarget.raw, result)) {
      // Retry only the same conditional operation. A different target is never overwritten.
      if (operation.kind === 'move' && currentTarget) throw new DavError(409,'target_changed');
      if (operation.kind === 'merge' && (!currentTarget || currentTarget.etag !== target.etag)) throw new DavError(409,'target_changed');
      await io.write(target, result, operation.kind === 'move');
      currentTarget = await io.read(target);
    }
    if (!currentTarget || !equivalentCard(currentTarget.raw,result)) throw new DavError(409,'target_verification_failed');
    requireEtag(currentTarget.etag);
    await io.checkpoint('target_verified',currentTarget.etag); operation.status='target_verified'; operation.target_etag=currentTarget.etag;
  }
  if (!currentTarget || !equivalentCard(currentTarget.raw,result) || currentTarget.etag !== operation.target_etag) throw new DavError(409,'target_changed');
  if (operation.status === 'target_verified') {
    if (currentSource) await io.remove(source);
    await io.checkpoint('source_deleted'); operation.status='source_deleted';
  }
  await io.commit();
  await io.checkpoint('complete'); operation.status='complete';
}
