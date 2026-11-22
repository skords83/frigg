'use client';

import { useState,useEffect } from 'react';
import type { ContactGroup,AddressBook } from '@/types/contact';
import { useModalClose } from './form-helpers';

interface ManualGroupModalProps {
  initial?: ContactGroup;
  addressbooks?: AddressBook[];
  onSave: (name: string,options?:{addressbook_id:string;format:'vcard4'|'apple'}) => Promise<boolean | void>;
  onClose: () => void;
}

const inputCls = 'bg-surface-raised border border-divider rounded-md px-2 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent';

export function ManualGroupModal({ initial, addressbooks = [], onSave, onClose }: ManualGroupModalProps) {
  const [book,setBook]=useState('');
  const [format,setFormat]=useState<'vcard4'|'apple'>('vcard4');
  const [formats,setFormats]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;setFormats([]);if(book)fetch(`/api/carddav-groups/capabilities?addressbook_id=${encodeURIComponent(book)}`).then(r=>r.ok?r.json():{formats:[]}).then(result=>{if(active){setFormats(result.formats);if(result.formats.length)setFormat(result.formats[0]);}}).catch(()=>{});return()=>{active=false;};},[book]);
  const [name, setName] = useState(initial?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const { closing, requestClose } = useModalClose(onClose);

  async function handleSave() {
    if (busy || initial?.format === 'unknown') return;
    if (!name.trim()) { setError('Bitte einen Namen angeben.'); return; }
    if(book&&!formats.includes(format)){setError('Dieses Gruppenformat wird vom Server nicht bestätigt.');return;}
    setBusy(true);
    try {const saved=await onSave(name.trim(),book?{addressbook_id:book,format}:undefined);if(saved!==false)requestClose();else setError('Speichern nicht bestätigt. Bitte die aktuelle Gruppe prüfen.');}
    catch{setError('Server nicht erreichbar.');}finally{setBusy(false);}
  }

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`modal-panel bg-surface w-full max-w-sm rounded-xl shadow-2xl overflow-hidden flex flex-col ${closing ? 'closing' : ''}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <h2 className="font-fraunces text-[18px] font-medium">
            {initial ? 'Gruppe umbenennen' : 'Neue Gruppe'}
          </h2>
          <button
            onClick={() => requestClose()}
            className="press text-muted hover:text-foreground w-7 h-7 flex items-center justify-center rounded-full hover:bg-divider"
          >✕</button>
        </div>

        <div className="px-6 py-5 space-y-1.5">
          {!initial&&<div className="space-y-2 pb-3">
            <label className="font-mono text-[10px] tracking-widest uppercase text-muted" htmlFor="group-storage">Speicherort</label>
            <select id="group-storage" className={inputCls+' w-full'} value={book} onChange={e=>setBook(e.target.value)}>
              <option value="">Lokal in Frigg</option>{addressbooks.map(b=><option key={b.id} value={b.id}>Synchronisiert · {b.display_name}</option>)}
            </select>
            {book&&<><label className="text-[12px] text-muted" htmlFor="group-format">Gruppenformat</label><select id="group-format" className={inputCls+' w-full'} value={format} onChange={e=>setFormat(e.target.value as 'vcard4'|'apple')}>
              {formats.includes('vcard4')&&<option value="vcard4">vCard 4 · KIND/MEMBER</option>}{formats.includes('apple')&&<option value="apple">Apple · vCard 3</option>}
            </select><p className="text-[12px] text-muted">In DAVx⁵ „Gruppen sind separate vCards“ verwenden. Bestehende lokale Gruppen bleiben unverändert.</p>{!formats.length&&<p className="text-[12px] text-muted">Kein beschreibbares Gruppenformat bestätigt.</p>}</>}
          </div>}
          {!!initial?.unresolved_members?.length&&<p className="text-[12px] text-muted">{initial.unresolved_members.length} Mitglieder sind nicht zugeordnet. Ihre Referenzen bleiben unverändert.</p>}
          {initial?.format==='unknown'&&<p className="text-[12px] text-muted">Unbekanntes Gruppenformat. Änderungen sind gesperrt.</p>}
          {initial?.kind==='carddav'&&<p className="text-[12px] text-muted">Synchronisierte CardDAV-Gruppe</p>}
          <label className="font-mono text-[10px] tracking-widest uppercase text-muted">Name</label>
          <input
            className={inputCls + ' w-full'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            placeholder="z.B. Familie, Kollegen, VIPs …"
            autoFocus
          />
          {error && <p className="text-red-400 text-[12px] pt-1">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-divider shrink-0">
          <button
            onClick={() => requestClose()}
            className="press px-4 py-1.5 rounded-md text-[13px] text-muted hover:text-foreground hover:bg-surface-raised transition-colors"
          >Abbrechen</button>
          <button
            onClick={handleSave}
            disabled={busy||!!book&&!formats.includes(format)||initial?.format==='unknown'}
            className="press px-4 py-1.5 rounded-md text-[13px] bg-accent text-white hover:bg-accent-dim transition-colors"
          >Speichern</button>
        </div>
      </div>
    </div>
  );
}
