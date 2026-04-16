import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../lib/auth.js';
import type { PlanRequest, PlanResponse, PlanQuestion } from '../lib/types.js';

const PLAN_SYSTEM_PROMPT = `You are a remix planner for an HTML snapshot remix tool. You are given a user's remix prompt and an HTML snapshot, and your job is to produce a concise, honest plan of the changes you would make — PLUS any targeted clarifying questions that would materially change the output.

Return ONLY a single JSON object, no prose, no markdown fences. Shape:
{
  "plan": ["short bullet describing a concrete change", "..."],
  "questions": [{ "id": "q1", "question": "...", "suggestedAnswer": "optional short default" }]
}

Rules for the plan:
- 3 to 6 bullets. Each bullet is one concrete change (what element, what change).
- Be specific — reference the actual components/sections you see in the HTML.
- If the prompt is vague, make reasonable assumptions and STATE them in the bullets, then surface the assumption as a question below.
- Do not describe code, just describe the user-visible change.

Rules for questions:
- 0 to 3 questions. Zero is a valid answer. Do NOT invent questions when the prompt is already clear.
- Each question targets a real ambiguity that would change the output (tone, scope, which elements to keep, color direction, layout, copy changes).
- Each question gets a stable id ("q1", "q2", ...) and optionally a short suggestedAnswer the user can accept.

Context flags you will receive:
- useBento=true  → the remix will be restyled using the Bento design system. Prefer Bento-friendly language and mention Bento components (bento-card, bento-button, bento-badge, etc.) in bullets.
- useFocusAreas=true → the user has selected specific elements to edit. Scope the plan only to those areas; do NOT propose changes elsewhere.
- referenceImageCount>0 → the user supplied reference imagery. Reference it in bullets where relevant.

Return JSON only. No prose.`;

function stripDataUris(html: string): string {
  let counter = 0;
  return html.replace(/data:[^"'\s)]+/g, () => `[asset:${counter++}]`);
}

function coerceToPlanResponse(rawText: string): PlanResponse {
  const trimmed = rawText.trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      const plan: string[] = Array.isArray(parsed.plan)
        ? parsed.plan.filter((b: unknown) => typeof b === 'string' && b.trim().length > 0)
        : [];
      const questions: PlanQuestion[] = Array.isArray(parsed.questions)
        ? parsed.questions
            .filter(
              (q: unknown): q is PlanQuestion =>
                !!q && typeof (q as PlanQuestion).question === 'string',
            )
            .slice(0, 3)
            .map((q: PlanQuestion, i: number) => ({
              id: typeof q.id === 'string' && q.id ? q.id : `q${i + 1}`,
              question: q.question,
              suggestedAnswer:
                typeof q.suggestedAnswer === 'string' ? q.suggestedAnswer : undefined,
            }))
        : [];
      if (plan.length > 0) return { plan, questions };
    } catch {
      // fall through to fallback
    }
  }
  // Fallback: split raw text into bullet-looking lines so the UI still renders.
  const fallbackBullets = trimmed
    .split('\n')
    .map((l) => l.replace(/^[\s\-*•]+/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 6);
  return { plan: fallbackBullets.length ? fallbackBullets : [trimmed], questions: [] };
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
    const body = req.body as PlanRequest;
    const {
      snapshotBlobUrl,
      prompt,
      snapshotName,
      useBento,
      useFocusAreas,
      referenceImageCount,
      variationCount,
    } = body;

    if (!snapshotBlobUrl || !prompt) {
      return res.status(400).json({ error: 'Missing snapshotBlobUrl or prompt' });
    }

    const snapshotResp = await fetch(snapshotBlobUrl);
    if (!snapshotResp.ok) {
      return res
        .status(502)
        .json({ error: `Failed to fetch snapshot HTML: ${snapshotResp.status}` });
    }

    const rawHtml = await snapshotResp.text();
    const stripped = stripDataUris(rawHtml);
    // Cap HTML at 180k chars (~45k tokens) so we stay well under model limits.
    const MAX_HTML_CHARS = 180_000;
    const snapshotForPrompt =
      stripped.length > MAX_HTML_CHARS
        ? stripped.slice(0, MAX_HTML_CHARS) + '\n\n<!-- [snapshot truncated for planning] -->'
        : stripped;

    const contextLines = [
      `useBento=${useBento ? 'true' : 'false'}`,
      `useFocusAreas=${useFocusAreas ? 'true' : 'false'}`,
      `referenceImageCount=${referenceImageCount ?? 0}`,
      `variationCount=${variationCount ?? 1}`,
      `snapshotName=${snapshotName || 'snapshot'}`,
    ].join('\n');

    const userMessage = `User remix prompt:
"""
${prompt}
"""

Context flags:
${contextLines}

HTML snapshot (data URIs replaced with [asset:N] placeholders):
<snapshot>
${snapshotForPrompt}
</snapshot>

Produce the JSON object now.`;

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: PLAN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      return res
        .status(502)
        .json({ error: `Claude API error: ${claudeResp.status} ${errText}` });
    }

    const claudeData = await claudeResp.json();
    const rawText: string =
      claudeData.content
        ?.filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('') || '';

    const planResponse = coerceToPlanResponse(rawText);
    res.json(planResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}
