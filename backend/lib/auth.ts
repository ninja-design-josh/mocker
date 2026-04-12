import type { VercelRequest } from '@vercel/node';

export function validateAuth(req: VercelRequest): boolean {
  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/i, '');
  const secret = process.env.MOCKER_API_SECRET;
  if (!secret) return false;

  return token === secret;
}
