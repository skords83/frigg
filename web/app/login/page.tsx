'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Seal } from '@/components/Seal';
import { ActionButton, inputCls } from '@/components/form-helpers';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      if (res.status === 429) {
        setError('Zu viele Fehlversuche — bitte in 15 Minuten erneut versuchen.');
        return;
      }
      if (!res.ok) {
        setError('E-Mail oder Passwort ist falsch.');
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
          <h1 className="font-fraunces text-[22px] text-foreground">Frigg</h1>
          <p className="font-mono text-[10px] tracking-widest uppercase text-accent-dim">Anmelden</p>
        </div>

        <div className="w-full flex flex-col gap-3">
          <input
            type="email"
            autoFocus
            required
            placeholder="E-Mail"
            className={inputCls + ' w-full'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            required
            placeholder="Passwort"
            className={inputCls + ' w-full'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label className="flex items-center gap-2 font-mono text-[11px] text-muted select-none cursor-pointer">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            Angemeldet bleiben
          </label>
        </div>

        {error && <p className="text-[12px] text-red-500 font-mono text-center">{error}</p>}

        <ActionButton type="submit" label={loading ? 'Anmelden …' : 'Anmelden'} variant="primary" disabled={loading} />
      </form>
    </div>
  );
}
