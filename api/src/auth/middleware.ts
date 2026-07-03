import { Request, Response, NextFunction } from 'express';
import { validateSession, AuthedUser, SESSION_COOKIE_NAME } from './sessions';

export interface AuthedRequest extends Request {
  user?: AuthedUser;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) return res.status(401).json({ error: 'unauthenticated' });

  const user = await validateSession(sessionId);
  if (!user) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'unauthenticated' });
  }

  req.user = user;
  next();
}

// Blocks everything except the auth routes needed to actually change the
// password, so a forced reset can't be sidestepped by just ignoring the flag.
export function requireActive(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({ error: 'must_change_password' });
  }
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}
