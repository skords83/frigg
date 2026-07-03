// In-memory login throttle, keyed by IP+email. Resets on process restart —
// acceptable for a 2-4 user private deployment, no shared store needed.
interface Entry {
  failures: number;
  lockedUntil: number | null;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const attempts = new Map<string, Entry>();

function key(ip: string, email: string): string {
  return `${ip}:${email.toLowerCase()}`;
}

// Returns the lockout expiry timestamp (ms) if currently locked, else null.
export function checkLock(ip: string, email: string): number | null {
  const k = key(ip, email);
  const entry = attempts.get(k);
  if (!entry?.lockedUntil) return null;
  if (entry.lockedUntil <= Date.now()) {
    attempts.delete(k);
    return null;
  }
  return entry.lockedUntil;
}

export function recordFailure(ip: string, email: string): void {
  const k = key(ip, email);
  const entry = attempts.get(k) ?? { failures: 0, lockedUntil: null };
  entry.failures += 1;
  if (entry.failures >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  attempts.set(k, entry);
}

export function recordSuccess(ip: string, email: string): void {
  attempts.delete(key(ip, email));
}
