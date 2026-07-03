import { Router, CookieOptions } from 'express';
import { query } from '../db';
import { hashPassword, verifyPassword } from '../auth/password';
import {
  createSession,
  deleteSession,
  deleteAllSessionsForUser,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  SESSION_DURATION_REMEMBER_MS,
  Role,
} from '../auth/sessions';
import { checkLock, recordFailure, recordSuccess } from '../auth/rateLimit';
import { requireAuth, AuthedRequest } from '../auth/middleware';

const router = Router();

function cookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxAgeMs,
    path: '/',
  };
}

router.post('/login', async (req, res) => {
  const { email, password, rememberMe } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const ip = req.ip ?? 'unknown';
  const lockedUntil = checkLock(ip, email);
  if (lockedUntil) {
    res.setHeader('Retry-After', Math.ceil((lockedUntil - Date.now()) / 1000).toString());
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const rows = await query<{ id: string; password_hash: string; role: Role; must_change_password: boolean }>(
    `SELECT id, password_hash, role, must_change_password FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );
  const user = rows[0];
  const passwordOk = user ? await verifyPassword(user.password_hash, password) : false;

  if (!user || !passwordOk) {
    recordFailure(ip, email);
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  recordSuccess(ip, email);
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

  const remember = rememberMe === true;
  const session = await createSession(user.id, remember);
  res.cookie(
    SESSION_COOKIE_NAME,
    session.id,
    cookieOptions(remember ? SESSION_DURATION_REMEMBER_MS : SESSION_DURATION_MS)
  );

  res.json({
    user: {
      id: user.id,
      email: email.toLowerCase(),
      role: user.role,
      mustChangePassword: user.must_change_password,
    },
  });
});

router.post('/logout', requireAuth, async (req: AuthedRequest, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  if (sessionId) await deleteSession(sessionId);
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.status(204).end();
});

router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, async (req: AuthedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const rows = await query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [
    req.user!.id,
  ]);
  const ok = rows[0] && (await verifyPassword(rows[0].password_hash, currentPassword));
  if (!ok) return res.status(401).json({ error: 'invalid_current_password' });

  const newHash = await hashPassword(newPassword);
  await query(`UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`, [
    req.user!.id,
    newHash,
  ]);

  // Changing the password invalidates every other session (stolen cookie, other device) —
  // keep only the one that just made this request logged in.
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  await deleteAllSessionsForUser(req.user!.id, sessionId);

  res.json({ ok: true });
});

export default router;
