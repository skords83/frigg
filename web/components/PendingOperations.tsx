'use client';
import {useState,useEffect} from 'react';
import {ActionButton} from './form-helpers';
import {OperationReview,type OperationPreview} from './OperationReview';
export function PendingOperations({onComplete}:{onComplete:()=>void}) {
  const [items,setItems]=useState<{id:string;kind:string;status:string;name:string;last_error:string|null}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [review,setReview]=useState<OperationPreview|null>(null);
  async function open(id:string) {const res=await fetch(`/api/operations/${id}`);if(res.ok)setReview(await res.json());}
  const refresh=()=>fetch('/api/operations').then(r=>r.ok?r.json():[]).then(setItems).catch(()=>{});
  useEffect(()=>{void refresh();const id=setInterval(refresh,15_000);return()=>clearInterval(id);},[]);
  async function act(id:string,action:string) {
    setBusy(true);setError('');
    try {
      const res=await fetch(`/api/operations/${id}/${action}`,{method:'POST'});
      if(!res.ok) throw new Error();
      await refresh();onComplete();
    } catch {setError('Vorgang bleibt offen. Die Serverversionen stimmen möglicherweise nicht mehr mit der Vorschau überein.');} finally {setBusy(false);}
  }
  if(!items.length)return null;
  if(review)return <div className="modal-backdrop fixed inset-0 z-50 bg-black/40 flex items-center justify-center"><div className="modal-panel bg-surface rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"><OperationReview initial={review} onCancel={()=>{setReview(null);void refresh();}} onComplete={()=>{setReview(null);void refresh();onComplete();}}/></div></div>;
  return <aside aria-label="Offene Vorgänge" className="fixed bottom-3 right-3 z-40 max-w-sm bg-surface-raised border border-divider rounded-lg p-3 shadow-lg space-y-2">
    <h3 className="font-mono text-[11px]">Offene Vorgänge</h3>
    {items.map(item=><div key={item.id} className="text-[12px] space-y-2"><p>{item.kind==='merge'?'Zusammenführen':'Verschieben'}: {item.name}</p>
      {item.status==='prepared'&&item.kind==='merge'&&<ActionButton label="Vorschau öffnen" disabled={busy} onClick={()=>open(item.id)}/>}
      {item.status==='prepared'&&item.kind==='move'&&<ActionButton label="Prüfen und fortsetzen" disabled={busy} onClick={()=>act(item.id,'execute')}/>}
      {item.status==='prepared'?<ActionButton label="Vorbereitung abbrechen" disabled={busy} onClick={()=>act(item.id,'cancel')}/>:<ActionButton label="Prüfen und fortsetzen" disabled={busy} onClick={()=>act(item.id,'execute')}/>}
      {['writing','target_verified'].includes(item.status)&&<ActionButton label="Beide Kopien behalten" disabled={busy} onClick={()=>act(item.id,'cancel')}/>}</div>)}
    {error&&<p role="alert" className="text-[12px] text-muted">{error}</p>}
  </aside>;
}
