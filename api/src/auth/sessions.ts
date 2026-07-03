import { randomBytes } from 'crypto';
import { query } from '../db';

export const SESSION_COOKIE_NAME = 'frigg_sid';
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_DURATION_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

// Sliding expiration only writes to the DB if this much time has passed since
// the last touch, so normal browsing doesn't do a session UPDATE per request.
const SLIDE_THRESHOLD_MS = 5 * 60 * 1000;

export type Role = 'admin' | 'user';

export interface AuthedUser {
  id: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
}

interface SessionRow {
  user_id: string;
  remember: boolean;
  expires_at: string;
  last_seen_at: string;
  email: string;
  role: Role;
  must_change_password: boolean;
}

export async function createSession(
  userId: string,
  remember: boolean
): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('hex');
  const duration = remember ? SESSION_DURATION_REMEMBER_MS : SESSION_DURATION_MS;
  const expiresAt = new Date(Date.now() + duration);
  await query(`INSERT INTO sessions (id, user_id, remember, expires_at) VALUES ($1, $2, $3, $4)`, [
    id,
    userId,
    remember,
    expiresAt,
  ]);
  return { id, expiresAt };
}

export async function validateSession(sessionId: string): Promise<AuthedUser | null> {
  const rows = await query<SessionRow>(
    `SELECT s.user_id, s.remember, s.expires_at, s.last_seen_at,
            u.email, u.role, u.must_change_password
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [sessionId]
  );
  const row = rows[0];
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    return null;
  }

  if (Date.now() - new Date(row.last_seen_at).getTime() > SLIDE_THRESHOLD_MS) {
    const duration = row.remember ? SESSION_DURATION_REMEMBER_MS : SESSION_DURATION_MS;
    await query(`UPDATE sessions SET expires_at = $2, last_seen_at = now() WHERE id = $1`, [
      sessionId,
      new Date(Date.now() + duration),
    ]);
  }

  return {
    id: row.user_id,
    email: row.email,
    role: row.role,
    mustChangePassword: row.must_change_password,
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

// exceptSessionId lets a password change invalidate every *other* session
// (stolen cookies, other devices) while keeping the current one logged in.
export async function deleteAllSessionsForUser(userId: string, exceptSessionId?: string): Promise<void> {
  if (exceptSessionId) {
    await query(`DELETE FROM sessions WHERE user_id = $1 AND id != $2`, [userId, exceptSessionId]);
  } else {
    await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  }
}
