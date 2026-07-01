'use client';

import type { Contact } from '@/types/contact';
import { Seal, getInitials } from './Seal';

interface ContactRowProps {
  contact: Contact;
  selected: boolean;
  onClick: () => void;
  subOverride?: string;
}

export function ContactRow({ contact, selected, onClick, subOverride }: ContactRowProps) {
  const initials = getInitials(contact.given_name, contact.family_name);
  const sub = subOverride ?? [contact.org, contact.title].filter(Boolean).join(' · ');

  return (
    <button
      onClick={onClick}
      aria-selected={selected}
      className={`w-full text-left flex items-center gap-2.5 px-4 py-2 border-l-2 transition-colors
        ${selected
          ? 'bg-surface-raised border-accent'
          : 'border-transparent hover:bg-surface'
        }`}
    >
      <Seal initials={initials} photoUrl={contact.photo_data_uri} />
      <div className="min-w-0">
        <div className="text-[13.5px] text-foreground truncate">{contact.fn || `${contact.given_name} ${contact.family_name}`.trim()}</div>
        {sub && <div className="text-[11px] text-muted truncate">{sub}</div>}
      </div>
    </button>
  );
}
