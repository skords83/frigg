import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

pool.on('error', () => {
  // pg-pool errors can include the client and its connection/authentication state.
  console.error('Unexpected PG pool error; connection discarded');
});

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
