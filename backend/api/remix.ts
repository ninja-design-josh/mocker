import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { validateAuth } from '../lib/auth.js';
import { runRemixAgent } from '../lib/agent.js';
import type { RemixRequest, VariationResult } from '../lib/types.js';

function sendSSE(res: VercelResponse, event: string, data: Record<string, unknown>) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function restoreDataUris(html: string, dataUriMap: string[]): string {
  return html.replace(/\{\{DATAURI_(\d+)\}\}/g, (_match, index) => {
    return dataUriMap[parseInt(index, 10)] || _match;
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!validateAuth(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const body = req.body as RemixRequest;
    const { prompt, count, snapshotName } = body;

    if (!prompt || !count) {
      sendSSE(res, 'error', { message: 'Missing prompt or count' });
      return res.end();
    }

    let strippedHtml = body.strippedHtml || '';
    let dataUriMap = body.dataUriMap || [];

    try {
      // If blob URLs were provided (large snapshot), fetch from Blob storage
      if (body.snapshotBlobId) {
        const resp = await fetch(body.snapshotBlobId);
        strippedHtml = await resp.text();
      }
      if (body.dataUriMapBlobId) {
        const resp = await fetch(body.dataUriMapBlobId);
        dataUriMap = await resp.json();
      }

      if (!strippedHtml) {
        sendSSE(res, 'error', { message: 'No HTML content provided' });
        return res.end();
      }

      const results: VariationResult[] = [];

      for (let i = 1; i <= count; i++) {
        sendSSE(res, 'progress', {
          variation: i,
          total: count,
          step: `Starting variation ${i} of ${count}...`,
        });

        // Run agent in a Sandbox microVM — returns modified HTML
        const modifiedHtml = await runRemixAgent({
          strippedHtml,
          prompt,
          variationNumber: i,
          onProgress: (step) => {
            sendSSE(res, 'progress', { variation: i, total: count, step });
          },
        });

        // Restore data URIs
        sendSSE(res, 'progress', {
          variation: i,
          total: count,
          step: `Restoring assets for variation ${i}...`,
        });

        const finalHtml = restoreDataUris(modifiedHtml, dataUriMap);

        // Upload to Vercel Blob
        sendSSE(res, 'progress', {
          variation: i,
          total: count,
          step: `Uploading variation ${i}...`,
        });

        const fileName = `${snapshotName}/remix-${i}.html`;
        const blob = await put(`mocker/${fileName}`, finalHtml, {
          access: 'public',
          contentType: 'text/html',
        });

        const result: VariationResult = {
          variationNumber: i,
          blobUrl: blob.url,
          fileName: `remix-${i}.html`,
        };
        results.push(result);

        sendSSE(res, 'variation-complete', { ...result });
      }

      sendSSE(res, 'done', { results });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      sendSSE(res, 'error', { message });
    }

    res.end();
  } catch (outerErr) {
    const msg = outerErr instanceof Error ? outerErr.message : 'Unknown error';
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    } else {
      sendSSE(res, 'error', { message: msg });
      res.end();
    }
  }
}
