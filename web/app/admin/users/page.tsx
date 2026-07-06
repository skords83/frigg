'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ActionButton, FormSection, inputCls, AddButton } from '@/components/form-helpers';
import { Select } from '@/components/Select';

interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tempPasswordNotice, setTempPasswordNotice] = useState<{ email: string; password: string } | null>(null);

  async function loadUsers() {
    const res = await fetch('/api/admin/users');
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    if (res.ok) setUsers((await res.json()).users);
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreate(email: string, role: 'admin' | 'user') {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    setTempPasswordNotice({ email: body.user.email, password: body.tempPassword });
    setAdding(false);
    loadUsers();
    return true;
  }

  async function handleResetPassword(user: AdminUser) {
    if (!confirm(`Passwort für ${user.email} zurücksetzen?`)) return;
    const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: 'POST' });
    if (!res.ok) return;
    const body = await res.json();
    setTempPasswordNotice({ email: user.email, password: body.tempPassword });
    loadUsers();
  }

  async function handleDelete(user: AdminUser) {
    if (!confirm(`${user.email} wirklich löschen?`)) return;
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(
        body.error === 'cannot_delete_last_admin'
          ? 'Der letzte Admin kann nicht gelöscht werden.'
          : 'Nutzer konnte nicht gelöscht werden.'
      );
      return;
    }
    loadUsers();
  }

  if (loading) return null;

  if (forbidden) {
    return (
      <div className="h-screen flex items-center justify-center px-4">
        <p className="font-mono text-[12px] text-muted">Kein Zugriff — nur für Administratoren.</p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto px-6 py-10">
      <div className="max-w-[640px] mx-auto flex flex-col gap-8">
        <div>
          <Link href="/" className="font-mono text-[11px] tracking-wider text-muted hover:text-accent transition-colors">
            ← Zurück
          </Link>
          <h1 className="font-fraunces text-[22px] text-foreground mt-2">Nutzerverwaltung</h1>
        </div>

        {tempPasswordNotice && (
          <div className="border border-accent-dim rounded-md p-3.5 bg-[rgba(201,164,76,0.08)]">
            <p className="text-[13px] text-foreground">
              Einmal-Passwort für <span className="font-mono">{tempPasswordNotice.email}</span>:
            </p>
            <p className="font-mono text-[15px] text-accent mt-1 select-all">{tempPasswordNotice.password}</p>
            <p className="font-mono text-[10px] text-muted mt-2">
              Wird nur einmal angezeigt — bitte jetzt sicher übermitteln. Muss beim ersten Login geändert werden.
            </p>
            <button
              onClick={() => setTempPasswordNotice(null)}
              className="font-mono text-[11px] text-muted hover:text-accent transition-colors mt-2"
            >
              Verstanden
            </button>
          </div>
        )}

        <FormSection label="Nutzer">
          <div className="flex flex-col gap-1 mt-3">
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-3 py-2 border-b border-divider-soft last:border-b-0">
                <div className="min-w-0">
                  <p className="text-[13px] text-foreground truncate">{user.email}</p>
                  <p className="font-mono text-[10px] text-muted">
                    {user.role === 'admin' ? 'Administrator' : 'Nutzer'}
                    {user.must_change_password ? ' · Passwort ausstehend' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <ActionButton label="Passwort zurücksetzen" onClick={() => handleResetPassword(user)} />
                  <ActionButton label="Löschen" variant="danger" onClick={() => handleDelete(user)} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            {adding ? (
              <NewUserForm onCreate={handleCreate} onCancel={() => setAdding(false)} />
            ) : (
              <AddButton onClick={() => setAdding(true)} />
            )}
          </div>
        </FormSection>
      </div>
    </div>
  );
}

function NewUserForm({
  onCreate,
  onCancel,
}: {
  onCreate: (email: string, role: 'admin' | 'user') => Promise<boolean>;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const ok = await onCreate(email, role);
    setSaving(false);
    if (!ok) setError('E-Mail ist ungültig oder bereits vergeben.');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 border border-divider-soft rounded-md p-3.5">
      <input
        type="email"
        className={inputCls + ' w-full'}
        placeholder="E-Mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Select
        value={role}
        onValueChange={(v) => setRole(v as 'admin' | 'user')}
        options={[
          { value: 'user', label: 'Nutzer' },
          { value: 'admin', label: 'Administrator' },
        ]}
        triggerClassName="bg-transparent border border-divider rounded-md px-2.5 py-1.5 text-[13px] text-foreground focus:outline-none focus:border-accent-dim flex items-center justify-between gap-2 cursor-pointer"
      />
      {error && <p className="text-[12px] text-red-500 font-mono">{error}</p>}
      <div className="flex justify-end gap-3 mt-1">
        <ActionButton label="Abbrechen" onClick={onCancel} />
        <ActionButton type="submit" label={saving ? 'Anlegen …' : 'Anlegen'} variant="primary" disabled={saving} />
      </div>
    </form>
  );
}
