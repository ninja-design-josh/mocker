import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateAuth } from '../lib/auth.js';
import { startRemixJob } from '../lib/agent.js';
import type { RemixRequest, BentoReference } from '../lib/types.js';

const BENTO_DIR = join(process.cwd(), 'bento');

function loadBentoReference(): BentoReference {
  const tokensPath = join(BENTO_DIR, 'bento-tokens.css');
  const componentsPath = join(BENTO_DIR, 'bento.css');
  const referencePath = join(BENTO_DIR, 'bento-reference.md');

  for (const p of [tokensPath, componentsPath, referencePath]) {
    if (!existsSync(p)) {
      throw new Error(`Bento reference file missing at ${p}`);
    }
  }

  return {
    tokensCss: readFileSync(tokensPath, 'utf-8'),
    componentsCss: readFileSync(componentsPath, 'utf-8'),
    referenceMd: readFileSync(referencePath, 'utf-8'),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body as RemixRequest;
    const { prompt, count, snapshotName, model, referenceImages, useBento } = body;

    if (!prompt || !count) {
      return res.status(400).json({ error: 'Missing prompt or count' });
    }

    if (!body.snapshotBlobId || !body.dataUriMapBlobId) {
      return res.status(400).json({ error: 'Missing snapshot blob URLs' });
    }

    if (referenceImages) {
      if (!Array.isArray(referenceImages)) {
        return res.status(400).json({ error: 'referenceImages must be an array' });
      }
      if (referenceImages.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 reference images per remix' });
      }
      for (const img of referenceImages) {
        if (!img || typeof img.url !== 'string' || typeof img.mediaType !== 'string') {
          return res.status(400).json({ error: 'Each reference image requires url and mediaType' });
        }
      }
    }

    let bento;
    if (useBento) {
      try {
        bento = loadBentoReference();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        return res.status(500).json({
          error: `Bento reference unavailable; redeploy or disable Bento toggle (${message})`,
        });
      }
    }

    const jobId = await startRemixJob({
      snapshotBlobUrl: body.snapshotBlobId,
      dataUriMapBlobUrl: body.dataUriMapBlobId,
      prompt,
      model: model || 'claude-sonnet-4-6',
      count,
      snapshotName,
      referenceImages,
      bento,
    });

    res.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}
