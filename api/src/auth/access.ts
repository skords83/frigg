import { query } from '../db';

// An addressbook is visible to a user if they own it (via their own
// carddav_accounts row) or it was explicitly shared with them.
export async function getVisibleAddressbookIds(userId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT ab.id FROM addressbooks ab
     JOIN carddav_accounts ca ON ca.id = ab.carddav_account_id
     WHERE ca.user_id = $1
     UNION
     SELECT addressbook_id FROM addressbook_access WHERE user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.id);
}

export async function canAccessAddressbook(userId: string, addressbookId: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1
     FROM addressbooks ab
     LEFT JOIN carddav_accounts ca ON ca.id = ab.carddav_account_id
     LEFT JOIN addressbook_access aa ON aa.addressbook_id = ab.id AND aa.user_id = $1
     WHERE ab.id = $2 AND (ca.user_id = $1 OR aa.user_id = $1)`,
    [userId, addressbookId]
  );
  return rows.length > 0;
}

// Ownership (via carddav_accounts.user_id) is distinct from access: only the
// owner may grant/revoke sharing on an addressbook.
export async function isAddressbookOwner(userId: string, addressbookId: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM addressbooks ab
     JOIN carddav_accounts ca ON ca.id = ab.carddav_account_id
     WHERE ab.id = $1 AND ca.user_id = $2`,
    [addressbookId, userId]
  );
  return rows.length > 0;
}
