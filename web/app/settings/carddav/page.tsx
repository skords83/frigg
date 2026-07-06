'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ActionButton, FormSection, inputCls, AddButton, RemoveButton } from '@/components/form-helpers';
import { Select } from '@/components/Select';
import type { AddressBook } from '@/types/contact';

interface CardDavAccount {
  id: string;
  carddav_url: string;
  username: string;
  created_at: string;
}

interface AccessGrant {
  user_id: string;
  email: string;
  granted_at: string;
}

interface LightUser {
  id: string;
  email: string;
}

export default function CardDavSettingsPage() {
  const [accounts, setAccounts] = useState<CardDavAccount[]>([]);
  const [addressbooks, setAddressbooks] = useState<AddressBook[]>([]);
  const [users, setUsers] = useState<LightUser[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [accountsRes, booksRes, usersRes] = await Promise.all([
      fetch('/api/carddav-accounts'),
      fetch('/api/addressbooks'),
      fetch('/api/users'),
    ]);
    if (accountsRes.ok) setAccounts((await accountsRes.json()).accounts);
    if (booksRes.ok) setAddressbooks(await booksRes.json());
    if (usersRes.ok) setUsers((await usersRes.json()).users);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const ownedBooks = addressbooks.filter((b) => b.is_owner);

  return (
    <div className="h-screen overflow-y-auto px-6 py-10">
      <div className="max-w-[560px] mx-auto flex flex-col gap-10">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/" className="font-mono text-[11px] tracking-wider text-muted hover:text-accent transition-colors">
              ← Zurück
            </Link>
            <h1 className="font-fraunces text-[22px] text-foreground mt-2">Kontoeinstellungen</h1>
          </div>
        </div>

        {!loading && (
          <>
            <CardDavAccountSection accounts={accounts} onChange={loadAll} />
            {ownedBooks.length > 0 && (
              <FormSection label="Geteilte Adressbücher">
                <div className="flex flex-col gap-5 mt-3">
                  {ownedBooks.map((book) => (
                    <SharingRow key={book.id} book={book} users={users} />
                  ))}
                </div>
              </FormSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CardDavAccountSection({ accounts, onChange }: { accounts: CardDavAccount[]; onChange: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <FormSection label="CardDAV-Konto">
      <div className="flex flex-col gap-3 mt-3">
        {accounts.map((account) =>
          editingId === account.id ? (
            <CardDavAccountForm
              key={account.id}
              account={account}
              onDone={() => {
                setEditingId(null);
                onChange();
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={account.id} className="flex items-center justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="text-[13px] text-foreground truncate">{account.carddav_url}</p>
                <p className="font-mono text-[11px] text-muted truncate">{account.username}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <ActionButton label="Bearbeiten" onClick={() => setEditingId(account.id)} />
                <ActionButton
                  label="Trennen"
                  variant="danger"
                  onClick={async () => {
                    if (
                      !confirm(
                        'Konto wirklich trennen? Die zugehörigen Adressbücher und lokal gespeicherten Kontakte werden entfernt (auf Baïkal bleibt nichts betroffen).'
                      )
                    )
                      return;
                    await fetch(`/api/carddav-accounts/${account.id}`, { method: 'DELETE' });
                    onChange();
                  }}
                />
              </div>
            </div>
          )
        )}

        {adding ? (
          <CardDavAccountForm
            onDone={() => {
              setAdding(false);
              onChange();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <AddButton onClick={() => setAdding(true)} />
        )}
      </div>
    </FormSection>
  );
}

function CardDavAccountForm({
  account,
  onDone,
  onCancel,
}: {
  account?: CardDavAccount;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [carddavUrl, setCarddavUrl] = useState(account?.carddav_url ?? '');
  const [username, setUsername] = useState(account?.username ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(account ? `/api/carddav-accounts/${account.id}` : '/api/carddav-accounts', {
        method: account ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carddav_url: carddavUrl, username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.error === 'connection_failed'
            ? `Verbindung fehlgeschlagen: ${body.detail ?? 'unbekannter Fehler'}`
            : 'Konto konnte nicht gespeichert werden.'
        );
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 border border-divider-soft rounded-md p-3.5">
      <input
        className={inputCls + ' w-full'}
        placeholder="https://baikal.example.com/dav.php/addressbooks/username/"
        value={carddavUrl}
        onChange={(e) => setCarddavUrl(e.target.value)}
        required
      />
      <input
        className={inputCls + ' w-full'}
        placeholder="Benutzername"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <input
        type="password"
        className={inputCls + ' w-full'}
        placeholder="Passwort"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="text-[12px] text-red-500 font-mono">{error}</p>}
      <div className="flex justify-end gap-3 mt-1">
        <ActionButton label="Abbrechen" onClick={onCancel} />
        <ActionButton type="submit" label={saving ? 'Prüfen …' : 'Speichern'} variant="primary" disabled={saving} />
      </div>
    </form>
  );
}

function SharingRow({ book, users }: { book: AddressBook; users: LightUser[] }) {
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function loadGrants() {
    const res = await fetch(`/api/addressbooks/${book.id}/access`);
    if (res.ok) setGrants((await res.json()).grants);
    setLoaded(true);
  }

  useEffect(() => {
    loadGrants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const grantedIds = new Set(grants.map((g) => g.user_id));
  const shareable = users.filter((u) => !grantedIds.has(u.id));

  return (
    <div>
      <p className="text-[13px] text-foreground mb-1.5">{book.display_name}</p>
      <div className="flex flex-col gap-1">
        {loaded &&
          grants.map((grant) => (
            <div key={grant.user_id} className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
              <span>{grant.email}</span>
              <RemoveButton
                onClick={async () => {
                  await fetch(`/api/addressbooks/${book.id}/access/${grant.user_id}`, { method: 'DELETE' });
                  loadGrants();
                }}
              />
            </div>
          ))}
      </div>
      {pickerOpen ? (
        <Select
          value=""
          onValueChange={async (userId) => {
            setPickerOpen(false);
            if (!userId) return;
            await fetch(`/api/addressbooks/${book.id}/access`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_id: userId }),
            });
            loadGrants();
          }}
          options={shareable.map((u) => ({ value: u.id, label: u.email }))}
          placeholder="Nutzer wählen …"
          open={pickerOpen}
          onOpenChange={(o) => { if (!o) setPickerOpen(false); }}
          triggerClassName="mt-1.5 bg-transparent border border-divider rounded-md px-2 py-1 text-[11px] font-mono text-muted focus:outline-none focus:border-accent-dim flex items-center justify-between gap-1.5 cursor-pointer"
        />
      ) : (
        shareable.length > 0 && <AddButton onClick={() => setPickerOpen(true)} />
      )}
    </div>
  );
}
