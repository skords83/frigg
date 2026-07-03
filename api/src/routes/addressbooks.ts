import { Router, Response } from 'express';
import { query } from '../db';
import { getVisibleAddressbookIds, isAddressbookOwner } from '../auth/access';
import type { AuthedRequest } from '../auth/middleware';

const router = Router();

// GET /api/addressbooks
router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const visibleIds = await getVisibleAddressbookIds(req.user!.id);
    const books = await query<{
      id: string;
      display_name: string;
      url: string;
      contact_count: number;
      is_owner: boolean;
    }>(
      `SELECT ab.id, ab.display_name, ab.url,
              COUNT(c.uid)::int AS contact_count,
              (ca.user_id = $2) AS is_owner
       FROM addressbooks ab
       LEFT JOIN contacts c ON c.addressbook_id = ab.id
       LEFT JOIN carddav_accounts ca ON ca.id = ab.carddav_account_id
       WHERE ab.id = ANY($1::text[])
       GROUP BY ab.id, ca.user_id
       ORDER BY ab.display_name`,
      [visibleIds, req.user!.id]
    );
    res.json(books);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// GET /api/addressbooks/:id/access — owner-only: who this book is shared with.
router.get('/:id/access', async (req: AuthedRequest, res: Response) => {
  try {
    if (!(await isAddressbookOwner(req.user!.id, req.params.id))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const grants = await query<{ user_id: string; email: string; granted_at: string }>(
      `SELECT aa.user_id, u.email, aa.granted_at
       FROM addressbook_access aa
       JOIN users u ON u.id = aa.user_id
       WHERE aa.addressbook_id = $1
       ORDER BY aa.granted_at ASC`,
      [req.params.id]
    );
    res.json({ grants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// POST /api/addressbooks/:id/access — owner-only: share with another user.
router.post('/:id/access', async (req: AuthedRequest, res: Response) => {
  try {
    if (!(await isAddressbookOwner(req.user!.id, req.params.id))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const { user_id } = req.body ?? {};
    if (typeof user_id !== 'string') return res.status(400).json({ error: 'invalid_request' });

    await query(
      `INSERT INTO addressbook_access (addressbook_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (addressbook_id, user_id) DO NOTHING`,
      [req.params.id, user_id]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// DELETE /api/addressbooks/:id/access/:userId — owner-only: revoke sharing.
router.delete('/:id/access/:userId', async (req: AuthedRequest, res: Response) => {
  try {
    if (!(await isAddressbookOwner(req.user!.id, req.params.id))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    await query(
      `DELETE FROM addressbook_access WHERE addressbook_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
