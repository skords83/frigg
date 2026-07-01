'use client';

import { useState } from 'react';
import type { Contact, PhoneEntry, EmailEntry, AddressEntry } from '@/types/contact';

interface EditModalProps {
  contact: Contact;
  onClose: () => void;
  onSave: (updated: Contact) => void;
}

export function EditModal({ contact, onClose, onSave }: EditModalProps) {
  const [givenName, setGivenName] = useState(contact.given_name);
  const [familyName, setFamilyName] = useState(contact.family_name);
  const [org, setOrg] = useState(contact.org ?? '');
  const [title, setTitle] = useState(contact.title ?? '');
  const [birthday, setBirthday] = useState(contact.birthday ?? '');
  const [note, setNote] = useState(contact.note ?? '');
  const [phones, setPhones] = useState<PhoneEntry[]>(contact.phones);
  const [emails, setEmails] = useState<EmailEntry[]>(contact.emails);
  const [addresses, setAddresses] = useState<AddressEntry[]>(contact.addresses);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const fn = `${givenName} ${familyName}`.trim() || familyName || givenName;
    try {
      const res = await fetch(`/api/contacts/${contact.uid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': contact.etag,
        },
        body: JSON.stringify({
          fn,
          given_name: givenName,
          family_name: familyName,
          org: org || null,
          title: title || null,
          birthday: birthday || null,
          note: note || null,
          phones,
          emails,
          addresses,
        }),
      });
      if (res.status === 409) {
        setError('Konflikt: Der Kontakt wurde zwischenzeitlich geändert. Bitte neu laden.');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Contact = await res.json();
      onSave(updated);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('HTTP')) {
        setError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
      } else if (error === null) {
        setError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
      }
    } finally {
      setSaving(false);
    }
  }

  function updatePhone(i: number, p: PhoneEntry) {
    setPhones((prev) => prev.map((x, j) => (j === i ? p : x)));
  }
  function removePhone(i: number) {
    setPhones((prev) => prev.filter((_, j) => j !== i));
  }

  function updateEmail(i: number, e: EmailEntry) {
    setEmails((prev) => prev.map((x, j) => (j === i ? e : x)));
  }
  function removeEmail(i: number) {
    setEmails((prev) => prev.filter((_, j) => j !== i));
  }

  function updateAddress(i: number, a: AddressEntry) {
    setAddresses((prev) => prev.map((x, j) => (j === i ? a : x)));
  }
  function removeAddress(i: number) {
    setAddresses((prev) => prev.filter((_, j) => j !== i));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <h2 className="font-fraunces text-[18px] font-medium">Kontakt bearbeiten</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors w-7 h-7 flex items-center justify-center rounded-full hover:bg-divider"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {/* Name */}
          <FormSection label="Name">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Vorname" value={givenName} onChange={setGivenName} />
              <FormField label="Nachname" value={familyName} onChange={setFamilyName} />
            </div>
          </FormSection>

          {/* Firma & Titel */}
          <FormSection label="Firma & Titel">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Firma" value={org} onChange={setOrg} />
              <FormField label="Titel" value={title} onChange={setTitle} />
            </div>
          </FormSection>

          {/* Geburtstag */}
          <FormSection label="Geburtstag">
            <FormField label="JJJJ-MM-TT" value={birthday} onChange={setBirthday} />
          </FormSection>

          {/* Telefon */}
          <FormSection label="Telefon">
            <div className="space-y-2">
              {phones.map((p, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <LabelSelect
                    value={p.label}
                    options={['Mobil', 'Privat', 'Arbeit']}
                    onChange={(v) => updatePhone(i, { ...p, label: v })}
                  />
                  <input
                    className={inputCls + ' flex-1'}
                    value={p.value}
                    onChange={(e) => updatePhone(i, { ...p, value: e.target.value })}
                    placeholder="+49 ..."
                    type="tel"
                  />
                  <RemoveButton onClick={() => removePhone(i)} />
                </div>
              ))}
              <AddButton onClick={() => setPhones((prev) => [...prev, { label: 'Mobil', value: '' }])} />
            </div>
          </FormSection>

          {/* E-Mail */}
          <FormSection label="E-Mail">
            <div className="space-y-2">
              {emails.map((e, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <LabelSelect
                    value={e.label}
                    options={['Privat', 'Arbeit']}
                    onChange={(v) => updateEmail(i, { ...e, label: v })}
                  />
                  <input
                    className={inputCls + ' flex-1'}
                    value={e.value}
                    onChange={(ev) => updateEmail(i, { ...e, value: ev.target.value })}
                    placeholder="name@example.com"
                    type="email"
                  />
                  <RemoveButton onClick={() => removeEmail(i)} />
                </div>
              ))}
              <AddButton onClick={() => setEmails((prev) => [...prev, { label: 'Privat', value: '' }])} />
            </div>
          </FormSection>

          {/* Adressen */}
          <FormSection label="Adresse">
            <div className="space-y-4">
              {addresses.map((a, i) => (
                <div key={i} className="space-y-2 pb-3 border-b border-divider-soft last:border-0 last:pb-0">
                  <div className="flex gap-2 items-center">
                    <LabelSelect
                      value={a.label}
                      options={['Privat', 'Arbeit']}
                      onChange={(v) => updateAddress(i, { ...a, label: v })}
                    />
                    <RemoveButton onClick={() => removeAddress(i)} />
                  </div>
                  <input
                    className={inputCls + ' w-full'}
                    value={a.street}
                    onChange={(e) => updateAddress(i, { ...a, street: e.target.value })}
                    placeholder="Straße und Hausnummer"
                  />
                  <div className="grid grid-cols-[80px_1fr] gap-2">
                    <input
                      className={inputCls}
                      value={a.zip}
                      onChange={(e) => updateAddress(i, { ...a, zip: e.target.value })}
                      placeholder="PLZ"
                    />
                    <input
                      className={inputCls}
                      value={a.city}
                      onChange={(e) => updateAddress(i, { ...a, city: e.target.value })}
                      placeholder="Stadt"
                    />
                  </div>
                  <input
                    className={inputCls + ' w-full'}
                    value={a.country ?? ''}
                    onChange={(e) => updateAddress(i, { ...a, country: e.target.value })}
                    placeholder="Land"
                  />
                </div>
              ))}
              <AddButton
                onClick={() =>
                  setAddresses((prev) => [...prev, { label: 'Privat', street: '', city: '', zip: '' }])
                }
              />
            </div>
          </FormSection>

          {/* Notiz */}
          <FormSection label="Notiz">
            <textarea
              className={inputCls + ' w-full resize-none'}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Notiz ..."
            />
          </FormSection>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-divider flex flex-col gap-2">
          {error && (
            <p className="text-[12px] text-red-500 font-mono">{error}</p>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="font-mono text-[11px] tracking-wider px-4 py-1.5 rounded-full border border-divider text-muted hover:border-accent-dim hover:text-accent transition-colors"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="font-mono text-[11px] tracking-wider px-4 py-1.5 rounded-full bg-accent text-surface border border-accent hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Speichern …' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'bg-transparent border border-divider rounded-md px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:border-accent-dim transition-colors';

function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-mono text-[10px] tracking-widest uppercase text-accent-dim mb-2.5 pb-1.5 border-b border-divider-soft">
        {label}
      </h3>
      {children}
    </div>
  );
}

function FormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      className={inputCls + ' w-full'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
    />
  );
}

function LabelSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const allOptions = options.includes(value) ? options : [value, ...options];
  return (
    <select
      className="bg-transparent border border-divider rounded-md px-2 py-1.5 text-[11px] font-mono text-muted focus:outline-none focus:border-accent-dim transition-colors w-[90px] shrink-0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allOptions.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-muted hover:text-red-400 transition-colors w-6 h-6 flex items-center justify-center shrink-0 text-[16px]"
      title="Entfernen"
    >
      −
    </button>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="font-mono text-[11px] tracking-wider text-muted hover:text-accent transition-colors flex items-center gap-1"
    >
      <span className="text-[16px] leading-none">+</span> Hinzufügen
    </button>
  );
}
