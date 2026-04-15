import { commitSnapshot as gitlabCommit } from '../lib/gitlab-api.js';
import { commitSnapshot as githubCommit } from '../lib/github-api.js';
import { guessMimeType, arrayBufferToBase64, uploadToBlob } from '../lib/utils.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const STORAGE_KEY = 'mocker_settings';

const SIZE_WARNING_BYTES = 10 * 1024 * 1024; // 10 MB

// In-memory active context: which snapshot/version we're working with
let activeContext = { snapshotId: null, versionId: null, html: null };

// ── IndexedDB v2: snapshots + versions ───────────────────────────────────

function openMockerDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mocker_data', 3);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // Migrate from v1 if old store exists
      if (e.oldVersion < 2) {
        if (db.objectStoreNames.contains('captures')) {
          db.deleteObjectStore('captures');
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          const snap = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
          snap.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('versions')) {
          const ver = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
          ver.createIndex('snapshotId', 'snapshotId');
          ver.createIndex('parentId', 'parentId');
          ver.createIndex('snapshotId_depth', ['snapshotId', 'depth']);
        }
      }
      // v3: add referenceImages field to versions (no-op upgrade — additive, no new index)
      // Existing version rows simply won't have the field, which is treated as "no references".
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSnapshot(snapshot) {
  const db = await openMockerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    const store = tx.objectStore('snapshots');
    const req = store.add(snapshot);
    req.onsuccess = () => resolve(req.result); // returns auto-increment id
    tx.onerror = () => reject(tx.error);
  });
}

async function getSnapshot(id) {
  const db = await openMockerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const req = tx.objectStore('snapshots').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(tx.error);
  });
}

async function getAllSnapshots() {
  const db = await openMockerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const req = tx.objectStore('snapshots').index('createdAt').openCursor(null, 'prev');
    const results = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(tx.error);
  });
}

async function saveVersion(version) {
  const db = await openMockerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('versions', 'readwrite');
    const store = tx.objectStore('versions');
    const req = store.add(version);
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function getVersion(id) {
  const db = await openMockerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('versions', 'readonly');
    const req = tx.objectStore('versions').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(tx.error);
  });
}

async function getVersionsForSnapshot(snapshotId) {
  const db = await openMockerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('versions', 'readonly');
    const idx = tx.objectStore('versions').index('snapshotId');
    const req = idx.getAll(snapshotId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(tx.error);
  });
}

// Also try to migrate the old mocker_captures DB data on first run
async function migrateOldDb() {
  try {
    const oldReq = indexedDB.open('mocker_captures', 1);
    oldReq.onsuccess = async () => {
      const oldDb = oldReq.result;
      if (!oldDb.objectStoreNames.contains('captures')) { oldDb.close(); return; }
      try {
        const tx = oldDb.transaction('captures', 'readonly');
        const getReq = tx.objectStore('captures').get('last');
        getReq.onsuccess = async () => {
          const old = getReq.result;
          oldDb.close();
          if (old && old.snapshotName) {
            // Save as a snapshot in the new DB
            await saveSnapshot({
              snapshotName: old.snapshotName,
              sourceUrl: '',
              blobUrl: null,
              repoUrl: null,
              branchName: old.branchName || null,
              createdAt: Date.now(),
            });
          }
          // Delete old DB
          indexedDB.deleteDatabase('mocker_captures');
        };
      } catch { oldDb.close(); }
    };
    oldReq.onerror = () => {};
  } catch { /* ignore */ }
}

// Run migration on startup
migrateOldDb();

/**
 * Send progress updates to the popup.
 */
function sendProgress(percent, text) {
  chrome.runtime.sendMessage({ action: 'captureProgress', percent, text }).catch(() => {
    // Popup may be closed — ignore
  });
}

/**
 * Check if a URL is same-origin relative to a base URL.
 */
