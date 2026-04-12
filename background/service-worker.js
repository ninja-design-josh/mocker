import { commitSnapshot as gitlabCommit } from '../lib/gitlab-api.js';
import { commitSnapshot as githubCommit } from '../lib/github-api.js';
import { guessMimeType, arrayBufferToBase64 } from '../lib/utils.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const STORAGE_KEY = 'mocker_settings';

const SIZE_WARNING_BYTES = 10 * 1024 * 1024; // 10 MB

let lastCapture = null;

/**
 * Send progress updates to the popup.
 */
function sendProgress(percent, text) {
  chrome.runtime.sendMessage({ action: 'captureProgress', percent, text }).catch(() => {
    // Popup may be closed — ignore
  });
}

/**
 * Fetch a resource and return it as a data URI.
 * Returns null if the fetch fails (graceful degradation).
 */
async function fetchAsDataUri(url) {
  try {
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) return null;

    const contentType = resp.headers.get('content-type') || guessMimeType(url);
    const buffer = await resp.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const mime = contentType.split(';')[0].trim();
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * Fetch a CSS file as text. Resolves @import directives recursively.
 */
async function fetchCss(url, visited = new Set()) {
  if (visited.has(url)) return '';
  visited.add(url);

  try {
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) return '';
    let css = await resp.text();

    // Resolve @import directives
    const importPattern = /@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])\s*;/g;
    const imports = [];
    let match;
    while ((match = importPattern.exec(css)) !== null) {
      const importUrl = match[1] || match[2];
      const resolvedUrl = new URL(importUrl, url).href;
      imports.push({ fullMatch: match[0], resolvedUrl });
    }

    for (const imp of imports) {
      const importedCss = await fetchCss(imp.resolvedUrl, visited);
      css = css.replace(imp.fullMatch, importedCss);
    }

    return css;
  } catch {
    return '';
  }
}

/**
 * Extract all url() references from CSS text.
 */
function extractCssUrls(css, baseUrl) {
  const urls = new Set();
  const pattern = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    const ref = match[1];
    if (ref && !ref.startsWith('data:') && !ref.startsWith('#')) {
      try {
        urls.add(new URL(ref, baseUrl).href);
      } catch {
        // Invalid URL
      }
    }
  }
  return urls;
}

/**
 * Replace all url() references in CSS with data URIs from the resource map.
 */
function replaceCssUrls(css, baseUrl, resourceMap) {
  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (fullMatch, ref) => {
    if (ref.startsWith('data:') || ref.startsWith('#')) return fullMatch;
    try {
      const absoluteUrl = new URL(ref, baseUrl).href;
      const dataUri = resourceMap.get(absoluteUrl);
      if (dataUri) return `url("${dataUri}")`;
    } catch {
      // Invalid URL
    }
    return fullMatch;
  });
}

/**
 * Extract original <link rel="stylesheet"> href values from raw HTML using regex.
 * Avoids needing DOMParser (not available in service workers).
 */
function extractLinkHrefs(html) {
  const hrefs = [];
  const pattern = /<link\s[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0];
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (hrefMatch) {
      hrefs.push(hrefMatch[1]);
    }
  }
  // Also match when href comes before rel
  const pattern2 = /<link\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi;
  while ((match = pattern2.exec(html)) !== null) {
    const href = match[1];
    if (!hrefs.includes(href)) {
      hrefs.push(href);
    }
  }
  return hrefs;
}

/**
 * Main capture orchestration.
 */
