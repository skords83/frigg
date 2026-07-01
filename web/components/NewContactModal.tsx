'use client';

import { useState } from 'react';
import type { Contact, AddressBook, PhoneEntry, EmailEntry, AddressEntry } from '@/types/contact';
import { inputCls, FormSection, FormField, LabelSelect, RemoveButton, AddButton, ModalFooter } from './form-helpers';

interface NewContactModalProps {
  addressbooks: AddressBook[];
  onClose: () => void;
  onCreate: (contact: Contact) => void;
}

export function NewContactModal({ addressbooks, onClose, onCreate }: NewContactModalProps) {
  const [addressbookId, setAddressbookId] = useState(addressbooks[0]?.id ?? '');
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [org, setOrg] = useState('');
  const [title, setTitle] = useState('');
  const [birthday, setBirthday] = useState('');
  const [note, setNote] = useState('');
  const [phones, setPhones] = useState<PhoneEntry[]>([]);
  const [emails, setEmails] = useState<EmailEntry[]>([]);
  const [addresses, setAddresses] = useState<AddressEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!givenName.trim() && !familyName.trim()) {
      setError('Bitte mindestens Vor- oder Nachname angeben.');
      return;
    }
    setSaving(true);
    setError(null);
    const fn = `${givenName} ${familyName}`.trim() || familyName || givenName;
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addressbook_id: addressbookId,
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created: Contact = await res.json();
      onCreate(created);
    } catch {
      setError('Kontakt konnte nicht erstellt werden. Bitte erneut versuchen.');
    } finally {
      setSaving(false);
    }
  }

  function updatePhone(i: number, p: PhoneEntry) {
    setPhones((prev) => prev.map((x, j) => (j === i ? p : x)));
  }
  function updateEmail(i: number, e: EmailEntry) {
    setEmails((prev) => prev.map((x, j) => (j === i ? e : x)));
  }
  function updateAddress(i: number, a: AddressEntry) {
    setAddresses((prev) => prev.map((x, j) => (j === i ? a : x)));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <h2 className="font-fraunces text-[18px] font-medium">Neuer Kontakt</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors w-7 h-7 flex items-center justify-center rounded-full hover:bg-divider"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {/* Adressbuch (nur wenn mehrere vorhanden) */}
          {addressbooks.length > 1 && (
            <FormSection label="Adressbuch">
              <select
                className={inputCls + ' w-full'}
                value={addressbookId}
                onChange={(e) => setAddressbookId(e.target.value)}
              >
                {addressbooks.map((ab) => (
                  <option key={ab.id} value={ab.id}>{ab.display_name}</option>
                ))}
              </select>
            </FormSection>
          )}

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
                  <LabelSelect value={p.label} options={['Mobil', 'Privat', 'Arbeit']} onChange={(v) => updatePhone(i, { ...p, label: v })} />
                  <input
                    className={inputCls + ' flex-1'}
                    value={p.value}
                    onChange={(e) => updatePhone(i, { ...p, value: e.target.value })}
                    placeholder="+49 ..."
                    type="tel"
                  />
                  <RemoveButton onClick={() => setPhones((prev) => prev.filter((_, j) => j !== i))} />
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
                  <LabelSelect value={e.label} options={['Privat', 'Arbeit']} onChange={(v) => updateEmail(i, { ...e, label: v })} />
                  <input
                    className={inputCls + ' flex-1'}
                    value={e.value}
                    onChange={(ev) => updateEmail(i, { ...e, value: ev.target.value })}
                    placeholder="name@example.com"
                    type="email"
                  />
                  <RemoveButton onClick={() => setEmails((prev) => prev.filter((_, j) => j !== i))} />
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
                    <LabelSelect value={a.label} options={['Privat', 'Arbeit']} onChange={(v) => updateAddress(i, { ...a, label: v })} />
                    <RemoveButton onClick={() => setAddresses((prev) => prev.filter((_, j) => j !== i))} />
                  </div>
                  <input className={inputCls + ' w-full'} value={a.street} onChange={(e) => updateAddress(i, { ...a, street: e.target.value })} placeholder="Straße und Hausnummer" />
                  <div className="grid grid-cols-[80px_1fr] gap-2">
                    <input className={inputCls} value={a.zip} onChange={(e) => updateAddress(i, { ...a, zip: e.target.value })} placeholder="PLZ" />
                    <input className={inputCls} value={a.city} onChange={(e) => updateAddress(i, { ...a, city: e.target.value })} placeholder="Stadt" />
                  </div>
                  <input className={inputCls + ' w-full'} value={a.country ?? ''} onChange={(e) => updateAddress(i, { ...a, country: e.target.value })} placeholder="Land" />
                </div>
              ))}
              <AddButton onClick={() => setAddresses((prev) => [...prev, { label: 'Privat', street: '', city: '', zip: '' }])} />
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

        <ModalFooter error={error} saving={saving} onClose={onClose} onSave={handleSave} saveLabel="Erstellen" />
      </div>
    </div>
  );
}
