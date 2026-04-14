import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../lib/auth.js';
import { createPatch } from 'diff';

const SPEC_SYSTEM_PROMPT = `You are a frontend engineering specification writer. You are given a unified diff between an original HTML page and a modified version. Produce a detailed, actionable specification of all changes made.

Format the spec as markdown with these sections:
- **Summary**: 1-2 sentence overview of what changed
- **CSS Changes**: List every modified, added, or removed CSS rule with before/after values. Group by component/selector.
- **HTML Structure Changes**: Describe structural changes (added/removed/moved elements) with example HTML blocks showing the relevant before/after markup.
- **Content Changes**: Any text, labels, or copy that changed.

Rules:
- Be specific — include exact property values, class names, selectors
- Show code blocks for CSS and HTML examples
- Ignore [asset:N] placeholders — these are image/font references, not relevant to the spec
- Focus only on meaningful changes, skip whitespace/formatting differences
- Use relative descriptions ("the header component", "the sidebar nav") not line numbers
- Lines starting with - are removed, lines starting with + are added, lines starting with space are context`;

function stripDataUrisForSpec(html: string): string {
  let counter = 0;
  return html.replace(/data:[^"'\s)]+/g, () => `[asset:${counter++}]`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const { snapshotBlobUrl, versionBlobUrl, prompt, snapshotName, versionLabel } = req.body;

    if (!snapshotBlobUrl || !versionBlobUrl) {
      return res.status(400).json({ error: 'Missing snapshotBlobUrl or versionBlobUrl' });
    }

    // Fetch both HTMLs
    const [originalResp, modifiedResp] = await Promise.all([
      fetch(snapshotBlobUrl),
      fetch(versionBlobUrl),
    ]);

    if (!originalResp.ok) {
      return res.status(502).json({ error: `Failed to fetch original HTML: ${originalResp.status}` });
    }
    if (!modifiedResp.ok) {
      return res.status(502).json({ error: `Failed to fetch modified HTML: ${modifiedResp.status}` });
    }

    const originalHtml = stripDataUrisForSpec(await originalResp.text());
    const modifiedHtml = stripDataUrisForSpec(await modifiedResp.text());

    // Compute unified diff — only the changes + 3 lines of context
    const patch = createPatch(
      'page.html',
      originalHtml,
      modifiedHtml,
      'original',
      'modified',
      { context: 3 },
    );

    const userMessage = `The user's remix prompt was: "${prompt || 'N/A'}"

<diff>
${patch}
</diff>

Produce the change specification.`;

    // Call Claude API directly
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8192,
        system: SPEC_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      return res.status(502).json({ error: `Claude API error: ${claudeResp.status} ${errText}` });
    }

    const claudeData = await claudeResp.json();
    const spec = claudeData.content
      ?.filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('') || '';

    const title = `# Spec: ${snapshotName || 'snapshot'} ${versionLabel || ''}\n\n`;

    res.json({ spec: title + spec });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}
