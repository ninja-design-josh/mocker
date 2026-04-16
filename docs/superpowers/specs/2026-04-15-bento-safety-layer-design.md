# Bento Safety Layer — Design (v1)

**Problem.** When a Bento-assisted remix adds a Bento element next to an existing page element, the new `.bento-*` element can displace its neighbors. Observed case: adding `.bento-button.bento-button--secondary "More Actions"` beside the page's native "+ New Agent" button squeezed the native button into a shorter/squished shape because the Bento button's flex-default `min-width: auto` refused to shrink and its text forced the row wider.

**Goal.** Add a minimal, conservative CSS safety layer — always injected alongside Bento tokens/components — so Bento elements stay within their containers and can shrink gracefully inside flex rows.

**Non-goals.** (a) Protecting raw agent additions in non-Bento mode (deferred — YAGNI). (b) Stopping the agent from opportunistically rewriting neighboring elements (separate prompt-hygiene concern, tracked separately). (c) A universal CSS reset — too aggressive; risks altering how well-formed captured pages render.

---

## Architecture

One new hand-authored file lives alongside the existing Bento bundle in `backend/bento/`:

- `backend/bento/bento-safety.css` — ~30 lines of defensive CSS, all selectors scoped to `.bento-*` classes or to self-contained media tags.

Loaded the same way as the other three Bento files — `/api/remix.ts` resolves it with `new URL('../bento/bento-safety.css', import.meta.url)` so Vercel's Node File Tracer auto-bundles it with the serverless function. No `includeFiles` glob.

The loaded CSS is passed to the sandbox as a fourth field on the existing `BentoReference` payload. The worker writes it alongside the other Bento files in each variation directory (for parity; the agent never reads it directly) and injects it as a `<style>` block into `<head>` immediately before the tokens and components blocks, inside the existing Bento injection branch. No always-on path; when `useBento` is off, no safety layer is applied.

**Injection order matters.** Safety first → tokens → components. Safety sets defensive defaults like `max-width: 100%` and `min-width: 0`. Bento components set specific sizing (e.g. `.bento-dialog__panel { max-width: 600px }`). With safety earlier in the cascade, component-specific rules override defensive defaults cleanly.

---

## The CSS ruleset

The file is deliberately small and targeted. Every selector is `.bento-*`-scoped or hits self-contained media tags. No `html`/`body`/`*` rules, no universal `box-sizing` reset.

```css
/* Snapshot safety layer — injected into <head> after agent edits.
 * Defensive rules only. Should not change how a well-formed captured
 * page renders; only catch edge cases when new elements are added.
 */

/* Media never exceeds parent bounds. Universal — low risk of harm. */
img, video, svg, canvas, picture, iframe, embed, object {
  max-width: 100%;
  height: auto;
}

/* Anything Bento-classed stays inside its container. */
[class*="bento-"] {
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

/* Bento controls in flex rows can shrink; text wraps instead of overflowing. */
.bento-button,
.bento-badge,
.bento-input,
.bento-select,
.bento-textarea {
  min-width: 0;
  overflow-wrap: break-word;
}

/* Bento tables fit within their parent. */
.bento-table {
  max-width: 100%;
  table-layout: auto;
}

/* Fixed/viewport-anchored Bento elements never exceed the viewport. */
.bento-dialog {
  max-width: 100vw;
  max-height: 100vh;
}
```

### Why these rules, specifically

| Rule | What it prevents |
|---|---|
| `img, video, … { max-width: 100%; height: auto }` | Oversized images blowing out layouts. Conservative enough to almost never harm a well-formed page. |
| `[class*="bento-"] { max-width: 100%; min-width: 0; box-sizing: border-box }` | Bento elements overflowing; flex children refusing to shrink; padding pushing widths past parent bounds. |
| `.bento-button, … { min-width: 0; overflow-wrap: break-word }` | The exact failure mode from the failing screenshot — a Bento button in a flex row with `min-width: auto` shoving siblings. Text wraps before the row expands. |
| `.bento-table { max-width: 100%; table-layout: auto }` | Wide tables overflowing narrow containers. |
| `.bento-dialog { max-width: 100vw; max-height: 100vh }` | Fixed-position dialogs escaping the viewport. |

### What the ruleset deliberately does NOT include

- **No universal `* { box-sizing: border-box }`.** Rewrites sizing across the captured page — Option 2 territory per brainstorming, explicitly rejected.
- **No universal `word-break: break-all`.** Too aggressive; breaks URLs and code samples unnecessarily.
- **No layout-changing rules on the captured page's own classes.** The original page renders exactly as captured; only Bento additions are guarded.
- **No `[data-mocker-added]` selector yet.** Would need the agent to mark its additions in non-Bento mode. Not wired; documented as the forward-compat extension point.

---

## Data / control flow

Same flow as the existing Bento payload, with one added field end-to-end.

### `backend/lib/types.ts`

Add `safetyCss: string` to the existing `BentoReference` interface:

```ts
export interface BentoReference {
  tokensCss: string;
  componentsCss: string;
  referenceMd: string;
  safetyCss: string;
}
```

### `backend/api/remix.ts`

