import { Sandbox } from '@vercel/sandbox';
import type { ReferenceImage, BentoReference } from './types.js';

const SYSTEM_PROMPT = `You are an expert web developer modifying an HTML page.
You have access to a single file: page.html in the current directory.

Efficiency rules — these are critical for keeping costs down:
- The file may be very large (1MB+). NEVER read the entire file sequentially.
- Use Grep to search for specific elements, classes, IDs, or text content
- Use Read with offset/limit to read only the sections you need
- Use Bash (wc -l page.html) to check the file size first
- Make targeted edits using the Edit tool — do NOT rewrite the entire file
- Preserve all {{DATAURI_N}} placeholders exactly as-is — these are image/font references
- Preserve the indentation and formatting style of the original
- Only change what the user's instructions ask for
- When done, do not output anything — your edits to the file are the result

Snapshot rules — the file is a static HTML snapshot:
- All <script> tags have already been removed — do NOT add any back
- Do NOT add external resource references (CDN links, analytics, tracking scripts)
- Do NOT add <link rel="preconnect">, <link rel="dns-prefetch">, or tracking pixels
- Keep the file self-contained — prefer inline styles over external stylesheet links
- If restructuring, remove any leftover empty containers or dead markup

Reference images:
- You may be provided with reference images showing the intended visual design and/or different UI states (e.g., empty, filled, error).
- Treat them as strong visual guidance: match layout, typography, spacing, color palette, component style, and behavior conveyed by the states.
- Order of the images is not meaningful — they are a set, not a sequence.
- The images are external references, not assets to embed in page.html.`;

// Built dynamically in startRemixJob so we can inline the Bento reference
// directly into the system prompt. This lets prompt caching warm up the
// component catalog once and saves the agent a ~17KB Read on turn 1.
function buildBentoAddendum(referenceMd: string): string {
  return `

Bento design system — IMPORTANT:
The user has enabled the Bento design system. You MUST apply Bento styling to this page.

The full Bento component catalog (with canonical HTML snippets for every component) is included inline below. You do NOT need to read any file to see it — treat this section as the canonical reference.

How to apply Bento:
1. Scan the page for ALL elements that have a Bento equivalent: buttons, inputs, textareas, selects, checkboxes, radios, cards, badges, tables, tabs, avatars, alerts.
2. Replace or augment each matching element with the canonical Bento snippet — add the appropriate .bento-* classes and structure. For example, every <button> should get bento-button classes, every <input> should get bento-input, every card-like container should use bento-card, tables should use bento-table, etc.
3. For colors, typography, spacing, and radii in any inline styles or new markup, use var(--bento-*) tokens instead of hardcoded hex/pixel values.
4. Preserve the page's content, layout structure, and all {{DATAURI_N}} placeholders. You are restyling elements, not removing or reorganizing content.
5. Do NOT add <link rel="stylesheet"> or <style> tags for Bento — the worker injects bento.css, bento-tokens.css, and bento-safety.css automatically into <head> after your edits.
6. All existing Snapshot rules still apply (no scripts, no CDN links, no tracking).

=== BENTO COMPONENT CATALOG (bento-reference.md) ===
${referenceMd}
=== END BENTO COMPONENT CATALOG ===
`;
}

const FOCUS_ADDENDUM = `

Focus area constraint — CRITICAL:
The user has selected specific elements on the page to modify. A reference image shows these areas highlighted with numbered purple overlays.
- ONLY modify HTML within the elements described in the focus area list at the top of the user's message
- Each focus area includes a CSS selector — use Grep to find these elements in page.html
- Do NOT modify any elements outside the focused areas
- The numbered overlays in the first reference image correspond to the numbered descriptions
`;

