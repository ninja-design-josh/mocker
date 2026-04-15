import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../lib/auth.js';
import { createPatch } from 'diff';

const SPEC_SYSTEM_PROMPT = `You are a frontend engineering specification writer. You are given a unified diff between a current (original) HTML page and a target (modified) version that shows the desired end state. Produce a detailed, actionable implementation specification that a developer can follow to change the current page into the target state.

The audience is a developer who has only seen the original page. They have not seen the modified version — the spec is their instructions for building it. Write in present/imperative tense, describing the changes that need to be made, not changes that were made.

Format the spec as markdown with these sections:
- **Summary**: 1-2 sentence overview of the changes to implement
- **CSS Changes**: For every CSS rule that needs to be modified, added, or removed, describe the change to make. Include the target values and, where helpful for context, the current values. Group by component/selector.
- **HTML Structure Changes**: Describe the structural changes to make (elements to add, remove, or move). Show example HTML blocks for the target markup; include the current markup only when it's needed to locate the change.
- **Content Changes**: Any text, labels, or copy that needs to be updated — state the new copy.

Rules:
- Write in present/imperative tense ("Update the header background to …", "Add a new section …", "Remove the …"). Do NOT write in past tense ("The header was updated …", "A section was added …").
- Frame every item as an instruction to the developer, not a report of what happened.
- Be specific — include exact property values, class names, selectors.
- Show code blocks for CSS and HTML examples; prefer showing the target state.
- Ignore [asset:N] placeholders — these are image/font references, not relevant to the spec.
- Focus only on meaningful changes, skip whitespace/formatting differences.
- Use relative descriptions ("the header component", "the sidebar nav") not line numbers.
- In the diff, lines starting with - are the current state (to be changed), lines starting with + are the target state (what to implement), lines starting with space are unchanged context.`;

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

    const userMessage = `The original remix prompt that produced the target version was: "${prompt || 'N/A'}"

<diff>
${patch}
</diff>

Produce the implementation specification. Write it as instructions for a developer who needs to change the current page into the target state — present/imperative tense, not a retrospective description.`;

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
