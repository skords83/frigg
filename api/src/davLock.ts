import type { RequestHandler, Response } from 'express';
import { pool } from './db';
import type { AuthedRequest } from './auth/middleware';

/** Serialize local mutations with sync, including across API processes. */
export function withDavLock(handler: (req: AuthedRequest, res: Response) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    let connection;
    try { connection = await pool.connect(); } catch { res.status(503).json({error:'database_unavailable'}); return; }
    let locked = false;
    try {
      const result = await connection.query('SELECT pg_try_advisory_lock(186702, 1) AS locked');
      locked = result.rows[0].locked;
      if (!locked) { res.status(423).json({error:'operation_busy'}); return; }
      await handler(req as AuthedRequest, res);
    } catch {
      if (!res.headersSent) res.status(503).json({ error: 'operation_unavailable' });
    } finally {
      try { if (locked) await connection.query('SELECT pg_advisory_unlock(186702, 1)'); }
      catch { connection.release(true); return; }
      connection.release();
    }
  };
}