async function captureSnapshot(tabId, snapshotName, branchName, sourceUrl) {
  // Step 1: Inject content script to capture DOM
  sendProgress(10, 'Capturing page DOM...');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/capture.js'],
  });

  if (!results || !results[0] || !results[0].result) {
    throw new Error('Failed to capture page. Make sure you\'re on a regular web page.');
  }

  const capture = results[0].result;
  const { html, resourceUrls, stylesheetUrls, inlineStyles, baseURI } = capture;

  // Step 2: Fetch external stylesheets and resolve @imports
  sendProgress(20, `Fetching stylesheets (${stylesheetUrls.length})...`);

  const stylesheetContents = [];
  for (const url of stylesheetUrls) {
    const css = await fetchCss(url);
    stylesheetContents.push({ url, css });
  }

  // Step 3: Collect all resource URLs from CSS
  const allResourceUrls = new Set(resourceUrls);

  for (const { url, css } of stylesheetContents) {
    for (const resUrl of extractCssUrls(css, url)) {
      allResourceUrls.add(resUrl);
    }
  }

  // Also extract from inline styles collected by the content script
  for (const css of inlineStyles) {
    for (const resUrl of extractCssUrls(css, baseURI)) {
      allResourceUrls.add(resUrl);
    }
  }

  // Step 4: Fetch all resources as data URIs
  const total = allResourceUrls.size;
  let fetched = 0;
  const resourceMap = new Map();

  // Fetch in batches of 10 for performance
  const urlArray = [...allResourceUrls];
  const batchSize = 10;

  for (let i = 0; i < urlArray.length; i += batchSize) {
    const batch = urlArray.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(url => fetchAsDataUri(url)));

    for (let j = 0; j < batch.length; j++) {
      if (batchResults[j]) {
        resourceMap.set(batch[j], batchResults[j]);
      }
      fetched++;
    }

    const pct = 30 + Math.round((fetched / Math.max(total, 1)) * 50);
    sendProgress(pct, `Fetching resources (${fetched}/${total})...`);
  }

  // Step 5: Replace CSS url() references with data URIs
  const processedStylesheets = stylesheetContents.map(({ url, css }) => ({
    url,
    css: replaceCssUrls(css, url, resourceMap),
  }));

  // Step 6: Map original <link> href attributes to processed CSS.
  // Use regex to extract hrefs from the raw HTML (no DOMParser in service worker).
  sendProgress(85, 'Assembling snapshot...');

  const originalHrefs = extractLinkHrefs(html);
  const stylesheetContentsFinal = originalHrefs.map(href => {
    const absoluteHref = new URL(href, baseURI).href;
    const found = processedStylesheets.find(s => s.url === absoluteHref);
    return {
      url: href,
      css: found ? found.css : '',
    };
  });

  // Step 7: Inject assemble.js into the tab to do DOM manipulation
  // (DOMParser is available in page context, not in service workers)
  const assembleResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: (params) => {
      const { html, sourceUrl, resourceMapEntries, stylesheetContents } = params;
      const resourceMap = new Map(resourceMapEntries);

      function formatDate() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }

      function resolveUrl(url) {
        if (!url || url.startsWith('data:')) return url;
        try { return new URL(url, sourceUrl).href; } catch { return url; }
      }

      function replaceUrlInCss(css, originalUrl, dataUri) {
        const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return css.replace(
          new RegExp(`url\\(\\s*["']?${escaped}["']?\\s*\\)`, 'g'),
          `url("${dataUri}")`
        );
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Remove all script tags
      doc.querySelectorAll('script').forEach(el => el.remove());

      // Remove on* event handlers and nonce attributes
      for (const el of doc.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
          if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
        }
        if (el.hasAttribute('nonce')) el.removeAttribute('nonce');
      }

      // Remove CSP meta tags
      doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(el => el.remove());

      // Replace external stylesheets with inlined <style> tags
      for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
        const href = link.getAttribute('href');
        const entry = stylesheetContents.find(e => e.url === href);
        if (entry) {
          const style = doc.createElement('style');
          style.textContent = entry.css;
          link.replaceWith(style);
        } else {
          link.remove();
        }
      }

      // Replace resource URLs in style tags and inline styles
      for (const [absoluteUrl, dataUri] of resourceMap) {
        for (const styleEl of doc.querySelectorAll('style')) {
          styleEl.textContent = replaceUrlInCss(styleEl.textContent, absoluteUrl, dataUri);
        }
        for (const el of doc.querySelectorAll('[style]')) {
          const style = el.getAttribute('style');
          if (style.includes(absoluteUrl)) {
            el.setAttribute('style', replaceUrlInCss(style, absoluteUrl, dataUri));
          }
        }
      }

      // Replace image sources
      for (const img of doc.querySelectorAll('img')) {
        const src = img.getAttribute('src');
        if (src) {
          const resolved = resolveUrl(src);
          if (resourceMap.has(resolved)) img.setAttribute('src', resourceMap.get(resolved));
        }
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          img.setAttribute('srcset', srcset.replace(/(\S+)(\s+\S+)?/g, (m, url, desc) => {
            const d = resourceMap.get(resolveUrl(url));
            return d ? `${d}${desc || ''}` : m;
          }));
        }
      }

      // Handle <source> in <picture>
      for (const source of doc.querySelectorAll('source')) {
        const srcset = source.getAttribute('srcset');
        if (srcset) {
          source.setAttribute('srcset', srcset.replace(/(\S+)(\s+\S+)?/g, (m, url, desc) => {
            const d = resourceMap.get(resolveUrl(url));
            return d ? `${d}${desc || ''}` : m;
          }));
        }
      }

      // Replace favicon hrefs
      for (const link of doc.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')) {
        const href = link.getAttribute('href');
        if (href) {
          const resolved = resolveUrl(href);
          if (resourceMap.has(resolved)) link.setAttribute('href', resourceMap.get(resolved));
        }
      }

      // Ensure charset and viewport
      if (!doc.querySelector('meta[charset]')) {
        const meta = doc.createElement('meta');
        meta.setAttribute('charset', 'utf-8');
        doc.head.prepend(meta);
      }
      if (!doc.querySelector('meta[name="viewport"]')) {
        const meta = doc.createElement('meta');
        meta.setAttribute('name', 'viewport');
        meta.setAttribute('content', 'width=device-width, initial-scale=1');
        doc.head.prepend(meta);
      }

      // Add metadata comment
      const comment = doc.createComment(
        ` Mocker Snapshot | Source: ${sourceUrl} | Date: ${formatDate()} `
      );
      doc.documentElement.insertBefore(comment, doc.documentElement.firstChild);

      return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    },
    args: [{
      html,
      sourceUrl,
      resourceMapEntries: [...resourceMap.entries()],
      stylesheetContents: stylesheetContentsFinal,
    }],
  });

  if (!assembleResults || !assembleResults[0] || !assembleResults[0].result) {
    throw new Error('Failed to assemble snapshot.');
  }

  const snapshot = assembleResults[0].result;

  // Size check
  const sizeBytes = new Blob([snapshot]).size;
  if (sizeBytes > SIZE_WARNING_BYTES) {
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
    console.warn(`Mocker: Snapshot is ${sizeMB} MB — this is large and may be slow to commit.`);
  }

  // Step 8: Commit to provider
  const settingsResult = await chrome.storage.sync.get(STORAGE_KEY);
  const provider = settingsResult[STORAGE_KEY]?.provider || 'gitlab';
  const providerName = provider === 'github' ? 'GitHub' : 'GitLab';
  const commit = provider === 'github' ? githubCommit : gitlabCommit;

  sendProgress(90, `Saving to ${providerName}...`);

  const result = await commit(snapshotName, branchName, snapshot);

  sendProgress(100, 'Done!');

  lastCapture = { html: snapshot, snapshotName, branchName };

  return result;
}

