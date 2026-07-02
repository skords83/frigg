'use client';

import { useState, useMemo } from 'react';
import type { Contact } from '@/types/contact';
import { findDuplicates, type DuplicatePair } from './dedup';
import { useModalClose } from './form-helpers';

interface DedupModalProps {
  contacts: Contact[];
  onMerge: (keep: Contact, discard: Contact) => Promise<void>;
  onClose: () => void;
}

export function DedupModal({ contacts, onMerge, onClose }: DedupModalProps) {
  const pairs = useMemo(() => findDuplicates(contacts), [contacts]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState<string | null>(null);
  const { closing, requestClose } = useModalClose(onClose);

  const visible = pairs.filter((p) => !dismissed.has(pairKey(p)));

  async function handleMerge(pair: DuplicatePair, keepA: boolean) {
    const key = pairKey(pair);
    setMerging(key);
    const [keep, discard] = keepA ? [pair.a, pair.b] : [pair.b, pair.a];
    try {
      await onMerge(keep, discard);
      setDismissed((prev) => new Set([...prev, key]));
    } finally {
      setMerging(null);
    }
  }

  function dismiss(pair: DuplicatePair) {
    setDismissed((prev) => new Set([...prev, pairKey(pair)]));
  }

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`modal-panel bg-surface w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl shadow-2xl overflow-hidden ${closing ? 'closing' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <div>
            <h2 className="font-fraunces text-[18px] font-medium">Mögliche Duplikate</h2>
            <p className="text-[12px] text-muted mt-0.5">
              {visible.length === 0
                ? 'Keine Duplikate gefunden'
                : `${visible.length} Paare gefunden`}
            </p>
          </div>
          <button
            onClick={() => requestClose()}
            className="press text-muted hover:text-foreground w-7 h-7 flex items-center justify-center rounded-full hover:bg-divider"
          >✕</button>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {visible.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-[32px] mb-3">✓</p>
              <p className="text-muted text-[14px]">Keine Duplikate gefunden.</p>
            </div>
          ) : (
            visible.map((pair) => {
              const key = pairKey(pair);
              const busy = merging === key;
              return (
                <div key={key} className="border-b border-divider-soft px-6 py-4">
                  {/* Confidence */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full ${
                            i < Math.round(pair.score * 5) ? 'bg-accent' : 'bg-divider'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="font-mono text-[10.5px] text-muted">{pair.reasons.join(' · ')}</span>
                  </div>

                  {/* Side by side */}
                  <div className="grid grid-cols-2 gap-4">
                    <ContactCard contact={pair.a} />
                    <ContactCard contact={pair.b} />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-3 items-center">
                    <span className="text-[12px] text-muted mr-1">Behalten:</span>
                    <button
                      onClick={() => handleMerge(pair, true)}
                      disabled={busy}
                      className="px-3 py-1 text-[12px] rounded-md border border-divider hover:bg-surface-raised hover:text-foreground text-muted transition-colors disabled:opacity-50"
                    >
                      {pair.a.fn || `${pair.a.given_name} ${pair.a.family_name}`.trim()}
                    </button>
                    <button
                      onClick={() => handleMerge(pair, false)}
                      disabled={busy}
                      className="px-3 py-1 text-[12px] rounded-md border border-divider hover:bg-surface-raised hover:text-foreground text-muted transition-colors disabled:opacity-50"
                    >
                      {pair.b.fn || `${pair.b.given_name} ${pair.b.family_name}`.trim()}
                    </button>
                    <button
                      onClick={() => dismiss(pair)}
                      disabled={busy}
                      className="ml-auto text-[12px] text-muted hover:text-foreground transition-colors"
                    >Ignorieren</button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-6 py-3 border-t border-divider shrink-0 flex justify-end">
          <button
            onClick={() => requestClose()}
            className="press px-4 py-1.5 rounded-md text-[13px] text-muted hover:text-foreground hover:bg-surface-raised transition-colors"
          >Schließen</button>
        </div>
      </div>
    </div>
  );
}

function ContactCard({ contact }: { contact: Contact }) {
  return (
    <div className="bg-surface-raised rounded-lg p-3 text-[12px] space-y-1">
      <p className="font-medium text-[13px]">
        {contact.fn || `${contact.given_name ?? ''} ${contact.family_name ?? ''}`.trim() || '–'}
      </p>
      {contact.org && <p className="text-muted">{contact.org}</p>}
      {contact.emails.slice(0, 2).map((e, i) => (
        <p key={i} className="text-muted font-mono text-[11px]">{e.value}</p>
      ))}
      {contact.phones.slice(0, 2).map((p, i) => (
        <p key={i} className="text-muted font-mono text-[11px]">{p.value}</p>
      ))}
    </div>
  );
}

function pairKey(pair: DuplicatePair): string {
  return [pair.a.uid, pair.b.uid].sort().join(':');
}
