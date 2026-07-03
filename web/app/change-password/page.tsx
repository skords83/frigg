'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Seal } from '@/components/Seal';
import { ActionButton, inputCls } from '@/components/form-helpers';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('Das neue Passwort muss mindestens 8 Zeichen haben.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.status === 401) {
        setError('Das aktuelle Passwort ist falsch.');
        return;
      }
      if (!res.ok) {
        setError('Passwort konnte nicht geändert werden.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Verbindung zum Server fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-[320px] flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <Seal initials="F" size="lg" />
          <h1 className="font-fraunces text-[22px] text-foreground">Passwort ändern</h1>
          <p className="font-mono text-[10px] tracking-widest uppercase text-accent-dim text-center">
            Bitte vergib ein neues Passwort
          </p>
        </div>

        <div className="w-full flex flex-col gap-3">
          <input
            type="password"
            autoFocus
            required
            placeholder="Aktuelles Passwort"
            className={inputCls + ' w-full'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input
            type="password"
            required
            placeholder="Neues Passwort"
            className={inputCls + ' w-full'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <input
            type="password"
            required
            placeholder="Neues Passwort bestätigen"
            className={inputCls + ' w-full'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-[12px] text-red-500 font-mono text-center">{error}</p>}

        <ActionButton type="submit" label={loading ? 'Speichern …' : 'Speichern'} variant="primary" disabled={loading} />
      </form>
    </div>
  );
}