/**
 * Replace all data URIs in HTML with numbered placeholders.
 * Returns the stripped HTML and a map to restore them later.
 */
function stripDataUris(html) {
  const dataUriMap = [];
  const strippedHtml = html.replace(/data:[^"'\s)]+/g, (match) => {
    const index = dataUriMap.length;
    dataUriMap.push(match);
    return `{{DATAURI_${index}}}`;
  });
  return { strippedHtml, dataUriMap };
}

/**
 * Restore data URI placeholders back to their original values.
 */
function restoreDataUris(html, dataUriMap) {
  return html.replace(/\{\{DATAURI_(\d+)\}\}/g, (match, index) => {
    return dataUriMap[parseInt(index, 10)] || match;
  });
}

/**
 * Send remix progress updates to the popup.
 */
function sendRemixProgress(current, total, text) {
  chrome.runtime.sendMessage({ action: 'remixProgress', current, total, text }).catch(() => {});
}

/**
 * Call Claude API to generate a remix variation, then commit it.
 */
async function remixSnapshot(prompt, count) {
  if (!lastCapture) {
    throw new Error('No snapshot captured yet. Capture a snapshot first.');
  }

  const settingsResult = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = settingsResult[STORAGE_KEY];
  const claudeApiKey = settings?.claudeApiKey;

  if (!claudeApiKey) {
    throw new Error('Claude API key not configured. Add it in Settings.');
  }

  const provider = settings.provider || 'gitlab';
  const commit = provider === 'github' ? githubCommit : gitlabCommit;

  const { strippedHtml, dataUriMap } = stripDataUris(lastCapture.html);
  const results = [];

  for (let i = 1; i <= count; i++) {
    sendRemixProgress(i, count, `Generating variation ${i} of ${count}...`);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 64000,
        system: 'You are an expert web developer. Modify this HTML page according to the user\'s instructions. Return ONLY the complete modified HTML — no explanation, no markdown fences. Preserve all {{DATAURI_N}} placeholders exactly as-is.',
        messages: [
          {
            role: 'user',
            content: `Here is the HTML page:\n\n${strippedHtml}\n\n---\n\nModify it as follows: ${prompt}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Claude API error (${resp.status}): ${body}`);
    }

    const data = await resp.json();
    let remixHtml = data.content?.[0]?.text || '';

    // Strip markdown fences if Claude wrapped the response
    remixHtml = remixHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');

    const finalHtml = restoreDataUris(remixHtml, dataUriMap);
    const fileName = `remix-${i}.html`;

    sendRemixProgress(i, count, `Committing variation ${i} of ${count}...`);

    const commitResult = await commit(
      lastCapture.snapshotName,
      lastCapture.branchName,
      finalHtml,
      fileName
    );

    results.push({ fileName, fileUrl: commitResult.fileUrl });
  }

  return results;
}

/**
 * Listen for messages from the popup.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'captureSnapshot') {
    captureSnapshot(msg.tabId, msg.snapshotName, msg.branchName, msg.sourceUrl)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message || 'Unknown error' }));
    return true;
  }

  if (msg.action === 'remixSnapshot') {
    remixSnapshot(msg.prompt, msg.count)
      .then(results => sendResponse({ results }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
