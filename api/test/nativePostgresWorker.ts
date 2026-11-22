// Test-only process: real Express routes, real pg pool and real DAV traffic.
import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from '../src/db';
import { requireAuth, requireActive } from '../src/auth/middleware';
import contacts from '../src/routes/contacts';
import operations from '../src/routes/operations';
import { runSync } from '../src/sync';

if (!process.env.FRIGG_NATIVE_PG?.startsWith('/tmp/frigg-native-pg-') || process.env.DATABASE_URL) throw new Error('isolated test cluster required');
let gate: string | undefined;
let release: (() => void) | undefined;
async function pause(point: string) {
  if (gate !== point) return;
  gate = undefined;
  await new Promise<void>(resolve => { release = resolve; process.send!({event:'paused',point}); });
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  await pause(method);
  const response = await originalFetch(input, init);
  if (['PUT','DELETE'].includes(method)) process.send!({event:'dav',method,status:response.status});
  return response;
};
const originalQuery = pool.query.bind(pool);
pool.query = (async (sql: string, params?: unknown[]) => {
  if (sql.startsWith('UPDATE contact_operations SET status=')) await pause(`checkpoint-${params?.[0]}`);
  if (sql.startsWith('UPDATE contact_operations SET status=') && params?.[0]==='target_verified') {
    await pause('target-written');
    if (gate === 'database-break') {
      gate = undefined;
      // An actual running pg query, cancelled by terminating its backend from the parent.
      await originalQuery('SELECT pg_sleep(30) /* frigg_failure_injection */');
    }
  }
  return originalQuery(sql, params);
}) as typeof pool.query;
const app = express();app.use(express.json());app.use(cookieParser());
app.use('/api/contacts',requireAuth,requireActive,contacts);
app.use('/api/operations',requireAuth,requireActive,operations);
const server=app.listen(0,'127.0.0.1',()=>process.send!({event:'ready',port:(server.address() as {port:number}).port}));
process.on('message',async(message: {action:string;point?:string})=>{
  if(message.action==='gate'){gate=message.point;process.send!({event:'armed'});}
  if(message.action==='release'){release?.();release=undefined;}
  if(message.action==='sync'){
    try {process.send!({event:'sync',result:await runSync(true)});}
    catch {process.send!({event:'sync',error:true});}
  }
});
