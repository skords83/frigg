import { Router } from 'express';
import { query } from '../db';
import type { AuthedRequest } from '../auth/middleware';

const router = Router();

// GET /api/users — lightweight directory (id + email only) so any authed
// user can pick who to share an addressbook with. Not the admin user list.
router.get('/', async (req: AuthedRequest, res) => {
  const users = await query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE id != $1 ORDER BY email ASC`,
    [req.user!.id]
  );
  res.json({ users });
});

export default router;
