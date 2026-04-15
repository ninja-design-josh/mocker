import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Pass-through proxy for Vercel Blob URLs that serves them as inline HTML.
 *
 * Blob URLs default to attachment disposition and/or generic content-types,
 * which causes Chrome to download instead of render when opened in a tab.
 * This endpoint streams the blob back with text/html + inline so the browser
 * renders the snapshot. No auth: blob URLs are already public, and the URL
 * is opened directly via chrome.tabs.create (can't attach Authorization).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const rawUrl = req.query.url;
  const url = typeof rawUrl === 'string' ? rawUrl : '';
  if (!url) {
    res.status(400).send('Missing url query parameter');
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).send('Invalid url');
    return;
  }

  // Only allow Vercel Blob hosts to prevent open-proxy / SSRF abuse.
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.blob.vercel-storage.com')) {
    res.status(400).send('URL must be a Vercel Blob URL');
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).send(`Upstream fetch failed: ${message}`);
    return;
  }

  if (!upstream.ok || !upstream.body) {
    res.status(502).send(`Upstream returned ${upstream.status}`);
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.status(200).send(buffer);
}
