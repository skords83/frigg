import { Router, Request, Response } from 'express';
import { runSync } from '../sync';

const router = Router();

// POST /api/sync — trigger manual sync
// POST /api/sync?force=true — force full re-parse of all contacts (fixes stale parsed fields)
router.post('/', async (req: Request, res: Response) => {
  try {
    const force = req.query['force'] === 'true';
    const result = await runSync(force);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'sync failed' });
  }
});

export default router;
