import { Router, Response } from 'express';
import { query, pool } from '../db';
import { canAccessAddressbook } from '../auth/access';
import type { AuthedRequest } from '../auth/middleware';

const router = Router();

interface ContactGroupRow {
  id: string;
  name: string;
}

// GET /api/groups
router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const groups = await query<ContactGroupRow>(
      'SELECT id, name FROM contact_groups WHERE owner_id = $1 ORDER BY name',
      [req.user!.id]
    );
    const members = await query<{ group_id: string; contact_uid: string }>(
      `SELECT m.group_id, m.contact_uid
       FROM contact_group_members m
       JOIN contact_groups g ON g.id = m.group_id
       WHERE g.owner_id = $1`,
      [req.user!.id]
    );

    const memberMap = new Map<string, string[]>();
    for (const m of members) {
      if (!memberMap.has(m.group_id)) memberMap.set(m.group_id, []);
      memberMap.get(m.group_id)!.push(m.contact_uid);
    }

    res.json(groups.map((g) => ({ id: g.id, name: g.name, member_uids: memberMap.get(g.id) ?? [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// POST /api/groups
router.post('/', async (req: AuthedRequest, res: Response) => {
  try {
    const name = (req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });

    const [created] = await query<ContactGroupRow>(
      'INSERT INTO contact_groups (owner_id, name) VALUES ($1, $2) RETURNING id, name',
      [req.user!.id, name]
    );
    res.status(201).json({ id: created.id, name: created.name, member_uids: [] });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.code === '23505') return res.status(409).json({ error: 'name already exists' });
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// PATCH /api/groups/:id
router.patch('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const name = (req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });

    const [updated] = await query<ContactGroupRow>(
      'UPDATE contact_groups SET name = $1 WHERE id = $2 AND owner_id = $3 RETURNING id, name',
      [name, req.params.id, req.user!.id]
    );
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json(updated);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.code === '23505') return res.status(409).json({ error: 'name already exists' });
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// DELETE /api/groups/:id
router.delete('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM contact_groups WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user!.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// POST /api/groups/:id/members  { contact_uid }
router.post('/:id/members', async (req: AuthedRequest, res: Response) => {
  try {
    const contactUid = req.body?.contact_uid;
    if (!contactUid) return res.status(400).json({ error: 'contact_uid required' });

    const [group] = await query<ContactGroupRow>(
      'SELECT id, name FROM contact_groups WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user!.id]
    );
    if (!group) return res.status(404).json({ error: 'not found' });

    const [contact] = await query<{ addressbook_id: string }>(
      'SELECT addressbook_id FROM contacts WHERE uid = $1',
      [contactUid]
    );
    if (!contact || !(await canAccessAddressbook(req.user!.id, contact.addressbook_id))) {
      return res.status(404).json({ error: 'contact not found' });
    }

    await pool.query(
      'INSERT INTO contact_group_members (group_id, contact_uid) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, contactUid]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// DELETE /api/groups/:id/members/:contact_uid
router.delete('/:id/members/:contact_uid', async (req: AuthedRequest, res: Response) => {
  try {
    const [group] = await query<ContactGroupRow>(
      'SELECT id FROM contact_groups WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user!.id]
    );
    if (!group) return res.status(404).json({ error: 'not found' });

    await pool.query(
      'DELETE FROM contact_group_members WHERE group_id = $1 AND contact_uid = $2',
      [req.params.id, req.params.contact_uid]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
