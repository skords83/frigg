import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET /api/addressbooks
router.get('/', async (_req: Request, res: Response) => {
  try {
    const books = await query<{
      id: string;
      display_name: string;
      url: string;
      contact_count: number;
    }>(
      `SELECT ab.id, ab.display_name, ab.url,
              COUNT(c.uid)::int AS contact_count
       FROM addressbooks ab
       LEFT JOIN contacts c ON c.addressbook_id = ab.id
       GROUP BY ab.id
       ORDER BY ab.display_name`
    );
    res.json(books);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
