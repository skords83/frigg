'use client';

import { useState, useRef, useEffect } from 'react';
import type { Contact, PhoneEntry, EmailEntry, AddressEntry } from '@/types/contact';
import { contactPhotoUrl } from '@/types/contact';
import { Seal, getInitials } from './Seal';
import { ConflictReview } from './ConflictReview';
import { changedFields, resolveVersions, type Choices, type EditContact } from './conflicts';
import { inputCls, FormSection, FormField, LabelSelect, RemoveButton, AddButton, ModalFooter, useModalClose, birthdayToDisplay, birthdayToIso, isValidBirthday } from './form-helpers';

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
  const [birthday, setBirthday] = useState(birthdayToDisplay(contact.birthday ?? ''));
  const [note, setNote] = useState(contact.note ?? '');
  const [phones, setPhones] = useState<PhoneEntry[]>(contact.phones);
  const [emails, setEmails] = useState<EmailEntry[]>(contact.emails);
  const [addresses, setAddresses] = useState<AddressEntry[]>(contact.addresses);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { closing, requestClose } = useModalClose(onClose);

  const [base, setBase] = useState<EditContact>(contact);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState<{ base: EditContact; mine: EditContact; server: EditContact } | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  useEffect(() => {
    let active = true;
    fetch(`/api/contacts/${encodeURIComponent(contact.uid)}/edit`, { cache: 'no-store' }).then(async res => {
      if (!res.ok) throw new Error();
      const current: EditContact = await res.json();
      if (!active) return;
      setBase(current); setGivenName(current.given_name); setFamilyName(current.family_name);
      setOrg(current.org ?? ''); setTitle(current.title ?? ''); setBirthday(birthdayToDisplay(current.birthday ?? ''));
      setNote(current.note ?? ''); setPhones(current.phones); setEmails(current.emails); setAddresses(current.addresses);
      setLoading(false);
    }).catch(() => { if (active) setError('Die aktuelle Serverversion ist nicht verfügbar. Bitte später erneut öffnen.'); });
    return () => { active = false; };
  }, [contact.uid]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setPhotoPreview(result);
    };
    reader.readAsDataURL(file);
  }

  async function persist(original: EditContact, mine: EditContact) {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contact.uid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': original.etag },
        body: JSON.stringify(changedFields(original, mine)),
      });
      const body = await res.json();
      if (res.status === 409 && body.server) {
        setConflict({ base: original, mine, server: body.server }); setChoices({}); return;
      }
      if (!res.ok) {
        setError(body.error === 'contact_unavailable' ? 'Der Kontakt wurde gelöscht oder ist nicht mehr verfügbar. Deine Eingaben bleiben erhalten.' : body.error === 'stale_property' ? 'Eigenschaften wurden auf dem Server verändert. Bitte die Serverversion verwenden oder den Kontakt erneut öffnen.' : 'Speichern nicht bestätigt. Deine Eingaben bleiben erhalten; bitte den Serverzustand prüfen.');
        return;
      }
      requestClose(() => onSave(body));
    } catch { setError('Der Server ist nicht erreichbar. Deine Eingaben bleiben erhalten.'); }
    finally { setSaving(false); }
  }

  async function handleSave() {
    if (loading || saving) return;
    if (birthday !== birthdayToDisplay(base.birthday ?? '') && !isValidBirthday(birthday)) { setError('Bitte ein gültiges Geburtsdatum angeben.'); return; }
    const nameChanged = givenName !== base.given_name || familyName !== base.family_name;
    const mine: EditContact = { ...base,
      fn: nameChanged ? `${givenName} ${familyName}`.trim() : base.fn,
      given_name: givenName, family_name: familyName, org: org || null, title: title || null,
      birthday: birthday === birthdayToDisplay(base.birthday ?? '') ? base.birthday : birthday ? birthdayToIso(birthday) : null,
      note: note || null, phones: phones.filter(p => p.value.trim()), emails, addresses,
      photo_data_uri: photoPreview === null ? base.photo_data_uri : photoPreview === 'remove' ? null : photoPreview,
    };
    await persist(base, mine);
  }

  function updatePhone(i: number, p: PhoneEntry) {
    setError(null);
    setPhones((prev) => prev.map((x, j) => (j === i ? p : x)));
  }
  function removePhone(i: number) {
    setPhones((prev) => prev.filter((_, j) => j !== i));
  }

  function updateEmail(i: number, e: EmailEntry) {
    setError(null);
    setEmails((prev) => prev.map((x, j) => (j === i ? e : x)));
  }
  function removeEmail(i: number) {
    setEmails((prev) => prev.filter((_, j) => j !== i));
  }

  function updateAddress(i: number, a: AddressEntry) {
    setError(null);
    setAddresses((prev) => prev.map((x, j) => (j === i ? a : x)));
  }
  function removeAddress(i: number) {
    setAddresses((prev) => prev.filter((_, j) => j !== i));
  }

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`modal-panel bg-surface w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl shadow-2xl overflow-hidden ${closing ? 'closing' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <h2 className="font-fraunces text-[18px] font-medium">Kontakt bearbeiten</h2>
          <button
            onClick={() => requestClose()}
            className="press text-muted hover:text-foreground transition-colors w-7 h-7 flex items-center justify-center rounded-full hover:bg-divider"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {loading && <p role="status" className="text-[13px] text-muted">Aktuelle Serverversion wird geladen …</p>}
          {conflict ? <ConflictReview {...conflict} choices={choices} onChoice={setChoices} saving={saving}
            onCancel={() => setConflict(null)} onSave={() => {
              const resolved = resolveVersions(conflict.base, conflict.mine, conflict.server, choices);
              if (resolved) void persist(conflict.server, resolved);
            }} /> : <fieldset disabled={loading || saving} className="space-y-6">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-2 pt-1 pb-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="press relative group"
            >
              <Seal
                initials={getInitials(givenName, familyName)}
                size="lg"
                photoUrl={photoPreview === 'remove' ? null : (photoPreview ?? base.photo_data_uri ?? contactPhotoUrl(contact))}
              />
              <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            {photoPreview !== 'remove' && (photoPreview ?? base.photo_data_uri ?? contactPhotoUrl(contact)) && (
              <button
                type="button"
                onClick={() => setPhotoPreview('remove')}
                className="font-mono text-[10px] text-muted hover:text-red-400 transition-colors"
              >
                Foto entfernen
              </button>
            )}
          </div>

          {/* Name */}
          <FormSection label="Name">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Vorname" value={givenName} onChange={(v) => { setError(null); setGivenName(v); }} />
              <FormField label="Nachname" value={familyName} onChange={(v) => { setError(null); setFamilyName(v); }} />
            </div>
          </FormSection>

          {/* Firma & Titel */}
          <FormSection label="Firma & Titel">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Firma" value={org} onChange={(v) => { setError(null); setOrg(v); }} />
              <FormField label="Titel" value={title} onChange={(v) => { setError(null); setTitle(v); }} />
            </div>
          </FormSection>

          {/* Geburtstag */}
          <FormSection label="Geburtstag">
            <FormField label="TT.MM.JJJJ" value={birthday} onChange={(v) => { setError(null); setBirthday(v); }} />
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
                    placeholder="0178 ..."
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
              onChange={(e) => { setError(null); setNote(e.target.value); }}
              placeholder="Notiz ..."
            />
          </FormSection>
          </fieldset>}
        </div>

        {conflict ? <div className="px-6 pb-4 text-[13px] text-muted" role="alert">{error}</div> : <ModalFooter error={error} saving={saving || loading} onClose={() => requestClose()} onSave={handleSave} />}
      </div>
    </div>
  );
}
