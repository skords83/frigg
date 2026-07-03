import { query } from './db';
import { hashPassword } from './auth/password';
import { encryptSecret } from './crypto';

// Runs on every startup. Idempotent: only acts the first time no admin exists yet.
export async function runBootstrap(): Promise<void> {
  const [{ count }] = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'`
  );
  if (Number(count) > 0) return;

  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn(
      '[bootstrap] no admin exists yet and INITIAL_ADMIN_EMAIL/INITIAL_ADMIN_PASSWORD are not set — cannot create initial admin'
    );
    return;
  }

  const normalizedEmail = email.toLowerCase();
  const passwordHash = await hashPassword(password);
  const [admin] = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, must_change_password)
     VALUES ($1, $2, 'admin', true)
     RETURNING id`,
    [normalizedEmail, passwordHash]
  );
  console.log(`[bootstrap] created initial admin ${normalizedEmail} (must change password on first login)`);

  // Preserve continuity for whatever CARDDAV_* credentials were used before multi-account
  // support existed: turn them into this admin's carddav_accounts row, and hand ownership
  // of any addressbooks that were already synced under those credentials to the same row.
  const { CARDDAV_URL, CARDDAV_USERNAME, CARDDAV_PASSWORD } = process.env;
  if (CARDDAV_URL && CARDDAV_USERNAME && CARDDAV_PASSWORD) {
    const enc = encryptSecret(CARDDAV_PASSWORD);
    const [account] = await query<{ id: string }>(
      `INSERT INTO carddav_accounts (user_id, carddav_url, username, password_encrypted, password_iv, password_auth_tag)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [admin.id, CARDDAV_URL, CARDDAV_USERNAME, enc.ciphertext, enc.iv, enc.authTag]
    );
    const backfilled = await query(
      `UPDATE addressbooks SET carddav_account_id = $1 WHERE carddav_account_id IS NULL RETURNING id`,
      [account.id]
    );
    console.log(
      `[bootstrap] linked legacy CARDDAV_* env credentials to admin's carddav_accounts row, backfilled ${backfilled.length} existing addressbook(s)`
    );
  } else {
    console.warn(
      '[bootstrap] CARDDAV_URL/CARDDAV_USERNAME/CARDDAV_PASSWORD not fully set — no legacy CardDAV account migrated, admin will need to connect one via Settings'
    );
  }
}
