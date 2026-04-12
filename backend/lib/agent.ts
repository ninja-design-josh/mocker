import { Sandbox } from '@vercel/sandbox';

const SYSTEM_PROMPT = `You are an expert web developer modifying an HTML page.
You have access to a single file: page.html in the current directory.

Rules:
- Read the file first to understand its structure
- Make targeted edits using the Edit tool — do NOT rewrite the entire file
- Preserve all {{DATAURI_N}} placeholders exactly as-is — these are image/font references
- Preserve the indentation and formatting style of the original
- Only change what the user's instructions ask for
- When done, do not output anything — your edits to the file are the result`;

// This script runs inside the sandbox microVM
const RUNNER_SCRIPT = `
import { readFileSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';

const config = JSON.parse(readFileSync('/vercel/sandbox/agent-config.json', 'utf-8'));

for await (const message of query({
  prompt: config.prompt,
  options: {
    cwd: '/vercel/sandbox',
    systemPrompt: config.systemPrompt,
    allowedTools: ['Read', 'Edit'],
    permissionMode: 'acceptEdits',
    maxTurns: 20,
    maxBudgetUsd: 2.0,
    persistSession: false,
  }
})) {
  if (message.type === 'assistant' && message.message?.content) {
    for (const block of message.message.content) {
      if ('name' in block) {
        process.stdout.write(JSON.stringify({ type: 'tool', name: block.name }) + '\\n');
      }
    }
  }
  if (message.type === 'result') {
    if (message.subtype !== 'success') {
      const errors = 'errors' in message ? message.errors.join('; ') : '';
      console.error('Agent failed: ' + message.subtype + (errors ? ' \\u2014 ' + errors : ''));
      process.exit(1);
    }
  }
}
`;

export async function runRemixAgent(opts: {
  strippedHtml: string;
  prompt: string;
  variationNumber: number;
  onProgress: (step: string) => void;
}): Promise<string> {
  const { strippedHtml, prompt, variationNumber, onProgress } = opts;

  onProgress(`Creating sandbox for variation ${variationNumber}...`);

  const sandbox = await Sandbox.create({
    runtime: 'node22',
    resources: { vcpus: 2 },
    timeout: 240_000,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    },
  });

  try {
    onProgress(`Installing Agent SDK in sandbox...`);

    const install = await sandbox.runCommand({
      cmd: 'npm',
      args: ['install', '@anthropic-ai/claude-agent-sdk'],
    });

    if (install.exitCode !== 0) {
      const stderr = await install.stderr();
      throw new Error(`Failed to install Agent SDK: ${stderr}`);
    }

    onProgress(`Preparing files for variation ${variationNumber}...`);

    const config = {
      prompt: `Read page.html, then modify it as follows: ${prompt}`,
      systemPrompt: SYSTEM_PROMPT,
    };

    await sandbox.writeFiles([
      { path: 'page.html', content: Buffer.from(strippedHtml) },
      { path: 'agent-config.json', content: Buffer.from(JSON.stringify(config)) },
      { path: 'run-agent.mjs', content: Buffer.from(RUNNER_SCRIPT) },
    ]);

    onProgress(`Agent editing variation ${variationNumber}...`);

    const result = await sandbox.runCommand({
      cmd: 'node',
      args: ['run-agent.mjs'],
      cwd: '/vercel/sandbox',
    });

    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      const stdout = await result.stdout();
      throw new Error(`Agent failed (exit ${result.exitCode}): ${stderr || stdout}`);
    }

    onProgress(`Reading result for variation ${variationNumber}...`);
    const buffer = await sandbox.readFileToBuffer({ path: 'page.html' });
    if (!buffer) throw new Error('Modified page.html not found in sandbox');
    return buffer.toString('utf-8');

  } finally {
    await sandbox.stop().catch(() => {});
  }
}
