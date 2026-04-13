import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../lib/auth.js';
import { startRemixJob } from '../lib/agent.js';
import type { RemixRequest } from '../lib/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body as RemixRequest;
    const { prompt, count, snapshotName, model } = body;

    if (!prompt || !count) {
      return res.status(400).json({ error: 'Missing prompt or count' });
    }

    if (!body.snapshotBlobId || !body.dataUriMapBlobId) {
      return res.status(400).json({ error: 'Missing snapshot blob URLs' });
    }

    const jobId = await startRemixJob({
      snapshotBlobUrl: body.snapshotBlobId,
      dataUriMapBlobUrl: body.dataUriMapBlobId,
      prompt,
      model: model || 'claude-sonnet-4-6',
      count,
      snapshotName,
    });

    res.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}
