import { Router } from 'express';
import { query } from '../db';
import { hashPassword, generateTempPassword } from '../auth/password';
import { deleteAllSessionsForUser } from '../auth/sessions';
import { AuthedRequest } from '../auth/middleware';

const router = Router();

router.get('/users', async (_req, res) => {
  const users = await query(
    `SELECT id, email, role, must_change_password, created_at, last_login_at
     FROM users ORDER BY created_at ASC`
  );
  res.json({ users });
});

// Admin-only creation, per the no-self-signup requirement. Returns a
// system-generated temp password ONCE — the admin relays it out-of-band,
// the user is forced to change it on first login (must_change_password).
router.post('/users', async (req, res) => {
  const { email, role } = req.body ?? {};
  if (typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  const normalizedEmail = email.toLowerCase();
  const normalizedRole = role === 'admin' ? 'admin' : 'user';

  const existing = await query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
  if (existing.length > 0) return res.status(409).json({ error: 'email_taken' });

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const [created] = await query<{ id: string; created_at: string }>(
    `INSERT INTO users (email, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, true)
     RETURNING id, created_at`,
    [normalizedEmail, passwordHash, normalizedRole]
  );

  res.status(201).json({
    user: { id: created.id, email: normalizedEmail, role: normalizedRole, createdAt: created.created_at },
    tempPassword,
  });
});

router.post('/users/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const target = await query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [id]);
  if (target.length === 0) return res.status(404).json({ error: 'not_found' });

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await query(`UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1`, [
    id,
    passwordHash,
  ]);
  await deleteAllSessionsForUser(id);

  res.json({ tempPassword });
});

router.delete('/users/:id', async (req: AuthedRequest, res) => {
  const { id } = req.params;
  if (id === req.user!.id) return res.status(400).json({ error: 'cannot_delete_self' });

  const target = await query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id]);
  if (target.length === 0) return res.status(404).json({ error: 'not_found' });

  if (target[0].role === 'admin') {
    const [{ count }] = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'`
    );
    if (Number(count) <= 1) return res.status(400).json({ error: 'cannot_delete_last_admin' });
  }

  await query(`DELETE FROM users WHERE id = $1`, [id]);
  res.status(204).end();
});

export default router;