function isSameOrigin(url, baseUrl) {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return true; // Can't parse → treat as same-origin, inline it
  }
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
 * Fetch a resource and upload it to Vercel Blob, returning the public URL.
 * Returns null if the fetch or upload fails (graceful degradation).
 */
async function fetchAndUploadResource(url, vercelUrl, vercelApiKey) {
  try {
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || guessMimeType(url);
    const mime = contentType.split(';')[0].trim();
    const buffer = await resp.arrayBuffer();
    const urlPath = new URL(url).pathname.split('/').pop() || 'resource';
    const pathname = `mocker/assets/${urlPath}`;
    const blob = new Blob([buffer], { type: mime });
    return await uploadToBlob(vercelUrl, vercelApiKey, pathname, blob);
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
    if (isSameOrigin(url, baseURI)) {
      const css = await fetchCss(url);
      stylesheetContents.push({ url, css });
    }
    // Cross-origin: not fetched → link tag preserved as-is in assembler
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

  // Read settings early so we can use Vercel Blob for resource uploads
  const settingsResult = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = settingsResult[STORAGE_KEY] || {};
  const vercelUrl = settings.vercelUrl;
  const vercelApiKey = settings.vercelApiKey;
  const useBlob = !!(vercelUrl && vercelApiKey);

  // Step 4: Fetch all resources (upload to Blob when available, else data URIs)
  const total = allResourceUrls.size;
  let fetched = 0;
  const resourceMap = new Map();

  // Fetch in batches of 10 for performance
  const urlArray = [...allResourceUrls];
  const batchSize = 10;

  for (let i = 0; i < urlArray.length; i += batchSize) {
    const batch = urlArray.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(url =>
      useBlob
        ? fetchAndUploadResource(url, vercelUrl, vercelApiKey)
        : fetchAsDataUri(url)
    ));

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

      // Remove ALL scripts — snapshots are static documents, no script is needed
      doc.querySelectorAll('script').forEach(el => el.remove());

      // Remove tracking and analytics artifacts
      doc.querySelectorAll('img').forEach(el => {
        const w = el.getAttribute('width');
        const h = el.getAttribute('height');
        const src = el.getAttribute('src') || '';
        if ((w === '1' && h === '1') || (w === '0' && h === '0') ||
            /pixel|beacon|track|analytics|\.gif\?/i.test(src)) {
          el.remove();
        }
      });
      doc.querySelectorAll('noscript').forEach(el => el.remove());
      const trackingDomains = ['google-analytics', 'googletagmanager', 'doubleclick',
        'intercom', 'sentry', 'datadoghq', 'churnzero', 'mixpanel', 'hotjar',
        'segment', 'fullstory', 'heap', 'amplitude', 'optimizely', 'crazyegg',
        'newrelic', 'clarity.ms'];
      doc.querySelectorAll('link[rel="preconnect"], link[rel="dns-prefetch"], link[rel="preload"][as="script"]').forEach(el => {
        const href = el.getAttribute('href') || '';
        if (trackingDomains.some(d => href.includes(d))) el.remove();
      });
      doc.querySelectorAll('meta[name="csrf-token"], meta[name="csrf-param"]').forEach(el => el.remove());

      // Remove on* event handlers and nonce attributes
      for (const el of doc.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
          if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
        }
        if (el.hasAttribute('nonce')) el.removeAttribute('nonce');
      }

      // Remove CSP meta tags
      doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(el => el.remove());

      // Fix protocol-relative URLs (//example.com → https://example.com)
      // These break when opened as file:// since they resolve to file://example.com
      for (const el of doc.querySelectorAll('[src], [href]')) {
        for (const attr of ['src', 'href']) {
          const val = el.getAttribute(attr);
          if (val && val.startsWith('//') && !val.startsWith('///')) {
            el.setAttribute(attr, 'https:' + val);
          }
        }
      }

      // Deduplicate stylesheet links
      const seenHrefs = new Set();
      doc.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
        const href = el.getAttribute('href');
        if (seenHrefs.has(href)) { el.remove(); return; }
        seenHrefs.add(href);
      });

      // Replace external stylesheets with inlined <style> tags
      for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
        const href = link.getAttribute('href');
        const entry = stylesheetContents.find(e => e.url === href);
        if (entry) {
          const style = doc.createElement('style');
          style.textContent = entry.css;
          link.replaceWith(style);
        }
        // Cross-origin links without a matching entry are kept as-is
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

      // === CSS Optimization: purge unused rules, prune fonts, minify ===

      // Helper: test if a CSS selector matches any element in the document
      function selectorMatchesDoc(selectorText) {
        return selectorText.split(',').some(sel => {
          // Strip pseudo-classes and pseudo-elements before testing
          const cleaned = sel
            .replace(/::[\w-]+(\([^)]*\))?/g, '')
            .replace(/:[\w-]+(\([^)]*\))?/g, '')
            .replace(/\s+/g, ' ').trim();
          if (!cleaned) return true; // Pure pseudo selector — keep
          try { return !!doc.querySelector(cleaned); }
          catch { return true; } // Invalid selector — keep to be safe
        });
      }

      // Phase 1: Remove CSS rules whose selectors don't match any element
      for (const styleEl of doc.querySelectorAll('style')) {
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(styleEl.textContent);
          const kept = [];
          for (const rule of sheet.cssRules) {
            if (rule.type === CSSRule.STYLE_RULE) {
              if (selectorMatchesDoc(rule.selectorText)) kept.push(rule.cssText);
            } else if (rule.type === CSSRule.MEDIA_RULE) {
              const inner = [];
              for (const r of rule.cssRules) {
                if (r.type === CSSRule.STYLE_RULE) {
                  if (selectorMatchesDoc(r.selectorText)) inner.push(r.cssText);
                } else inner.push(r.cssText);
              }
              if (inner.length) kept.push(`@media ${rule.conditionText}{${inner.join('')}}`);
            } else {
              kept.push(rule.cssText);
            }
          }
          styleEl.textContent = kept.join('\n');
        } catch { /* CSS parse error — skip purge for this block */ }
      }

      // Phase 2: Prune @font-face for font families not referenced in any rule
      const usedFonts = new Set();
      function collectFonts(rules) {
        for (const rule of rules) {
          if (rule.type === CSSRule.FONT_FACE_RULE) continue;
          if (rule.style) {
            const ff = rule.style.getPropertyValue('font-family');
            if (ff) ff.split(',').forEach(f => usedFonts.add(f.trim().replace(/["']/g, '').toLowerCase()));
          }
          if (rule.cssRules) collectFonts(rule.cssRules);
        }
      }
      for (const styleEl of doc.querySelectorAll('style')) {
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(styleEl.textContent);
          collectFonts(sheet.cssRules);
        } catch { /* skip */ }
      }
      for (const el of doc.querySelectorAll('[style]')) {
        const m = (el.getAttribute('style') || '').match(/font-family\s*:\s*([^;]+)/i);
        if (m) m[1].split(',').forEach(f => usedFonts.add(f.trim().replace(/["']/g, '').toLowerCase()));
      }
      for (const styleEl of doc.querySelectorAll('style')) {
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(styleEl.textContent);
          const kept = [];
          for (const rule of sheet.cssRules) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
              const family = rule.style.getPropertyValue('font-family')
                .replace(/["']/g, '').toLowerCase().trim();
              if (usedFonts.has(family)) kept.push(rule.cssText);
            } else {
              kept.push(rule.cssText);
            }
          }
          styleEl.textContent = kept.join('\n');
        } catch { /* skip */ }
      }

      // Phase 3: Minify CSS and remove empty style tags
      for (const styleEl of doc.querySelectorAll('style')) {
        let css = styleEl.textContent;
        css = css.replace(/\/\*[\s\S]*?\*\//g, '');
        css = css.replace(/\n\s*/g, ' ');
        css = css.replace(/\s{2,}/g, ' ');
        css = css.replace(/;\s*}/g, '}');
        css = css.trim();
        if (!css) { styleEl.remove(); continue; }
        styleEl.textContent = css;
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

      // Lightweight recursive DOM serializer for readable, indented HTML output
      function prettifyHtml(node, depth) {
        const indent = '  '.repeat(depth);
        const inlineTags = new Set([
          'a', 'abbr', 'b', 'bdo', 'br', 'cite', 'code', 'em', 'i', 'img',
          'input', 'kbd', 'label', 'link', 'mark', 'meta', 'q', 's', 'samp',
          'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
        ]);
        const voidTags = new Set([
          'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
          'link', 'meta', 'source', 'track', 'wbr',
        ]);
        const verbatimTags = new Set(['style', 'pre', 'code', 'script', 'textarea']);

        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent;
          if (!text.trim()) return '';
          return indent + text.trim();
        }
        if (node.nodeType === Node.COMMENT_NODE) {
          return indent + '<!--' + node.textContent + '-->';
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();
        let attrs = '';
        for (const attr of node.attributes) {
          attrs += ` ${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`;
        }

        if (voidTags.has(tag)) {
          return `${indent}<${tag}${attrs}>`;
        }

        if (verbatimTags.has(tag)) {
          return `${indent}<${tag}${attrs}>${node.innerHTML}</${tag}>`;
        }

        const children = [];
        for (const child of node.childNodes) {
          const s = prettifyHtml(child, depth + 1);
          if (s) children.push(s);
        }

        const isInline = inlineTags.has(tag);
        if (isInline || children.length === 0) {
          const inner = children.map(c => c.trim()).join('');
          return `${indent}<${tag}${attrs}>${inner}</${tag}>`;
        }

        return `${indent}<${tag}${attrs}>\n${children.join('\n')}\n${indent}</${tag}>`;
      }

      return '<!DOCTYPE html>\n' + prettifyHtml(doc.documentElement, 0);
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

  // Step 8: Upload to Blob (primary) and optionally commit to repo
  const result = {};

  if (useBlob) {
    sendProgress(90, 'Uploading to Blob...');
    const blobUrl = await uploadToBlob(
      vercelUrl, vercelApiKey,
      `mocker/${snapshotName}/snapshot.html`,
      new Blob([snapshot], { type: 'text/html' })
    );
    result.previewUrl = blobUrl;
    result.blobUrl = blobUrl;
  }

  // Conditionally commit to Git repo
  const shouldCommitToRepo = settings.defaultSaveToRepo;
  const hasRepoCreds = settings.provider === 'github'
    ? !!(settings.githubToken && settings.githubOwner && settings.githubRepo)
    : !!(settings.gitlabUrl && settings.accessToken && settings.projectId);

  if (shouldCommitToRepo && hasRepoCreds) {
    const provider = settings.provider || 'gitlab';
    const providerName = provider === 'github' ? 'GitHub' : 'GitLab';
    const commit = provider === 'github' ? githubCommit : gitlabCommit;

    sendProgress(93, `Saving to ${providerName}...`);
    const repoResult = await commit(snapshotName, branchName, snapshot);
    result.fileUrl = repoResult.fileUrl;
    result.commitUrl = repoResult.commitUrl;
    result.branch = repoResult.branch;
    result.repoUrl = repoResult.fileUrl;
  } else if (!useBlob) {
    // Legacy mode: no Blob configured, must commit to repo
    const provider = settings.provider || 'gitlab';
    const providerName = provider === 'github' ? 'GitHub' : 'GitLab';
    const commit = provider === 'github' ? githubCommit : gitlabCommit;

    sendProgress(90, `Saving to ${providerName}...`);
    const repoResult = await commit(snapshotName, branchName, snapshot);
    result.fileUrl = repoResult.fileUrl;
    result.commitUrl = repoResult.commitUrl;
    result.branch = repoResult.branch;
    result.repoUrl = repoResult.fileUrl;
  }

  sendProgress(97, 'Saving...');

  // Save to IndexedDB
  const snapshotId = await saveSnapshot({
    snapshotName,
    sourceUrl,
    blobUrl: result.blobUrl || null,
    repoUrl: result.repoUrl || null,
    branchName,
    createdAt: Date.now(),
  });

  // Set active context
  activeContext = { snapshotId, versionId: null, html: snapshot };
  result.snapshotId = snapshotId;

  sendProgress(100, 'Done!');

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
function sendRemixProgress(current, total, text, extra = {}) {
  chrome.runtime.sendMessage({ action: 'remixProgress', current, total, text, ...extra }).catch(() => {});
}

/**
 * Remix via Vercel backend (Agent SDK).
 * Streams SSE from the backend and forwards progress to the sidebar.
 * sourceContext: { snapshotId, versionId?, html, snapshotName }
 */
async function remixViaVercel(prompt, count, settings, sourceContext) {
  const { vercelUrl, vercelApiKey, alsoCommitToRepo } = settings;
  const provider = settings.provider || 'gitlab';
  const commit = provider === 'github' ? githubCommit : gitlabCommit;

  const { strippedHtml, dataUriMap } = stripDataUris(sourceContext.html);
  const snapshotName = sourceContext.snapshotName;

  // Upload stripped HTML and data URI map to Blob
  sendRemixProgress(0, count, 'Uploading snapshot to backend...');

  const snapshotBlobUrl = await uploadToBlob(
    vercelUrl, vercelApiKey,
    `mocker/${snapshotName}-stripped.html`,
    new Blob([strippedHtml], { type: 'text/html' })
  );

  const mapBlobUrl = await uploadToBlob(
    vercelUrl, vercelApiKey,
    `mocker/${snapshotName}-map.json`,
    new Blob([JSON.stringify(dataUriMap)], { type: 'application/json' })
  );

  // Start remix job — returns immediately with a job ID
  sendRemixProgress(0, count, 'Starting remix job...');

  const referenceImages = Array.isArray(sourceContext.referenceImages) ? sourceContext.referenceImages : [];

  const startResp = await fetch(`${vercelUrl}/api/remix`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${vercelApiKey}`,
    },
    body: JSON.stringify({
      snapshotBlobId: snapshotBlobUrl,
      dataUriMapBlobId: mapBlobUrl,
      prompt,
      count,
      snapshotName,
      model: settings.remixModel || 'claude-sonnet-4-6',
      referenceImages: referenceImages.length ? referenceImages : undefined,
    }),
  });

  if (!startResp.ok) {
    const text = await startResp.text();
    throw new Error(`Failed to start remix: ${startResp.status} ${text}`);
  }

  const { jobId } = await startResp.json();

  // Compute version tree depth before polling so we can save incrementally
  const parentId = sourceContext.versionId || null;
  let parentDepth = 0;
  if (parentId) {
    const parentVersion = await getVersion(parentId);
    if (parentVersion) parentDepth = parentVersion.depth;
  }
  const depth = parentId ? parentDepth + 1 : 0;

  let lastLogUrl = null;

  // Save a new result as a version in IndexedDB and notify sidebar
  async function saveResultAsVersion(r) {
    if (r.versionId) return; // already saved
    const vid = await saveVersion({
      snapshotId: sourceContext.snapshotId,
      parentId,
      variationNum: r.variationNum,
      blobUrl: r.fileUrl,
      prompt,
      model: settings.remixModel || 'claude-sonnet-4-6',
      logUrl: lastLogUrl,
      costUsd: null,
      repoUrl: r.repoUrl || null,
      depth,
      referenceImages: referenceImages.length ? referenceImages : undefined,
      createdAt: Date.now(),
    });
    r.versionId = vid;
    // Notify sidebar so version tree updates immediately
    chrome.runtime.sendMessage({
      action: 'remixVariationComplete',
      snapshotId: sourceContext.snapshotId,
    }).catch(() => {});
  }

  // Track and save new results from status polling
  async function processNewResults(statusResults) {
    if (!statusResults) return;
    for (const r of statusResults) {
      if (!results.find(x => x.fileName === r.fileName)) {
        const entry = { fileName: r.fileName, fileUrl: r.blobUrl, variationNum: r.variationNumber || results.length + 1 };
        results.push(entry);
        await saveResultAsVersion(entry);
      }
    }
  }

  // Poll for status — sandbox runs independently, no serverless function timeout
  const results = [];
  const maxPollMs = 45 * 60 * 1000;
  const pollStart = Date.now();

  while (true) {
    await new Promise(r => setTimeout(r, 3000));

    if (Date.now() - pollStart > maxPollMs) {
      throw new Error('Remix timed out after 45 minutes');
    }

    const statusResp = await fetch(
      `${vercelUrl}/api/remix-status?jobId=${encodeURIComponent(jobId)}`,
      { headers: { 'Authorization': `Bearer ${vercelApiKey}` } }
    );

    if (!statusResp.ok) {
      const text = await statusResp.text();
      throw new Error(`Status check failed: ${statusResp.status} ${text}`);
    }

    const status = await statusResp.json();

    if (status.phase === 'done') {
      await processNewResults(status.results);
      break;
    }

    if (status.phase === 'error') {
      // Still save any partial results before throwing
      await processNewResults(status.results);
      throw new Error(status.error || 'Remix failed');
    }

    // Map phase to progress message
    const step = status.phase === 'downloading' ? 'Downloading snapshot...'
      : status.phase === 'installing' ? 'Installing tools in sandbox...'
      : status.phase === 'editing' ? `Agent editing variation ${status.variation} of ${status.total}${status.turn ? ` (turn ${status.turn})` : ''}...`
      : status.phase === 'uploading' ? `Uploading variation ${status.variation}...`
      : status.phase === 'variation-complete' ? `Variation ${status.variation} complete`
      : status.phase === 'starting' ? 'Starting sandbox...'
      : 'Working...';

    if (status.logUrl) lastLogUrl = status.logUrl;
    sendRemixProgress(status.variation || 0, status.total || count, step, {
      turns: status.turns,
      logUrl: lastLogUrl,
      costUsd: status.costUsd,
    });

    // Save completed variations immediately
    await processNewResults(status.results);
  }

  // Optionally commit each remix to Git repo
  const hasRepoCreds = settings.provider === 'github'
    ? !!(settings.githubToken && settings.githubOwner && settings.githubRepo)
    : !!(settings.gitlabUrl && settings.accessToken && settings.projectId);

  if (alsoCommitToRepo && hasRepoCreds) {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      sendRemixProgress(i + 1, results.length, `Committing ${r.fileName} to repo...`);
      const htmlResp = await fetch(r.fileUrl);
      const htmlContent = await htmlResp.text();
      const commitResult = await commit(
        snapshotName,
        sourceContext.branchName || settings.branch || 'main',
        htmlContent,
        r.fileName
      );
      r.repoUrl = commitResult.fileUrl;
    }
  }

  const versionIds = results.map(r => r.versionId).filter(Boolean);

  return { results, logUrl: lastLogUrl, versionIds };
}

/**
 * Call Claude to generate remix variations via Vercel backend.
 * snapshotId passed explicitly from sidebar (survives SW restarts).
 */
async function remixSnapshot(snapshotId, prompt, count, referenceImages) {
  const sid = snapshotId || activeContext.snapshotId;
  if (!sid) {
    throw new Error('No snapshot captured yet. Capture a snapshot first.');
  }

  const settingsResult = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = settingsResult[STORAGE_KEY];

  if (!settings?.vercelUrl || !settings?.vercelApiKey) {
    throw new Error('Vercel backend not configured. Add Backend URL and API Key in Settings.');
  }

  const snapshot = await getSnapshot(sid);
  if (!snapshot) throw new Error('Snapshot not found.');

  // Use in-memory HTML if available, otherwise fetch from blob
  let html = (activeContext.snapshotId === sid && activeContext.html) ? activeContext.html : null;
  if (!html && snapshot.blobUrl) {
    const resp = await fetch(snapshot.blobUrl);
    if (!resp.ok) throw new Error('Failed to fetch snapshot HTML from Blob.');
    html = await resp.text();
    activeContext = { snapshotId: sid, versionId: null, html };
  }
  if (!html) throw new Error('Snapshot has no HTML content.');

  const sourceContext = {
    snapshotId: sid,
    versionId: null,
    html,
    snapshotName: snapshot.snapshotName || 'snapshot',
    branchName: snapshot.branchName,
    referenceImages,
  };

  return remixViaVercel(prompt, count, settings, sourceContext);
}

/**
 * Remix from a specific version (re-remix).
 * Fetches HTML from the version's blobUrl.
 */
async function remixFromVersion(versionId, prompt, count, referenceImages) {
  const version = await getVersion(versionId);
  if (!version) throw new Error('Version not found.');

  if (!version.blobUrl) throw new Error('Version has no blob URL.');

  const settingsResult = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = settingsResult[STORAGE_KEY];

  if (!settings?.vercelUrl || !settings?.vercelApiKey) {
    throw new Error('Vercel backend not configured. Add Backend URL and API Key in Settings.');
  }

  // Fetch HTML from blob
  const resp = await fetch(version.blobUrl);
  if (!resp.ok) throw new Error('Failed to fetch version HTML from Blob.');
  const html = await resp.text();

  const snapshot = await getSnapshot(version.snapshotId);
  const sourceContext = {
    snapshotId: version.snapshotId,
    versionId: version.id,
    html,
    snapshotName: snapshot?.snapshotName || 'snapshot',
    branchName: snapshot?.branchName,
    referenceImages,
  };

  return remixViaVercel(prompt, count, settings, sourceContext);
}

/**
 * On-demand commit of a snapshot or version to Git repo.
 */
async function commitToRepo(snapshotId, versionId) {
  const settingsResult = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = settingsResult[STORAGE_KEY];
  const provider = settings.provider || 'gitlab';
  const commit = provider === 'github' ? githubCommit : gitlabCommit;

  let html, name, branch;
  if (versionId) {
    const version = await getVersion(versionId);
    if (!version || !version.blobUrl) throw new Error('Version not found or has no blob URL.');
    const resp = await fetch(version.blobUrl);
    if (!resp.ok) throw new Error('Failed to fetch version HTML.');
    html = await resp.text();
    const snapshot = await getSnapshot(version.snapshotId);
    name = snapshot?.snapshotName || 'snapshot';
    branch = snapshot?.branchName || settings.branch || 'main';
  } else {
    const snapshot = await getSnapshot(snapshotId);
    if (!snapshot || !snapshot.blobUrl) throw new Error('Snapshot not found or has no blob URL.');
    const resp = await fetch(snapshot.blobUrl);
    if (!resp.ok) throw new Error('Failed to fetch snapshot HTML.');
    html = await resp.text();
    name = snapshot.snapshotName;
    branch = snapshot.branchName || settings.branch || 'main';
  }

  return commit(name, branch, html);
}

/**
 * Listen for messages from the sidebar.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'captureSnapshot') {
    captureSnapshot(msg.tabId, msg.snapshotName, msg.branchName, msg.sourceUrl)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message || 'Unknown error' }));
    return true;
  }

  if (msg.action === 'remixSnapshot') {
    remixSnapshot(msg.snapshotId, msg.prompt, msg.count, msg.referenceImages)
      .then(data => sendResponse({ results: data.results, logUrl: data.logUrl, versionIds: data.versionIds }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === 'remixFromVersion') {
    remixFromVersion(msg.versionId, msg.prompt, msg.count, msg.referenceImages)
      .then(data => sendResponse({ results: data.results, logUrl: data.logUrl, versionIds: data.versionIds }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === 'getVersionTree') {
    getVersionsForSnapshot(msg.snapshotId)
      .then(versions => sendResponse({ versions }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === 'getSnapshots') {
    getAllSnapshots()
      .then(snapshots => sendResponse({ snapshots }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === 'getSnapshotsWithVersions') {
    (async () => {
      try {
        const snapshots = await getAllSnapshots();
        for (const s of snapshots) {
          s.versions = await getVersionsForSnapshot(s.id);
        }
        sendResponse({ snapshots });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (msg.action === 'commitToRepo') {
    commitToRepo(msg.snapshotId, msg.versionId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === 'publishVersion') {
    (async () => {
      try {
        const version = await getVersion(msg.versionId);
        if (!version || !version.blobUrl) throw new Error('Version not found or has no blob URL.');

        const snapshot = await getSnapshot(version.snapshotId);
        const snapshotName = snapshot?.snapshotName || 'snapshot';

        const settingsResult = await chrome.storage.sync.get(STORAGE_KEY);
        const settings = settingsResult[STORAGE_KEY];
        if (!settings?.vercelUrl || !settings?.vercelApiKey) {
          throw new Error('Vercel backend not configured.');
        }

        // Fetch HTML from existing blob and re-upload with inline disposition
        const resp = await fetch(version.blobUrl);
        if (!resp.ok) throw new Error('Failed to fetch version HTML.');
        const html = await resp.text();

        const publishUrl = await uploadToBlob(
          settings.vercelUrl, settings.vercelApiKey,
          `mocker/${snapshotName}/published-${msg.versionLabel || 'version'}.html`,
          new Blob([html], { type: 'text/html' })
        );

        sendResponse({ url: publishUrl });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (msg.action === 'generateSpec') {
    (async () => {
      try {
        const version = await getVersion(msg.versionId);
        if (!version) throw new Error('Version not found.');
        if (!version.blobUrl) throw new Error('Version has no blob URL.');

        const snapshot = await getSnapshot(version.snapshotId);
        if (!snapshot) throw new Error('Snapshot not found.');

        // Always diff against the original snapshot
        if (!snapshot.blobUrl) throw new Error('Snapshot has no blob URL.');
        const snapshotBlobUrl = snapshot.blobUrl;

        const settingsResult = await chrome.storage.sync.get(STORAGE_KEY);
        const settings = settingsResult[STORAGE_KEY];
        if (!settings?.vercelUrl || !settings?.vercelApiKey) {
          throw new Error('Vercel backend not configured.');
        }

        const resp = await fetch(`${settings.vercelUrl}/api/generate-spec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.vercelApiKey}`,
          },
          body: JSON.stringify({
            snapshotBlobUrl,
            versionBlobUrl: version.blobUrl,
            prompt: version.prompt || '',
            snapshotName: snapshot.snapshotName || 'snapshot',
            versionLabel: msg.versionLabel || '',
          }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Spec generation failed: ${resp.status} ${text}`);
        }

        const data = await resp.json();
        sendResponse({ spec: data.spec });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (msg.action === 'loadSnapshot') {
    (async () => {
      try {
        const snapshot = await getSnapshot(msg.snapshotId);
        if (snapshot) {
          // Don't overwrite if we already have this snapshot loaded with HTML
          if (activeContext.snapshotId === snapshot.id && activeContext.html) {
            sendResponse({ snapshot });
            return;
          }
          activeContext = { snapshotId: snapshot.id, versionId: null, html: null };
          // Fetch HTML from blob and wait for it
          if (snapshot.blobUrl) {
            try {
              const resp = await fetch(snapshot.blobUrl);
              activeContext.html = await resp.text();
            } catch { /* non-fatal */ }
          }
        }
        sendResponse({ snapshot });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});
