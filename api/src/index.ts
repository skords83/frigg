import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import contactsRouter from './routes/contacts';
import addressbooksRouter from './routes/addressbooks';
import syncRouter from './routes/sync';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import carddavAccountsRouter from './routes/carddav-accounts';
import usersRouter from './routes/users';
import groupsRouter from './routes/groups';
import transferRouter from './routes/transfer';
import { startSyncSchedule } from './sync';
import { runBootstrap } from './bootstrap';
import { requireAuth, requireActive, requireAdmin } from './auth/middleware';

const app = express();

// Behind Traefik — needed so req.ip / rate limiting see the real client IP.
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '20mb' })); // photos can be sizeable
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/admin', requireAuth, requireActive, requireAdmin, adminRouter);
app.use('/api/contacts', requireAuth, requireActive, contactsRouter);
app.use('/api/addressbooks', requireAuth, requireActive, addressbooksRouter);
app.use('/api/sync', requireAuth, requireActive, syncRouter);
app.use('/api/carddav-accounts', requireAuth, requireActive, carddavAccountsRouter);
app.use('/api/users', requireAuth, requireActive, usersRouter);
app.use('/api/groups', requireAuth, requireActive, groupsRouter);
app.use('/api/transfer', requireAuth, requireActive, transferRouter);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  await runBootstrap();
  app.listen(PORT, () => {
    console.log(`frigg-api listening on :${PORT}`);
    // CardDAV accounts now live in the carddav_accounts table, not env vars —
    // runSync() itself no-ops gracefully when there are zero accounts.
    startSyncSchedule();
  });
}

main().catch((err) => {
  console.error('[bootstrap] fatal error during startup', err);
  process.exit(1);
});