// This script runs inside the sandbox microVM — fully self-contained.
// It downloads source files from Blob, installs the Agent SDK, runs the agent
// for each variation, restores data URIs, and uploads results to Blob.
// Status is written to /vercel/sandbox/status.json for polling.
//
// Perf notes:
// - Download + install run in parallel (install is the long pole at 10-20s).
// - npm install uses --prefer-offline --no-audit --no-fund --no-save --loglevel=silent --no-package-lock
//   to skip the registry metadata checks and lockfile writes.
// - Per-variation Bento files are written once at a shared path and only
//   page.html is copied per variation.
// - Post-agent blob uploads (turn log + final HTML) run in parallel.
const WORKER_SCRIPT = `
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const config = JSON.parse(readFileSync('/vercel/sandbox/worker-config.json', 'utf-8'));

const results = [];
const timings = { jobStart: Date.now() };

function updateStatus(status) {
  writeFileSync('/vercel/sandbox/status.json', JSON.stringify(Object.assign({ updatedAt: Date.now(), timings }, status)));
}

function restoreDataUris(html, dataUriMap) {
  return html.replace(/\\{\\{DATAURI_(\\d+)\\}\\}/g, function(match, i) {
    return dataUriMap[parseInt(i)] || match;
  });
}

function npmInstallAsync() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', [
      'install',
      '@anthropic-ai/claude-agent-sdk',
      '@vercel/blob',
      '--prefer-offline',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--no-package-lock',
      '--loglevel=silent',
    ], { cwd: '/vercel/sandbox', stdio: 'pipe' });
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error('npm install exited ' + code)));
    proc.on('error', reject);
  });
}

try {
  updateStatus({ phase: 'installing' });

  // Kick off install + blob downloads in parallel. npm install is the long
  // pole (~10-20s); the blob fetches add ~100-300ms each on top.
  const installStart = Date.now();
  const downloadStart = Date.now();
  const [, strippedHtml, dataUriMap] = await Promise.all([
    npmInstallAsync().then(() => { timings.installDone = Date.now() - installStart; }),
    fetch(config.snapshotBlobUrl).then(r => r.text()).then(v => { timings.htmlDownloadMs = Date.now() - downloadStart; return v; }),
    fetch(config.dataUriMapBlobUrl).then(r => r.json()).then(v => { timings.mapDownloadMs = Date.now() - downloadStart; return v; }),
  ]);
  timings.setupDone = Date.now() - timings.jobStart;

  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const { put } = await import('@vercel/blob');

  // Write Bento files once at a shared path; each variation gets them via
  // a copy rather than four fresh writeFileSyncs (trivial win but free).
  const sharedBento = '/vercel/sandbox/_bento';
  if (config.bento) {
    mkdirSync(sharedBento, { recursive: true });
    writeFileSync(sharedBento + '/bento-tokens.css', config.bento.tokensCss);
    writeFileSync(sharedBento + '/bento.css', config.bento.componentsCss);
    writeFileSync(sharedBento + '/bento-reference.md', config.bento.referenceMd);
    writeFileSync(sharedBento + '/bento-safety.css', config.bento.safetyCss);
  }

  async function runVariation(i) {
    const vStart = Date.now();
    const dir = '/vercel/sandbox/v' + i;
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + '/page.html', strippedHtml);

    // Copy Bento files into the variation dir so the agent can still Read
    // them if it wants. (Content is also inlined into the system prompt.)
    if (config.bento) {
      writeFileSync(dir + '/bento-tokens.css', config.bento.tokensCss);
      writeFileSync(dir + '/bento.css', config.bento.componentsCss);
      writeFileSync(dir + '/bento-reference.md', config.bento.referenceMd);
      writeFileSync(dir + '/bento-safety.css', config.bento.safetyCss);
    }

    const turns = [];
    let turnNum = 0;
    let costUsd = 0;

    const sessionId = 'v' + i + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const refImages = Array.isArray(config.referenceImages) ? config.referenceImages : [];
    const userContent = [
      { type: 'text', text: 'Modify page.html as follows: ' + config.prompt }
    ];
    for (const img of refImages) {
      userContent.push({ type: 'image', source: { type: 'url', url: img.url } });
    }
    async function* userMessages() {
      yield {
        type: 'user',
        session_id: sessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content: userContent },
      };
    }

    for await (const message of query({
      prompt: userMessages(),
      options: {
        cwd: dir,
        systemPrompt: config.systemPrompt,
        model: config.model,
        permissionMode: 'acceptEdits',
        maxTurns: 200,
        maxBudgetUsd: 10.0,
        persistSession: false,
      }
    })) {
      turnNum++;
      const entry = { turn: turnNum, type: message.type, subtype: message.subtype || null };
      if (message.type === 'assistant' && message.message) {
        const content = message.message.content || [];
        entry.tools = content.filter(b => b.type === 'tool_use').map(b => b.name);
        const text = content.filter(b => b.type === 'text').map(b => b.text).join(' ');
        entry.text = text.length > 200 ? text.slice(0, 200) + '...' : text;
        const thinking = content.filter(b => b.type === 'thinking').map(b => b.thinking).join(' ');
        if (thinking) entry.thinking = thinking.length > 300 ? thinking.slice(0, 300) + '...' : thinking;
        if (message.message.usage) {
          const u = message.message.usage;
          entry.inputTokens = u.input_tokens || 0;
          entry.outputTokens = u.output_tokens || 0;
        }
      }
      if (message.type === 'result') {
        if (message.costUsd != null) costUsd = message.costUsd;
        else if (message.cost_usd != null) costUsd = message.cost_usd;
        entry.costUsd = costUsd;
      }
      turns.push(entry);
      updateStatus({ phase: 'editing', variation: i, total: config.count, results, turn: turnNum, turns, costUsd });

      if (message.type === 'result' && message.subtype !== 'success') {
        const errors = 'errors' in message ? message.errors.join('; ') : '';
        throw new Error('Agent failed (variation ' + i + '): ' + message.subtype + (errors ? ' - ' + errors : ''));
      }
    }

    updateStatus({ phase: 'uploading', variation: i, total: config.count, results });
    let modified = readFileSync(dir + '/page.html', 'utf-8');

    let bentoInjection = null;
    if (config.bento) {
      const injection =
        '<style data-bento="safety">' + config.bento.safetyCss + '</style>' +
        '<style data-bento="tokens">' + config.bento.tokensCss + '</style>' +
        '<style data-bento="components">' + config.bento.componentsCss + '</style>';

      // Insert right after opening <head>; fall back sensibly.
      if (/<head\\b[^>]*>/i.test(modified)) {
        modified = modified.replace(/(<head\\b[^>]*>)/i, '$1' + injection);
        bentoInjection = 'head-start';
      } else if (/<\\/head>/i.test(modified)) {
        modified = modified.replace(/(<\\/head>)/i, injection + '$1');
        bentoInjection = 'head-end';
      } else if (/<html\\b[^>]*>/i.test(modified)) {
        modified = modified.replace(/(<html\\b[^>]*>)/i, '$1' + injection);
        bentoInjection = 'html-start';
      } else {
        modified = injection + modified;
        bentoInjection = 'doc-start';
      }
    }

    const final = restoreDataUris(modified, dataUriMap);

    // Upload turn log + final HTML to Blob in parallel
    const [logBlob, blob] = await Promise.all([
      put('mocker/' + config.snapshotName + '/log-' + i + '.json', JSON.stringify(turns, null, 2), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }),
      put('mocker/' + config.snapshotName + '/remix-' + i + '.html', final, {
        access: 'public',
        contentType: 'text/html',
        addRandomSuffix: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }),
    ]);

    const entry = { variationNumber: i, blobUrl: blob.url, fileName: 'remix-' + i + '.html' };
    if (bentoInjection) entry.bentoInjection = bentoInjection;
    results.push(entry);
    timings['variation' + i + 'Ms'] = Date.now() - vStart;
    updateStatus({ phase: 'variation-complete', variation: i, total: config.count, results, logUrl: logBlob.url });
  }

  // Run all variations in parallel — each gets its own directory
  const outcomes = await Promise.allSettled(
    Array.from({ length: config.count }, (_, i) => runVariation(i + 1))
  );

  const errors = outcomes
    .filter(o => o.status === 'rejected')
    .map(o => o.reason?.message || String(o.reason));

  if (errors.length === config.count) {
    throw new Error(errors.join('; '));
  }

  timings.jobTotalMs = Date.now() - timings.jobStart;
  updateStatus({ phase: 'done', results, errors: errors.length ? errors : undefined });
} catch (err) {
  timings.jobTotalMs = Date.now() - timings.jobStart;
  updateStatus({ phase: 'error', error: err.message || String(err), results });
}
`;

