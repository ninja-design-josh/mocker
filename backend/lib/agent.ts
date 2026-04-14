import { Sandbox } from '@vercel/sandbox';

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
- If restructuring, remove any leftover empty containers or dead markup`;

// This script runs inside the sandbox microVM — fully self-contained.
// It downloads source files from Blob, installs the Agent SDK, runs the agent
// for each variation, restores data URIs, and uploads results to Blob.
// Status is written to /vercel/sandbox/status.json for polling.
const WORKER_SCRIPT = `
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('/vercel/sandbox/worker-config.json', 'utf-8'));

function updateStatus(status) {
  writeFileSync('/vercel/sandbox/status.json', JSON.stringify(Object.assign({ updatedAt: Date.now() }, status)));
}

function restoreDataUris(html, dataUriMap) {
  return html.replace(/\\{\\{DATAURI_(\\d+)\\}\\}/g, function(match, i) {
    return dataUriMap[parseInt(i)] || match;
  });
}

try {
  updateStatus({ phase: 'downloading' });
  const htmlResp = await fetch(config.snapshotBlobUrl);
  const strippedHtml = await htmlResp.text();
  const mapResp = await fetch(config.dataUriMapBlobUrl);
  const dataUriMap = await mapResp.json();

  updateStatus({ phase: 'installing' });
  execSync('npm install @anthropic-ai/claude-agent-sdk @vercel/blob', {
    cwd: '/vercel/sandbox',
    stdio: 'pipe',
  });

  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const { put } = await import('@vercel/blob');

  const results = [];

  for (let i = 1; i <= config.count; i++) {
    writeFileSync('/vercel/sandbox/page.html', strippedHtml);
    const turns = [];
    let turnNum = 0;
    let costUsd = 0;
    updateStatus({ phase: 'editing', variation: i, total: config.count, results });

    for await (const message of query({
      prompt: 'Modify page.html as follows: ' + config.prompt,
      options: {
        cwd: '/vercel/sandbox',
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
        throw new Error('Agent failed: ' + message.subtype + (errors ? ' - ' + errors : ''));
      }
    }

    // Upload turn log to Blob for debugging
    const logBlob = await put('mocker/' + config.snapshotName + '/log-' + i + '.json', JSON.stringify(turns, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    updateStatus({ phase: 'uploading', variation: i, total: config.count, results, logUrl: logBlob.url });
    const modified = readFileSync('/vercel/sandbox/page.html', 'utf-8');
    const final = restoreDataUris(modified, dataUriMap);

    const blob = await put('mocker/' + config.snapshotName + '/remix-' + i + '.html', final, {
      access: 'public',
      contentType: 'text/html',
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    results.push({ variationNumber: i, blobUrl: blob.url, fileName: 'remix-' + i + '.html' });
    updateStatus({ phase: 'variation-complete', variation: i, total: config.count, results });
  }

  updateStatus({ phase: 'done', results });
} catch (err) {
  updateStatus({ phase: 'error', error: err.message || String(err) });
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
}

export async function startRemixJob(opts: {
  snapshotBlobUrl: string;
  dataUriMapBlobUrl: string;
  prompt: string;
  model: string;
  count: number;
  snapshotName: string;
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

  const config = {
    snapshotBlobUrl: opts.snapshotBlobUrl,
    dataUriMapBlobUrl: opts.dataUriMapBlobUrl,
    prompt: opts.prompt,
    systemPrompt: SYSTEM_PROMPT,
    model: opts.model,
    count: opts.count,
    snapshotName: opts.snapshotName,
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
