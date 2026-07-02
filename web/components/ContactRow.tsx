'use client';

import React from 'react';
import type { Contact } from '@/types/contact';
import { contactPhotoUrl } from '@/types/contact';
import { Seal, getInitials } from './Seal';

interface SearchMatch {
  key?: string;
  value?: string;
}

interface ContactRowProps {
  contact: Contact;
  selected: boolean;
  onSelect: (uid: string) => void;
  subOverride?: string;
  search?: string;
  searchMatches?: ReadonlyArray<SearchMatch>;
}

const NAME_KEYS = new Set(['family_name', 'given_name', 'fn']);

function highlightText(text: string, query: string): React.ReactNode {
  const lText = text.toLowerCase();
  const lQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let idx = lText.indexOf(lQuery, last);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(<span key={key++} className="text-accent font-semibold">{text.slice(idx, idx + query.length)}</span>);
    last = idx + query.length;
    idx = lText.indexOf(lQuery, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function getSecondarySubtext(matches: ReadonlyArray<SearchMatch>): string | null {
  for (const m of matches) {
    if (m.key && !NAME_KEYS.has(m.key) && m.value) return m.value;
  }
  return null;
}

export const ContactRow = React.memo(function ContactRow({
  contact,
  selected,
  onSelect,
  subOverride,
  search,
  searchMatches,
}: ContactRowProps) {
  const initials = getInitials(contact.given_name, contact.family_name);
  const displayName = contact.fn || `${contact.given_name} ${contact.family_name}`.trim();
  const regularSub = subOverride ?? [contact.org, contact.title].filter(Boolean).join(' · ');
  const secondarySub = searchMatches ? getSecondarySubtext(searchMatches) : null;
  const sub = secondarySub ?? regularSub;

  function handleClick() {
    onSelect(contact.uid);
  }

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/x-contact-uid', contact.uid);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <button
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      aria-selected={selected}
      className={`w-full text-left flex items-center gap-2.5 px-4 py-2 border-l-2 transition-colors
        ${selected
          ? 'bg-surface-raised border-accent'
          : 'border-transparent hover:bg-surface'
        }`}
    >
      <Seal initials={initials} photoUrl={contactPhotoUrl(contact)} />
      <div className="min-w-0">
        <div className="text-[13.5px] text-foreground truncate">
          {search ? highlightText(displayName, search) : displayName}
        </div>
        {sub && <div className="text-[11px] text-muted truncate">{sub}</div>}
      </div>
    </button>
  );
});
