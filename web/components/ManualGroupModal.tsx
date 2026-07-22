'use client';

import { useState } from 'react';
import type { ContactGroup } from '@/types/contact';
import { useModalClose } from './form-helpers';

interface ManualGroupModalProps {
  initial?: ContactGroup;
  onSave: (name: string) => void;
  onClose: () => void;
}

const inputCls = 'bg-surface-raised border border-divider rounded-md px-2 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent';

export function ManualGroupModal({ initial, onSave, onClose }: ManualGroupModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const { closing, requestClose } = useModalClose(onClose);

  function handleSave() {
    if (!name.trim()) { setError('Bitte einen Namen angeben.'); return; }
    requestClose(() => onSave(name.trim()));
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
            className="press px-4 py-1.5 rounded-md text-[13px] bg-accent text-white hover:bg-accent-dim transition-colors"
          >Speichern</button>
        </div>
      </div>
    </div>
  );
}