export interface RemixJobStatus {
  phase: string;
  variation?: number;
  total?: number;
  turn?: number;
  costUsd?: number;
  turns?: Array<{ turn: number; type: string; subtype: string | null; tools?: string[]; text?: string; thinking?: string; inputTokens?: number; outputTokens?: number; costUsd?: number }>;
  logUrl?: string;
  results?: Array<{ variationNumber: number; blobUrl: string; fileName: string }>;
  error?: string;
  updatedAt?: number;
  sandboxStatus?: string;
  timings?: Record<string, number>;
}

export async function startRemixJob(opts: {
  snapshotBlobUrl: string;
  dataUriMapBlobUrl: string;
  prompt: string;
  model: string;
  count: number;
  snapshotName: string;
  referenceImages?: ReferenceImage[];
  bento?: BentoReference;
  useFocusAreas?: boolean;
}): Promise<string> {
  const sandbox = await Sandbox.create({
    runtime: 'node22',
    resources: { vcpus: 2 },
    timeout: 2_400_000,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN || '',
    },
  });

  let systemPrompt = SYSTEM_PROMPT;
  if (opts.bento) systemPrompt += buildBentoAddendum(opts.bento.referenceMd);
  if (opts.useFocusAreas) systemPrompt += FOCUS_ADDENDUM;

  const config = {
    snapshotBlobUrl: opts.snapshotBlobUrl,
    dataUriMapBlobUrl: opts.dataUriMapBlobUrl,
    prompt: opts.prompt,
    systemPrompt,
    model: opts.model,
    count: opts.count,
    snapshotName: opts.snapshotName,
    referenceImages: opts.referenceImages || [],
    bento: opts.bento || null,
  };

  await sandbox.writeFiles([
    { path: 'worker-config.json', content: Buffer.from(JSON.stringify(config)) },
    { path: 'worker.mjs', content: Buffer.from(WORKER_SCRIPT) },
    { path: 'status.json', content: Buffer.from(JSON.stringify({ phase: 'starting', updatedAt: Date.now() })) },
  ]);

  await sandbox.runCommand({
    cmd: 'node',
    args: ['worker.mjs'],
    cwd: '/vercel/sandbox',
    detached: true,
  });

  return sandbox.sandboxId;
}

