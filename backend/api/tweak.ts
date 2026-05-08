import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../lib/auth.js';

const TWEAK_SYSTEM_PROMPT = `You are a CSS/HTML patch generator for a web page editor. Given an HTML snapshot and a user's instruction, produce a minimal JSON patch that applies the requested change.

Return ONLY a single JSON object, no prose, no markdown fences. Shape:
{
  "patches": [
    {
      "selector": "css selector matching the element(s) to change",
      "styles": { "css-property": "value" },
      "attributes": { "attribute-name": "value" },
      "text": "new text content, or null"
    }
  ]
}

Rules:
- Return one patch object per distinct selector. One selector may match multiple elements — the patch will be applied to all of them.
- For SVG elements (svg, path, circle, rect, line, polyline, polygon, ellipse, etc.), ALWAYS use "attributes" (fill, stroke, stroke-width) — not "styles". SVG presentation attributes must be set as HTML attributes, not CSS.
- Use the most specific selector that is still correct and stable. Prefer class or id selectors over element type selectors alone.
- Omit "styles", "attributes", or "text" keys entirely when they have no changes.
- "text" replaces the direct text content of the element. Use only when the instruction is to change visible copy. Set to null or omit when not changing text.
- If the change cannot be expressed as a CSS style, HTML attribute, or text content change (e.g. adding new HTML sections, restructuring layout, changing component hierarchy), return exactly: {"patches":[],"fallback":"remix"}
- Never return full HTML. Return only the JSON patch object.`;

function stripDataUris(html: string): string {
  let counter = 0;
  return html.replace(/data:[^"'\s)]+/g, () => `[asset:${counter++}]`);
}

interface Patch {
  selector: string;
  styles?: Record<string, string>;
  attributes?: Record<string, string>;
  text?: string | null;
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
    const { html, prompt, selector } = req.body;

    if (!html || !prompt) {
      return res.status(400).json({ error: 'Missing html or prompt' });
    }

    const strippedHtml = stripDataUris(html);

    const instruction = selector
      ? `Element context: the user selected \`${selector}\`.\n\nInstruction: "${prompt}"`
      : `Instruction: "${prompt}"`;

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: TWEAK_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: strippedHtml,
                cache_control: { type: 'ephemeral' },
              },
              {
                type: 'text',
                text: instruction,
              },
            ],
          },
        ],
      }),
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      return res.status(502).json({ error: `Claude API error: ${claudeResp.status} ${errText}` });
    }

    const claudeData = await claudeResp.json();
    const rawText: string =
      claudeData.content
        ?.filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('') || '';

    // Extract JSON from the response (may have stray whitespace or thinking text)
    let patches: Patch[] = [];
    let fallback: string | undefined;

    const trimmed = rawText.trim();
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(candidate);
        patches = Array.isArray(parsed.patches) ? parsed.patches : [];
        if (typeof parsed.fallback === 'string') fallback = parsed.fallback;
      } catch {
        return res.status(502).json({ error: 'Claude returned malformed JSON' });
      }
    } else {
      return res.status(502).json({ error: 'Claude returned no JSON object' });
    }

    // Compute cost from token usage. Anthropic returns these as three independent
    // buckets — input_tokens does NOT include the cache buckets, they're separate.
    // claude-haiku-4-5: $0.80/MTok input, $4.00/MTok output,
    //   $0.08/MTok cache read, $1.00/MTok cache write.
    const usage = claudeData.usage || {};
    const inputTokens: number = usage.input_tokens || 0;
    const outputTokens: number = usage.output_tokens || 0;
    const cacheReadTokens: number = usage.cache_read_input_tokens || 0;
    const cacheWriteTokens: number = usage.cache_creation_input_tokens || 0;
    const costUsd =
      inputTokens * 0.0000008 +
      outputTokens * 0.000004 +
      cacheReadTokens * 0.00000008 +
      cacheWriteTokens * 0.000001;

    if (fallback) {
      return res.json({ patches: [], fallback, costUsd });
    }

    res.json({ patches, costUsd });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}
