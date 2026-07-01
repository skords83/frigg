'use client';

import { useState } from 'react';
import type { Contact } from '@/types/contact';
import { Seal, getInitials } from './Seal';
import { EditModal } from './EditModal';

interface DetailPaneProps {
  contact: Contact | null;
  onUpdate?: (updated: Contact) => void;
  onDelete?: (uid: string) => void;
}

export function DetailPane({ contact, onUpdate, onDelete }: DetailPaneProps) {
  const [editing, setEditing] = useState(false);

  if (!contact) {
    return (
      <div className="bg-surface flex items-center justify-center">
        <p className="text-muted text-sm font-mono">Kontakt auswählen</p>
      </div>
    );
  }

  const initials = getInitials(contact.given_name, contact.family_name);
  const roleLabel = [contact.title, contact.org].filter(Boolean).join(' · ');

  async function handleDelete() {
    if (!contact) return;
    if (!confirm(`„${contact.fn}" wirklich löschen?`)) return;
    await fetch(`/api/contacts/${contact.uid}`, {
      method: 'DELETE',
      headers: { 'If-Match': contact.etag },
    });
    if (onDelete) {
      onDelete(contact.uid);
    } else {
      window.location.reload();
    }
  }

  function handleSaved(updated: Contact) {
    setEditing(false);
    onUpdate?.(updated);
  }

  return (
    <div className="bg-surface overflow-y-auto px-14 py-12">
      {editing && (
        <EditModal contact={contact} onClose={() => setEditing(false)} onSave={handleSaved} />
      )}
      {/* Header */}
      <div className="flex flex-col items-center text-center mb-9">
        <Seal initials={initials} size="lg" photoUrl={contact.photo_data_uri} />
        <h1 className="font-fraunces text-[26px] font-medium tracking-tight">{contact.fn}</h1>
        {roleLabel && <p className="text-[13px] text-muted mt-1">{roleLabel}</p>}
        <div className="flex gap-2.5 mt-5">
          <ActionButton label="Bearbeiten" onClick={() => setEditing(true)} />
          <ActionButton label="Teilen" onClick={() => {}} />
          <ActionButton label="Löschen" onClick={handleDelete} />
        </div>
      </div>

      <div className="max-w-[480px] mx-auto space-y-6">
        {contact.phones.length > 0 && (
          <FieldGroup label="Telefon">
            {contact.phones.map((p, i) => (
              <FieldRow key={i} tag={p.label}>
                <a href={`tel:${p.value}`} className="text-sage hover:underline">{p.value}</a>
              </FieldRow>
            ))}
          </FieldGroup>
        )}

        {contact.emails.length > 0 && (
          <FieldGroup label="E-Mail">
            {contact.emails.map((e, i) => (
              <FieldRow key={i} tag={e.label}>
                <a href={`mailto:${e.value}`} className="text-sage hover:underline">{e.value}</a>
              </FieldRow>
            ))}
          </FieldGroup>
        )}

        {contact.addresses.length > 0 && (
          <FieldGroup label="Adresse">
            {contact.addresses.map((a, i) => (
              <FieldRow key={i} tag={a.label}>
                <span>
                  {a.street}
                  {a.street && <br />}
                  {[a.zip, a.city].filter(Boolean).join(' ')}
                  {a.country && <><br />{a.country}</>}
                </span>
              </FieldRow>
            ))}
          </FieldGroup>
        )}

        {(contact.birthday || contact.org) && (
          <FieldGroup label="Sonstiges">
            {contact.birthday && (
              <FieldRow tag="Geburtstag">{formatBirthday(contact.birthday)}</FieldRow>
            )}
            {contact.org && (
              <FieldRow tag="Firma">{contact.org}</FieldRow>
            )}
          </FieldGroup>
        )}

        {contact.note && (
          <FieldGroup label="Notiz">
            <p className="text-[13px] text-muted italic leading-relaxed">{contact.note}</p>
          </FieldGroup>
        )}
      </div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-mono text-[10px] tracking-widest uppercase text-accent-dim mb-2.5 pb-1.5 border-b border-divider-soft">
        {label}
      </h2>
      <div className="space-y-0">{children}</div>
    </div>
  );
}

function FieldRow({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline py-1.5 px-0.5 text-[14px]">
      <span className="font-mono text-[11px] text-muted w-[90px] shrink-0">{tag}</span>
      <span className="flex-1 text-foreground">{children}</span>
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="font-mono text-[11px] tracking-wider px-4 py-1.5 rounded-full border border-divider text-muted hover:border-accent-dim hover:text-accent transition-colors"
    >
      {label}
    </button>
  );
}

function formatBirthday(raw: string): string {
  // Handles YYYY-MM-DD or --MM-DD (vCard 4.0 partial dates)
  const match = raw.match(/^(?:\d{4}|--)[-–](\d{2})[-–](\d{2})$/);
  if (!match) return raw;
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const month = months[parseInt(match[1], 10) - 1] ?? match[1];
  const fullYear = raw.match(/^(\d{4})/)?.[1];
  return fullYear ? `${parseInt(match[2], 10)}. ${month} ${fullYear}` : `${parseInt(match[2], 10)}. ${month}`;
}
