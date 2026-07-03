import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import contactsRouter from './routes/contacts';
import addressbooksRouter from './routes/addressbooks';
import syncRouter from './routes/sync';
import { startSyncSchedule } from './sync';
import { runBootstrap } from './bootstrap';

const app = express();

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '20mb' })); // photos can be sizeable

app.use('/api/contacts', contactsRouter);
app.use('/api/addressbooks', addressbooksRouter);
app.use('/api/sync', syncRouter);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  await runBootstrap();
  app.listen(PORT, () => {
    console.log(`frigg-api listening on :${PORT}`);
    if (process.env.CARDDAV_URL) {
      startSyncSchedule();
    } else {
      console.warn('[sync] CARDDAV_URL not set — sync disabled');
    }
  });
}

main().catch((err) => {
  console.error('[bootstrap] fatal error during startup', err);
  process.exit(1);
});
