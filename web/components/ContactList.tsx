'use client';

import { useRef, useMemo } from 'react';
import Fuse from 'fuse.js';
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
  view?: 'default' | 'birthday';
}

export function ContactList({ contacts, selectedUid, onSelect, search, onSearchChange, onNew, view = 'default' }: ContactListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const letterRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const fuse = useMemo(() => new Fuse(contacts, {
    keys: [
      { name: 'family_name', weight: 3 },
      { name: 'given_name', weight: 2 },
      { name: 'fn', weight: 2 },
      { name: 'org', weight: 1 },
      { name: 'emails.value', weight: 1 },
      { name: 'phones.value', weight: 1 },
    ],
    threshold: 0.35,
    includeScore: true,
    ignoreLocation: true,
  }), [contacts]);

  const filtered = useMemo(() => {
    if (!search) return contacts;
    return fuse.search(search).map((r) => r.item);
  }, [contacts, search, fuse]);

  const grouped = search ? null : groupByLetter(filtered);
  const available = new Set(grouped?.map((g) => g.letter) ?? []);

  function scrollToLetter(letter: string) {
    const el = letterRefs.current.get(letter);
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    }
  }

  const searchBar = (
    <div className="px-4 pt-[18px] pb-3 flex gap-2 items-center">
      <div className="relative flex-1">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Suchen …"
          aria-label="Kontakte suchen"
          className="w-full bg-surface border border-divider-soft rounded-lg px-3 py-2 pr-7 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:border-accent focus:shadow-[0_0_0_1px_var(--accent)] transition-shadow"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            aria-label="Suche löschen"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors text-[16px] leading-none"
          >
            ×
          </button>
        )}
      </div>
      <button
        onClick={onNew}
        title="Neuer Kontakt"
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-divider-soft text-muted hover:border-accent-dim hover:text-accent transition-colors text-[20px] leading-none pb-0.5"
      >
        +
      </button>
    </div>
  );

  if (view === 'birthday') {
    const items = filtered
      .filter((c) => c.birthday)
      .map((c) => ({ contact: c, days: daysUntilBirthday(c.birthday!) }))
      .sort((a, b) => a.days - b.days);

    const monthGroups = new Map<string, typeof items>();
    for (const item of items) {
      const parsed = parseBirthday(item.contact.birthday!);
      if (!parsed) continue;
      const key = new Date(2000, parsed.month - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
      if (!monthGroups.has(key)) monthGroups.set(key, []);
      monthGroups.get(key)!.push(item);
    }

    return (
      <div className="bg-bg border-r border-divider-soft flex flex-col overflow-hidden">
        {searchBar}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 && (
            <p className="text-muted text-[13px] px-4 py-8 text-center">Keine Geburtstage gefunden</p>
          )}
          {Array.from(monthGroups).map(([month, group]) => (
            <div key={month}>
              <div className="font-mono text-[10.5px] tracking-widest text-accent-dim px-4 pt-3.5 pb-1.5" aria-hidden="true">
                {month}
              </div>
              {group.map(({ contact, days }) => (
                <ContactRow
                  key={contact.uid}
                  contact={contact}
                  selected={contact.uid === selectedUid}
                  onClick={() => onSelect(contact.uid)}
                  subOverride={birthdaySubLabel(contact.birthday!, days)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg border-r border-divider-soft flex flex-col overflow-hidden">
      {searchBar}
      {search ? (
        /* Fuzzy search results — flat, ranked by relevance */
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-muted text-[13px] px-4 py-8 text-center">Keine Kontakte gefunden</p>
          )}
          {filtered.map((c) => (
            <ContactRow
              key={c.uid}
              contact={c}
              selected={c.uid === selectedUid}
              onClick={() => onSelect(c.uid)}
            />
          ))}
        </div>
      ) : (
        /* Normal grouped view + index rail */
        <div className="flex flex-1 overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {(grouped ?? []).length === 0 && (
              <p className="text-muted text-[13px] px-4 py-8 text-center">Keine Kontakte gefunden</p>
            )}
            {(grouped ?? []).map(({ letter, contacts: group }, idx) => (
              <div key={letter}>
                <div
                  ref={(el) => { if (el) letterRefs.current.set(letter, el); }}
                  className={`font-mono text-[10.5px] tracking-widest text-accent-dim px-4 pb-1.5 ${idx === 0 ? 'pt-3.5' : 'pt-3 mt-1 border-t border-divider-soft'}`}
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
      )}
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

function parseBirthday(raw: string): { month: number; day: number } | null {
  // YYYY-MM-DD or --MM-DD
  let m = raw.match(/^(?:\d{4}|--)[-–](\d{2})[-–](\d{2})$/);
  if (m) return { month: parseInt(m[1]), day: parseInt(m[2]) };
  // YYYYMMDD
  m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { month: parseInt(m[2]), day: parseInt(m[3]) };
  // --MMDD
  m = raw.match(/^--(\d{2})(\d{2})$/);
  if (m) return { month: parseInt(m[1]), day: parseInt(m[2]) };
  return null;
}

function daysUntilBirthday(raw: string): number {
  const parsed = parseBirthday(raw);
  if (!parsed) return 999;
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(today.getFullYear(), parsed.month - 1, parsed.day);
  if (next < todayMidnight) next = new Date(today.getFullYear() + 1, parsed.month - 1, parsed.day);
  return Math.round((next.getTime() - todayMidnight.getTime()) / 86400000);
}

function birthdaySubLabel(raw: string, days: number): string {
  const parsed = parseBirthday(raw);
  if (!parsed) return '';
  const dateStr = new Date(2000, parsed.month - 1, parsed.day)
    .toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  if (days === 0) return `heute · ${dateStr}`;
  if (days === 1) return `morgen · ${dateStr}`;
  return `in ${days} Tagen · ${dateStr}`;
}
