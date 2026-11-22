'use client';
import { useState } from 'react';
import { ActionButton } from './form-helpers';
import type { Contact } from '../types/contact';
export interface OperationPreview {
  id: string; kind: 'move'|'merge'; status: string; unresolved:boolean;
  rows: {property:string;a:string[];b:string[];result:string[];conflict:boolean;blocked:boolean}[];
  source:Contact & {photo_data_uri?:string|null}; target:(Contact & {photo_data_uri?:string|null})|null; result:Contact & {photo_data_uri?:string|null};
}
const labels:Record<string,string>={FN:'Anzeigename',N:'Namensbestandteile',TEL:'Telefonnummern',EMAIL:'E-Mail-Adressen',ADR:'Anschriften',ORG:'Organisationen',NOTE:'Notizen',PHOTO:'Foto',BDAY:'Geburtstag',TITLE:'Titel',URL:'Webseiten'};
function values(name:string, lines:string[]) { return name==='PHOTO' ? lines.length ? 'Foto vorhanden' : 'Kein Foto' : lines.join('\n') || '–'; }

export function OperationReview({initial,onComplete,onCancel}:{initial:OperationPreview;onComplete:(contact:Contact)=>void;onCancel:()=>void}) {
  const [preview,setPreview]=useState(initial);
  const [choices,setChoices]=useState<Record<string,'a'|'b'>>({});
  const [dirty,setDirty]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState('');
  async function updatePreview() {
    setBusy(true);setError('');
    try {
      const res=await fetch(`/api/operations/${preview.id}/preview`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({choices})});
      if(!res.ok) throw new Error();
      setPreview(await res.json());setDirty(false);
    } catch {setError('Vorschau konnte nicht aktualisiert werden. Beide Kontakte bleiben erhalten.');} finally {setBusy(false);}
  }
  async function execute() {
    setBusy(true);setError('');
    try {
      const res=await fetch(`/api/operations/${preview.id}/execute`,{method:'POST'});
      if(!res.ok) throw new Error();
      const result=await res.json();onComplete(result.contact);
    } catch {setError('Vorgang nicht abgeschlossen. Vorhandene Kopien bleiben erhalten. Du kannst den Vorgang über „Offene Vorgänge“ erneut prüfen und fortsetzen.');} finally {setBusy(false);}
  }
  async function cancel() {
    setBusy(true);
    try {
      const res=await fetch(`/api/operations/${preview.id}/cancel`,{method:'POST'});
      if(!res.ok) {setError('Der Vorgang wurde bereits begonnen. Bitte über „Offene Vorgänge“ fortsetzen.');return;}
      onCancel();
    } finally {setBusy(false);}
  }
  return <div className="p-5 space-y-4">
    <h3 className="font-fraunces text-[16px]">Zusammenführung prüfen</h3>
    <p className="text-[13px] text-muted">Ziel: {preview.target?.fn}. Zusätzliche Werte werden übernommen. Bei widersprüchlichen Einzelwerten entscheidest du ausdrücklich. Die Quelle wird erst nach Prüfung des gespeicherten Ergebnisses entfernt.</p>
    {preview.rows.map(row=><fieldset key={row.property} disabled={busy} className="border border-divider rounded-lg p-3 space-y-2">
      <legend className="font-mono text-[11px] px-1">{labels[row.property]??row.property}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px] whitespace-pre-wrap break-all">
        <div><p className="font-mono text-[10px] text-muted">ZIEL A</p><span>{values(row.property,row.a)}</span></div>
        <div><p className="font-mono text-[10px] text-muted">QUELLE B</p><span>{values(row.property,row.b)}</span></div>
        <div><p className="font-mono text-[10px] text-muted">ERGEBNIS</p><span>{dirty?'Vorschau bitte aktualisieren':values(row.property,row.result)}</span></div>
      </div>
      {row.property==='PHOTO'&&<div className="flex gap-3">{[preview.target,preview.source,preview.result].map((c,i)=>c?.photo_data_uri?<img key={i} src={c.photo_data_uri} alt={['Foto A','Foto B','Ergebnisfoto'][i]} className="w-16 h-16 rounded-full object-cover"/>:<span key={i} className="w-16 text-[12px]">Kein Foto</span>)}</div>}
      {row.blocked ? <p className="text-[13px] text-muted">Diese unbekannten Angaben lassen sich nicht sicher vereinigen. Die Zusammenführung ist gesperrt.</p> : row.conflict && <div className="flex gap-3 text-[13px]">
        <label><input className="accent-accent" type="radio" name={`merge-${row.property}`} checked={choices[row.property]==='a'} onChange={()=>{setChoices({...choices,[row.property]:'a'});setDirty(true);}} /> Wert A verwenden</label>
        <label><input className="accent-accent" type="radio" name={`merge-${row.property}`} checked={choices[row.property]==='b'} onChange={()=>{setChoices({...choices,[row.property]:'b'});setDirty(true);}} /> Wert B verwenden</label>
      </div>}
    </fieldset>)}
    {error&&<p role="alert" className="text-[13px] text-muted">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <ActionButton label="Abbrechen" onClick={cancel} disabled={busy}/>
      {dirty&&<ActionButton label="Vorschau aktualisieren" onClick={updatePreview} disabled={busy}/>}
      <ActionButton label="Zusammenführung bestätigen" variant="primary" onClick={execute} disabled={busy||dirty||preview.unresolved}/>
    </div>
  </div>;
}
