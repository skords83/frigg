import { Router, Response } from 'express';
import { createDAVClient } from 'tsdav';
import { query, pool } from '../db';
import { encryptSecret } from '../crypto';
import { invalidateAccountClient } from '../carddav';
import type { AuthedRequest } from '../auth/middleware';

const router = Router();

interface CardDavAccountView {
  id: string;
  carddav_url: string;
  username: string;
  created_at: string;
}

// GET /api/carddav-accounts — the current user's own account(s). Never
// returns the stored credential material, only connection metadata.
router.get('/', async (req: AuthedRequest, res: Response) => {
  const accounts = await query<CardDavAccountView>(
    `SELECT id, carddav_url, username, created_at
     FROM carddav_accounts WHERE user_id = $1 ORDER BY created_at ASC`,
    [req.user!.id]
  );
  res.json({ accounts });
});

async function verifyConnection(carddavUrl: string, username: string, password: string): Promise<string | null> {
  try {
    const client = await createDAVClient({
      serverUrl: carddavUrl,
      credentials: { username, password },
      authMethod: 'Basic',
      defaultAccountType: 'carddav',
    });
    await client.fetchAddressBooks();
    return null;
  } catch (err) {
    return (err as Error).message ?? 'connection failed';
  }
}

// POST /api/carddav-accounts — self-service: each user connects their own
// Baïkal account. Validates the credentials against the server before storing.
router.post('/', async (req: AuthedRequest, res: Response) => {
  const { carddav_url, username, password } = req.body ?? {};
  if (typeof carddav_url !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const connectionError = await verifyConnection(carddav_url, username, password);
  if (connectionError) {
    return res.status(400).json({ error: 'connection_failed', detail: connectionError });
  }

  const { ciphertext, iv, authTag } = encryptSecret(password);
  try {
    const [created] = await query<CardDavAccountView>(
      `INSERT INTO carddav_accounts (user_id, carddav_url, username, password_encrypted, password_iv, password_auth_tag)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, carddav_url, username, created_at`,
      [req.user!.id, carddav_url, username, ciphertext, iv, authTag]
    );
    res.status(201).json({ account: created });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'account_already_connected' });
    }
    throw err;
  }
});

// PUT /api/carddav-accounts/:id — rotate credentials on an existing account.
router.put('/:id', async (req: AuthedRequest, res: Response) => {
  const { id } = req.params;
  const owned = await query<{ id: string }>(
    `SELECT id FROM carddav_accounts WHERE id = $1 AND user_id = $2`,
    [id, req.user!.id]
  );
  if (owned.length === 0) return res.status(404).json({ error: 'not_found' });

  const { carddav_url, username, password } = req.body ?? {};
  if (typeof carddav_url !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const connectionError = await verifyConnection(carddav_url, username, password);
  if (connectionError) {
    return res.status(400).json({ error: 'connection_failed', detail: connectionError });
  }

  const { ciphertext, iv, authTag } = encryptSecret(password);
  const [updated] = await query<CardDavAccountView>(
    `UPDATE carddav_accounts
     SET carddav_url = $2, username = $3, password_encrypted = $4, password_iv = $5, password_auth_tag = $6
     WHERE id = $1
     RETURNING id, carddav_url, username, created_at`,
    [id, carddav_url, username, ciphertext, iv, authTag]
  );
  invalidateAccountClient(id);
  res.json({ account: updated });
});

// DELETE /api/carddav-accounts/:id — unlinks the account. Cascades to its
// addressbooks and their locally cached contacts (nothing is deleted on the
// Baïkal server itself) — the frontend must confirm this with the user.
router.delete('/:id', async (req: AuthedRequest, res: Response) => {
  const { id } = req.params;
  const owned = await query<{ id: string }>(
    `SELECT id FROM carddav_accounts WHERE id = $1 AND user_id = $2`,
    [id, req.user!.id]
  );
  if (owned.length === 0) return res.status(404).json({ error: 'not_found' });

  await pool.query(`DELETE FROM carddav_accounts WHERE id = $1`, [id]);
  invalidateAccountClient(id);
  res.status(204).end();
});

export default router;
