/**
 * Convert a string to a URL-safe slug.
 */
export function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Format a date as YYYY-MM-DD HH:MM:SS.
 */
export function formatDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Guess a MIME type from a URL or file extension.
 */
export function guessMimeType(url) {
  const ext = url.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
    css: 'text/css',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Convert an ArrayBuffer to a base64 string.
 */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Upload a Blob directly to Vercel Blob storage via client upload.
 * Step 1: Get a client token from our backend.
 * Step 2: PUT directly to Vercel Blob (bypasses function body limits).
 * Returns the public blob URL.
 */
export async function uploadToBlob(vercelUrl, vercelApiKey, pathname, blob) {
  const tokenResp = await fetch(`${vercelUrl}/api/upload-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${vercelApiKey}`,
    },
    body: JSON.stringify({
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        callbackUrl: `${vercelUrl}/api/upload-token`,
      },
    }),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    throw new Error(`Failed to get upload token: ${tokenResp.status} ${text}`);
  }

  const { clientToken } = await tokenResp.json();

  const uploadResp = await fetch(
    `https://blob.vercel-storage.com/${pathname}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${clientToken}`,
        'x-content-type': blob.type,
        'x-content-disposition': 'inline',
        'x-add-random-suffix': '1',
        'x-cache-control-max-age': '31536000',
      },
      body: blob,
    }
  );

  if (!uploadResp.ok) {
    const text = await uploadResp.text();
    throw new Error(`Blob upload failed: ${uploadResp.status} ${text}`);
  }

  const result = await uploadResp.json();
  return result.url;
}

/**
 * Upload a user-selected image File to Vercel Blob as a reference image.
 * Returns { url, mediaType, name } — the payload shape consumed by the
 * backend /api/remix referenceImages field.
 *
 * Note: reference-image blob URLs are public-but-unguessable and will be
 * fetched by Claude's servers when passed as `source.type: "url"`.
 */
export async function uploadImageToBlob(file, vercelUrl, vercelApiKey) {
  const mediaType = file.type || guessMimeType(file.name);
  const rawExt = file.name.split('.').pop() || '';
  const safeExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'img';
  const pathname = `mocker/references/${Date.now()}.${safeExt}`;
  const blob = file instanceof Blob ? file : new Blob([file], { type: mediaType });
  const url = await uploadToBlob(vercelUrl, vercelApiKey, pathname, blob);
  return { url, mediaType, name: file.name || 'image' };
}
