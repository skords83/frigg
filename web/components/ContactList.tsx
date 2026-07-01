'use client';

import { useRef } from 'react';
import type { Contact } from '@/types/contact';
import { ContactRow } from './ContactRow';
import { IndexRail } from './IndexRail';

interface GroupedContacts {
  letter: string;
  contacts: Contact[];
}

interface ContactListProps {
  contacts: Contact[];
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  search: string;
  onSearchChange: (q: string) => void;
  onNew: () => void;
}

export function ContactList({ contacts, selectedUid, onSelect, search, onSearchChange, onNew }: ContactListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const letterRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const filtered = contacts.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.fn.toLowerCase().includes(q) ||
      c.given_name.toLowerCase().includes(q) ||
      c.family_name.toLowerCase().includes(q) ||
      c.org?.toLowerCase().includes(q) ||
      c.emails.some((e) => e.value.toLowerCase().includes(q)) ||
      c.phones.some((p) => p.value.includes(q))
    );
  });

  const grouped = groupByLetter(filtered);
  const available = new Set(grouped.map((g) => g.letter));

  function scrollToLetter(letter: string) {
    const el = letterRefs.current.get(letter);
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    }
  }

  return (
    <div className="bg-bg border-r border-divider-soft flex flex-col overflow-hidden">
      {/* Search + New */}
      <div className="px-4 pt-[18px] pb-3 flex gap-2 items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Suchen …"
          aria-label="Kontakte suchen"
          className="flex-1 bg-surface border border-divider-soft rounded-lg px-3 py-2 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:border-accent-dim"
        />
        <button
          onClick={onNew}
          title="Neuer Kontakt"
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-divider-soft text-muted hover:border-accent-dim hover:text-accent transition-colors text-[20px] leading-none pb-0.5"
        >
          +
        </button>
      </div>

      {/* List + index rail */}
      <div className="flex flex-1 overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {grouped.length === 0 && (
            <p className="text-muted text-[13px] px-4 py-8 text-center">Keine Kontakte gefunden</p>
          )}
          {grouped.map(({ letter, contacts: group }) => (
            <div key={letter}>
              <div
                ref={(el) => { if (el) letterRefs.current.set(letter, el); }}
                className="font-mono text-[10.5px] tracking-widest text-accent-dim px-4 pt-3.5 pb-1.5"
                aria-hidden="true"
              >
                {letter}
              </div>
              {group.map((c) => (
                <ContactRow
                  key={c.uid}
                  contact={c}
                  selected={c.uid === selectedUid}
                  onClick={() => onSelect(c.uid)}
                />
              ))}
            </div>
          ))}
        </div>
        <IndexRail available={available} onSelect={scrollToLetter} />
      </div>
    </div>
  );
}

function groupByLetter(contacts: Contact[]): GroupedContacts[] {
  const sorted = [...contacts].sort((a, b) =>
    (a.family_name || a.fn).localeCompare(b.family_name || b.fn, 'de', { sensitivity: 'base' })
  );

  const map = new Map<string, Contact[]>();
  for (const c of sorted) {
    const raw = (c.family_name || c.fn || '?')[0].toUpperCase();
    const letter = /[A-Z]/.test(raw) ? raw : '#';
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(c);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([letter, contacts]) => ({ letter, contacts }));
}