export async function getRemixJobStatus(sandboxId: string): Promise<RemixJobStatus> {
  const sandbox = await Sandbox.get({ sandboxId });

  if (sandbox.status !== 'running') {
    // Sandbox stopped — try to read final status before filesystem is gone
    try {
      const buffer = await sandbox.readFileToBuffer({ path: 'status.json' });
      if (buffer) {
        const status = JSON.parse(buffer.toString('utf-8'));
        // If sandbox stopped but worker didn't write a terminal status, it crashed/timed out
        if (status.phase !== 'done' && status.phase !== 'error') {
          return {
            ...status,
            phase: 'error',
            error: `Sandbox ${sandbox.status} during "${status.phase}" phase (likely timed out)`,
            sandboxStatus: sandbox.status,
          };
        }
        return { ...status, sandboxStatus: sandbox.status };
      }
    } catch {}
    return { phase: 'error', error: `Sandbox ${sandbox.status}`, sandboxStatus: sandbox.status };
  }

  try {
    const buffer = await sandbox.readFileToBuffer({ path: 'status.json' });
    if (!buffer) {
      return { phase: 'starting', sandboxStatus: 'running' };
    }
    const status = JSON.parse(buffer.toString('utf-8'));

    // Stop sandbox once work is complete
    if (status.phase === 'done' || status.phase === 'error') {
      sandbox.stop().catch(() => {});
    }

    return { ...status, sandboxStatus: 'running' };
  } catch (err) {
    return { phase: 'error', error: err instanceof Error ? err.message : 'Failed to read status' };
  }
}