`loadBentoReference` reads a fourth file, using the same NFT URL pattern that already loads the other three:

```ts
const BENTO_SAFETY_URL = new URL('../bento/bento-safety.css', import.meta.url);
// ... existing URLs ...

function loadBentoReference(): BentoReference {
  // existence checks on all four files (same pattern, fail-fast 500 if any is missing)
  return {
    tokensCss: readFileSync(BENTO_TOKENS_URL, 'utf-8'),
    componentsCss: readFileSync(BENTO_COMPONENTS_URL, 'utf-8'),
    referenceMd: readFileSync(BENTO_REFERENCE_URL, 'utf-8'),
    safetyCss: readFileSync(BENTO_SAFETY_URL, 'utf-8'),
  };
}
```

Fail-fast behavior is unchanged: if any file is missing, return `500 "Bento reference unavailable; redeploy or disable Bento toggle (…)"`.

### `backend/lib/agent.ts` — `startRemixJob`

No signature change. `config.bento` already carries the `BentoReference` object, which now includes `safetyCss`. No-op for the TypeScript layer.

### `backend/lib/agent.ts` — `WORKER_SCRIPT`

Two edits to the worker template literal:

1. **Alongside the existing per-variation file writes** (so the agent can `Read` it if desired, though it's not expected to):

```js
if (config.bento) {
  writeFileSync(dir + '/bento-tokens.css', config.bento.tokensCss);
  writeFileSync(dir + '/bento.css', config.bento.componentsCss);
  writeFileSync(dir + '/bento-reference.md', config.bento.referenceMd);
  writeFileSync(dir + '/bento-safety.css', config.bento.safetyCss); // NEW
}
```

2. **In the post-edit injection block**, the injection string is constructed with a new safety `<style>` block first:

```js
const injection =
  '<style data-bento="safety">' + config.bento.safetyCss + '</style>' +
  '<style data-bento="tokens">' + config.bento.tokensCss + '</style>' +
  '<style data-bento="components">' + config.bento.componentsCss + '</style>';
```

All four-tier `<head>` fallback branches use this same injection string. No changes to how `bentoInjection` is recorded on `VariationResult`.

### No extension changes

`RemixRequest` is unchanged. Sidebar UI is unchanged. Service worker is unchanged. This is entirely a backend + sandbox concern.

---

## File additions and edits

| Path | Action | Purpose |
|---|---|---|
| `backend/bento/bento-safety.css` | new | The CSS rule set above |
| `backend/bento/README.md` | edit | Add a short paragraph describing the safety layer |
| `backend/bento/_gallery.html` | edit | Link the new stylesheet alongside existing two so `_gallery.html` renders Bento components with safety applied — confirms rules don't break the gallery |
| `backend/lib/types.ts` | edit | Add `safetyCss` to `BentoReference` |
| `backend/api/remix.ts` | edit | Read the new file via NFT URL pattern, include in the `BentoReference` |
| `backend/lib/agent.ts` | edit | Write the file into each variation dir; inject `<style data-bento="safety">` first in the injection block |
| `CLAUDE.md` | edit | Append a "Safety layer" paragraph to the existing "Bento Integration" subsection |

No deletions, no renames, no file moves.

---

## Validation

Manual acceptance test on the deployed backend, once the plan is implemented:

1. **Reproduce the failing case.** Capture a fresh snapshot of `https://app.devcat.ninja/agency/data/agents/`. Bento on. Remix with `Add More Actions secondary button beside New Agent`, `count: 1`. Expected: both the new `.bento-button--secondary "More Actions"` and the original "+ New Agent" button render side-by-side at their natural sizes. Neither is squished or wrapped into multi-line.

2. **Safety block presence check.** In the resulting HTML `<head>`, three `<style>` tags appear in order: `data-bento="safety"`, `data-bento="tokens"`, `data-bento="components"`. Previous two-tag output means the new field didn't thread through.

3. **DevTools computed-style check.** Inspect the new Bento button. Computed `min-width` resolves to `0px` (not `auto`). Computed `max-width` resolves to `100%` of the parent.

4. **Non-Bento regression.** Capture any page, Bento **off**, trivial prompt (e.g. `add an HTML comment at top of <body>`). Result should contain zero `data-bento-*` strings — the safety layer is only applied when Bento is on.

5. **Fail-fast check.** Delete `backend/bento/bento-safety.css` locally, run `vercel dev`, POST `useBento: true` — handler returns 500 with a "Bento reference unavailable" error naming the missing file. Restore the file before committing.

---

## Self-review notes

- **Placeholders:** none. All paths, code snippets, selectors, and file names are concrete.
- **Internal consistency:** the `BentoReference` interface, `loadBentoReference`, worker writes, and injection all agree on `safetyCss`. The validation steps map 1:1 to components of the design.
- **Scope:** single file + four edits; comfortably one implementation plan.
- **Ambiguity check:** "Bento off → no safety" is the one nuance that could be misread. Explicitly stated: when `useBento` is off, the worker's `if (config.bento) { … }` guard means no safety injection either. Acceptable because Bento is default-on and the reported failure is Bento-specific.
- **Forward compatibility:** the `[data-mocker-added]` selector extension point is named and deferred, not left unspoken.
