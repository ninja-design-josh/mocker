import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { v4 as uuid } from 'uuid';
import { validateAuth } from '../lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { html, name } = req.body as { html: string; name?: string };
    if (!html) {
      return res.status(400).json({ error: 'Missing html field' });
    }

    const blobId = uuid();
    const fileName = name || `snapshot-${blobId}.html`;

    const blob = await put(`mocker/${fileName}`, html, {
      access: 'public',
      contentType: 'text/html',
    });

    res.json({ blobId, url: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}
