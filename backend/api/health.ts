import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../lib/auth.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const hasAuthHeader = !!req.headers['authorization'];
  const authenticated = hasAuthHeader ? validateAuth(req) : false;

  if (hasAuthHeader && !authenticated) {
    return res.status(401).json({ error: 'Unauthorized', timestamp: new Date().toISOString() });
  }

  res.json({ status: 'ok', authenticated, timestamp: new Date().toISOString() });
}
