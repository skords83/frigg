import { Router, Request, Response } from 'express';
import { runSync } from '../sync';

const router = Router();

// POST /api/sync — trigger manual sync
router.post('/', async (_req: Request, res: Response) => {
  try {
    const result = await runSync();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'sync failed' });
  }
});

export default router;
