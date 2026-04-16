# Bento Safety Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal, conservative CSS safety layer to the Bento remix bundle so new `.bento-*` elements can shrink inside flex rows and stay within their parent container, preventing the "squished neighbor" visual regression observed when adding a Bento button beside an existing page button.

**Architecture:** One new hand-authored CSS file (`backend/bento/bento-safety.css`) ships alongside the existing Bento payload. It is read by `/api/remix.ts` via the NFT-detectable `new URL(..., import.meta.url)` pattern that already loads the other three Bento files, passed through `startRemixJob` as a fourth field on `BentoReference`, written into each variation's sandbox dir, and injected as `<style data-bento="safety">` BEFORE the existing tokens and components blocks so Bento component-specific rules override defensive defaults.

**Tech Stack:** Vanilla Chrome Extension (MV3, no build step), TypeScript backend on Vercel, Vercel Sandbox (Firecracker microVM), Claude Agent SDK. Mocker has no test harness — validation is manual reproduction of the failing case plus grep-based output checks.

**Spec reference:** `docs/superpowers/specs/2026-04-15-bento-safety-layer-design.md`

---

## Phase 1 — The CSS file

### Task 1: Author `backend/bento/bento-safety.css`

**Files:**
- Create: `backend/bento/bento-safety.css`

- [ ] **Step 1: Create the file with the full ruleset.**

Write `backend/bento/bento-safety.css` with exactly this content:

```css
/* Snapshot safety layer — injected into <head> after agent edits.
 * Defensive rules only. Should not change how a well-formed captured
 * page renders; only catch edge cases when new elements are added.
 * Paired with bento-tokens.css and bento.css; injected first so Bento
 * component rules can override these defensive defaults.
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

- [ ] **Step 2: Verify the file exists and is non-empty.**

```bash
ls -la backend/bento/bento-safety.css
wc -l backend/bento/bento-safety.css
```

Expected: file exists, roughly 35–40 lines.

- [ ] **Step 3: Confirm no disallowed patterns are present.**

The safety file MUST NOT contain universal resets or selectors that could alter the captured page's own elements (`html`, `body`, `*`, or bare-tag rules on form controls).

```bash
# Should produce zero matches for each check.
grep -nE '^\s*\*\s*\{' backend/bento/bento-safety.css ; echo "^ universal * rule (should be empty)"
grep -nE '\b(html|body)\b\s*\{' backend/bento/bento-safety.css ; echo "^ html/body rule (should be empty)"
grep -nE '^(button|input|select|textarea|table)\s*\{' backend/bento/bento-safety.css ; echo "^ bare form-control rule (should be empty)"
```

Expected: all three searches return no matches.

- [ ] **Step 4: Brace-balance check (the only syntax check available — this repo has no CSS parser dependency).**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('backend/bento/bento-safety.css','utf8');const opens=(s.match(/{/g)||[]).length;const closes=(s.match(/}/g)||[]).length;console.log({opens, closes, balanced: opens===closes});"
```

Expected: `balanced: true` and `opens === closes` around 6 each.

- [ ] **Step 5: Commit.**

```bash
git add backend/bento/bento-safety.css
git commit -m "$(cat <<'EOF'
Add bento-safety.css with minimal containment rules

Injected alongside tokens/components when useBento is on. Defensive
rules only — media max-width, .bento-* min-width: 0 / box-sizing,
flex-row shrink fixes, dialog viewport clamp. No universal resets;
no html/body/bare-tag selectors. Targets the squished-neighbor
regression where a new Bento button displaces its flex siblings.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Backend wiring

### Task 2: Extend `BentoReference` with `safetyCss`

**Files:**
- Modify: `backend/lib/types.ts`

- [ ] **Step 1: Add the `safetyCss` field.**

Current state (around line 19):

```ts
/** Bento reference material shipped into the sandbox when useBento=true. */
export interface BentoReference {
  tokensCss: string;
  componentsCss: string;
  referenceMd: string;
}
```

Edit to:

```ts
/** Bento reference material shipped into the sandbox when useBento=true. */
export interface BentoReference {
  tokensCss: string;
  componentsCss: string;
  referenceMd: string;
  safetyCss: string;
}
```

- [ ] **Step 2: Type-check the backend.**

```bash
cd backend && npx tsc --noEmit
```

Expected: errors about `safetyCss` missing on the object literal returned from `loadBentoReference` in `backend/api/remix.ts`. That is intentional — the next task wires it up. If you see OTHER errors, stop and investigate.

- [ ] **Step 3: Commit.**

```bash
cd .. && git add backend/lib/types.ts
git commit -m "$(cat <<'EOF'
Add safetyCss to BentoReference type

Fourth file on the Bento payload. Loader wired up in the next commit;
compile errors about missing safetyCss on the returned literal are
expected until then.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Load `bento-safety.css` in `/api/remix.ts`

**Files:**
- Modify: `backend/api/remix.ts`

- [ ] **Step 1: Add the safety URL constant and include it in the existence check + return value.**

Find the existing URL constants near the top of the file (around line 11):

```ts
const BENTO_TOKENS_URL = new URL('../bento/bento-tokens.css', import.meta.url);
const BENTO_COMPONENTS_URL = new URL('../bento/bento.css', import.meta.url);
const BENTO_REFERENCE_URL = new URL('../bento/bento-reference.md', import.meta.url);
```

Add a fourth:

```ts
const BENTO_TOKENS_URL = new URL('../bento/bento-tokens.css', import.meta.url);
const BENTO_COMPONENTS_URL = new URL('../bento/bento.css', import.meta.url);
const BENTO_REFERENCE_URL = new URL('../bento/bento-reference.md', import.meta.url);
const BENTO_SAFETY_URL = new URL('../bento/bento-safety.css', import.meta.url);
```

Then find `loadBentoReference` (around line 15):

```ts
function loadBentoReference(): BentoReference {
  const entries: Array<{ url: URL; label: string }> = [
    { url: BENTO_TOKENS_URL, label: 'bento-tokens.css' },
    { url: BENTO_COMPONENTS_URL, label: 'bento.css' },
    { url: BENTO_REFERENCE_URL, label: 'bento-reference.md' },
  ];

  for (const e of entries) {
    if (!existsSync(fileURLToPath(e.url))) {
      throw new Error(`Bento reference file missing: ${e.label} at ${e.url.href}`);
    }
  }

  return {
    tokensCss: readFileSync(BENTO_TOKENS_URL, 'utf-8'),
    componentsCss: readFileSync(BENTO_COMPONENTS_URL, 'utf-8'),
    referenceMd: readFileSync(BENTO_REFERENCE_URL, 'utf-8'),
  };
}
```

Change to:

```ts
function loadBentoReference(): BentoReference {
  const entries: Array<{ url: URL; label: string }> = [
    { url: BENTO_TOKENS_URL, label: 'bento-tokens.css' },
    { url: BENTO_COMPONENTS_URL, label: 'bento.css' },
    { url: BENTO_REFERENCE_URL, label: 'bento-reference.md' },
    { url: BENTO_SAFETY_URL, label: 'bento-safety.css' },
  ];

  for (const e of entries) {
    if (!existsSync(fileURLToPath(e.url))) {
      throw new Error(`Bento reference file missing: ${e.label} at ${e.url.href}`);
    }
  }

  return {
    tokensCss: readFileSync(BENTO_TOKENS_URL, 'utf-8'),
    componentsCss: readFileSync(BENTO_COMPONENTS_URL, 'utf-8'),
    referenceMd: readFileSync(BENTO_REFERENCE_URL, 'utf-8'),
    safetyCss: readFileSync(BENTO_SAFETY_URL, 'utf-8'),
  };
}
```

- [ ] **Step 2: Type-check.**

```bash
cd backend && npx tsc --noEmit
```

Expected: zero errors. The `safetyCss` property completes the `BentoReference` contract that Task 2 introduced.

- [ ] **Step 3: Local file-load smoke test.**

```bash
cd backend && node -e "
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const dir = join(process.cwd(), 'bento');
['bento-tokens.css', 'bento.css', 'bento-reference.md', 'bento-safety.css'].forEach(f => {
  const p = join(dir, f);
  if (!existsSync(p)) { console.error('MISSING', p); process.exit(1); }
  const size = readFileSync(p, 'utf-8').length;
  console.log(f, size, 'bytes');
});
"
```

Expected: four lines listing each file with a non-zero byte count. `bento-safety.css` should be ~1–2 KB.

- [ ] **Step 4: Commit.**

```bash
cd .. && git add backend/api/remix.ts
git commit -m "$(cat <<'EOF'
Read bento-safety.css in /api/remix loader

Fourth file on the BentoReference payload, loaded via the same NFT URL
pattern as the existing three. Fail-fast behavior unchanged: a missing
file still returns the "Bento reference unavailable" 500 naming the
file that was missing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Write `bento-safety.css` into each variation's sandbox dir

**Files:**
- Modify: `backend/lib/agent.ts` (the `WORKER_SCRIPT` template literal)

- [ ] **Step 1: Add the safety file write next to the existing three.**

In `backend/lib/agent.ts`, find the per-variation Bento file writes inside `WORKER_SCRIPT` (around lines 76–82):

```js
    if (config.bento) {
      writeFileSync(dir + '/bento-tokens.css', config.bento.tokensCss);
      writeFileSync(dir + '/bento.css', config.bento.componentsCss);
      writeFileSync(dir + '/bento-reference.md', config.bento.referenceMd);
    }
```

Change to:

```js
    if (config.bento) {
      writeFileSync(dir + '/bento-tokens.css', config.bento.tokensCss);
      writeFileSync(dir + '/bento.css', config.bento.componentsCss);
      writeFileSync(dir + '/bento-reference.md', config.bento.referenceMd);
      writeFileSync(dir + '/bento-safety.css', config.bento.safetyCss);
    }
```

The file is written for parity with the other Bento files. The agent is not expected to Read it during editing — the addendum doesn't mention it — but keeping it on disk means debug logs and manual sandbox inspection show the full payload.

- [ ] **Step 2: Type-check (the template literal is JS, but the surrounding TS should still compile).**

```bash
cd backend && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit.**

```bash
cd .. && git add backend/lib/agent.ts
git commit -m "$(cat <<'EOF'
Write bento-safety.css into variation sandbox dirs

Parity with tokens/components/reference — present on disk for debug
visibility even though the agent is not expected to Read it directly.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Inject `<style data-bento="safety">` first in the post-edit block

**Files:**
- Modify: `backend/lib/agent.ts` (the `WORKER_SCRIPT` template literal)

- [ ] **Step 1: Add the safety `<style>` block to the injection string.**

In `backend/lib/agent.ts`, find the injection string inside `WORKER_SCRIPT` (around lines 170–173):

```js
    let bentoInjection = null;
    if (config.bento) {
      const injection =
        '<style data-bento="tokens">' + config.bento.tokensCss + '</style>' +
        '<style data-bento="components">' + config.bento.componentsCss + '</style>';
```

Change to:

```js
    let bentoInjection = null;
    if (config.bento) {
      const injection =
        '<style data-bento="safety">' + config.bento.safetyCss + '</style>' +
        '<style data-bento="tokens">' + config.bento.tokensCss + '</style>' +
        '<style data-bento="components">' + config.bento.componentsCss + '</style>';
```

Order matters: safety comes first so Bento component rules (e.g. `.bento-dialog__panel { max-width: 600px }`) appear later in the cascade and override the defensive `max-width: 100%` where appropriate.

The four-tier `<head>` fallback logic that follows is unchanged — it uses the `injection` string verbatim.

- [ ] **Step 2: Type-check.**

```bash
cd backend && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Confirm the injection order locally using the emitted string.**

```bash
cd backend && node --input-type=module -e "
import { readFileSync } from 'node:fs';
const src = readFileSync('lib/agent.ts', 'utf-8');
const match = src.match(/const injection =([\s\S]*?);/);
if (!match) { console.error('injection block not found'); process.exit(1); }
const block = match[1];
const orderMatches = [...block.matchAll(/data-bento=\"(safety|tokens|components)\"/g)].map(m => m[1]);
console.log('order:', orderMatches);
console.log('ok:', JSON.stringify(orderMatches) === JSON.stringify(['safety','tokens','components']));
"
```

Expected:
```
order: [ 'safety', 'tokens', 'components' ]
ok: true
```

If the order is different, the injection string is wrong — fix it before committing.

- [ ] **Step 4: Commit.**

```bash
cd .. && git add backend/lib/agent.ts
git commit -m "$(cat <<'EOF'
Inject <style data-bento="safety"> first in post-edit block

Safety defaults (max-width: 100%, min-width: 0, etc.) appear in <head>
before the Bento component rules so component-specific sizing (e.g.
dialog max-width: 600px) still wins in the cascade. Four-tier head
fallback and bentoInjection tracking unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Deploy backend

**Files:** none modified.

- [ ] **Step 1: Push to GitHub (triggers Git-integration auto-deploy).**

```bash
git push origin main
```

- [ ] **Step 2: Deploy to production from the repo root.**

```bash
VERCEL_ORG_ID=team_IZQvrIzJmMidztiR6vN2CPGa \
VERCEL_PROJECT_ID=prj_QMHmsQ77tkAkXUUrC2elhUEJyxgb \
npx vercel --prod --yes --cwd "/Users/joshbrinksman/Desktop/NinjaCat Product Design/mocker"
```

Expected: `readyState: "READY"` and a production URL printed. Aliases include `mocker-backend-ninjacat-ui.vercel.app` and `backend-beta-silk-23.vercel.app`.

Note: the Vercel deployment is SSO-protected, so `curl` against the production URL returns an auth page. That's fine — the extension uses `Authorization: Bearer <MOCKER_API_SECRET>` via its settings, which the SSO wall does not block for API routes called with that header. Validation happens through the extension in Task 8, not via curl here.

---

## Phase 3 — Supporting changes

### Task 7: Link safety.css in the local visual gallery

**Files:**
- Modify: `backend/bento/_gallery.html`

- [ ] **Step 1: Add the safety stylesheet link.**

Find the stylesheet links near the top of `backend/bento/_gallery.html` (around lines 6–7):

```html
<link rel="stylesheet" href="./bento-tokens.css">
<link rel="stylesheet" href="./bento.css">
```

Change to:

```html
<link rel="stylesheet" href="./bento-safety.css">
<link rel="stylesheet" href="./bento-tokens.css">
<link rel="stylesheet" href="./bento.css">
```

Link order matches the worker's injection order (safety first). This confirms the safety rules do not regress any component's gallery rendering.

- [ ] **Step 2: Open the gallery in Chrome and scan every component.**

```bash
open backend/bento/_gallery.html
```

Expected: every component renders the same as before — buttons, inputs, dialogs, tables, badges, alerts, avatars, tabs, cards. If any component now looks clipped, too narrow, or misaligned, the safety rule responsible needs adjustment.

Common false positives to double-check, not fix:
- Bento buttons with long text now wrap cleanly inside their box instead of overflowing — that is expected and desired.
- Tables that previously overflowed their demo row now fit — also expected.

- [ ] **Step 3: Commit.**

`_gallery.html` is gitignored, so there is nothing to commit for this task. Move on.

---

### Task 8: Update `backend/bento/README.md` with a safety-layer paragraph

**Files:**
- Modify: `backend/bento/README.md`

- [ ] **Step 1: Add `bento-safety.css` to the Files list.**

Find the Files section in `backend/bento/README.md`:

```markdown
## Files

- `bento-tokens.css` — CSS custom properties on `:root`. All variables
  prefixed `--bento-*`.
- `bento.css` — Component class rules (`.bento-button`, `.bento-card`, …)
  built from tokens. Every selector is `.bento-*`-scoped.
- `bento-reference.md` — Component catalog with canonical HTML snippets
  the agent copies from.
```

Change to:

```markdown
## Files

- `bento-tokens.css` — CSS custom properties on `:root`. All variables
  prefixed `--bento-*`.
- `bento.css` — Component class rules (`.bento-button`, `.bento-card`, …)
  built from tokens. Every selector is `.bento-*`-scoped.
- `bento-reference.md` — Component catalog with canonical HTML snippets
  the agent copies from.
- `bento-safety.css` — Defensive containment rules. Injected FIRST in
  the remix output (before tokens and components) so Bento elements
  can shrink inside flex rows and never exceed their parent's width.
  Targets `.bento-*` classes and self-contained media tags only — no
  universal resets, no rules on the captured page's own markup.
```

- [ ] **Step 2: Update the "How it reaches the agent" paragraph to name the safety block.**

Find the paragraph that begins "backend/api/remix.ts reads these three files…" and replace the single paragraph with this:

```markdown
## How it reaches the agent

`backend/api/remix.ts` reads these four files from disk on each `useBento:
true` request and passes them to `startRemixJob` in `backend/lib/agent.ts`.
The sandbox worker writes them into each variation's dir alongside
`page.html`, then the agent Reads/Greps `bento-reference.md` directly.
After the agent finishes editing, the worker injects three `<style>`
blocks into `<head>`, in this order: `data-bento="safety"`,
`data-bento="tokens"`, `data-bento="components"`. Safety first so
component-specific sizing rules override the defensive defaults.
```

- [ ] **Step 3: Commit.**

```bash
git add backend/bento/README.md
git commit -m "$(cat <<'EOF'
Document bento-safety.css in backend/bento/README.md

Names the fourth file, describes the injection order, and explains why
safety comes first in the cascade.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Update `CLAUDE.md` Bento Integration subsection

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Extend the existing Bento Integration subsection.**

Find this block inside `CLAUDE.md`'s `### Bento Integration` subsection (search for "Three hand-authored files in `backend/bento/`"):

```markdown
Three hand-authored files in `backend/bento/` power this:
- `bento-tokens.css` — `:root` CSS custom properties (all prefixed `--bento-*`)
- `bento.css` — component class rules (all `.bento-*`-scoped)
- `bento-reference.md` — canonical HTML snippet catalog for each component
```

Change to:

```markdown
Four hand-authored files in `backend/bento/` power this:
- `bento-tokens.css` — `:root` CSS custom properties (all prefixed `--bento-*`)
- `bento.css` — component class rules (all `.bento-*`-scoped)
- `bento-reference.md` — canonical HTML snippet catalog for each component
- `bento-safety.css` — defensive containment rules (`.bento-*` `min-width: 0`,
  `max-width: 100%`, `box-sizing: border-box`, plus media rules). Injected
  FIRST in the remix output so component rules can override.
```

Then find the paragraph about flow that mentions the two injected style blocks:

```markdown
Flow: sidebar toggle → `msg.useBento` → service worker POST body →
`/api/remix` reads the three files from its deployed filesystem (via
`vercel.json`'s `includeFiles: "bento/**"`) → passes them in
`config.bento` → worker writes them into each variation's dir →
`BENTO_ADDENDUM` is appended to `SYSTEM_PROMPT` so the agent knows to
read them → **post-edit**, worker injects `<style data-bento="tokens">`
and `<style data-bento="components">` into the modified page's `<head>`
before data-URI restoration.
```

Change to:

```markdown
Flow: sidebar toggle → `msg.useBento` → service worker POST body →
`/api/remix` reads the four files from its deployed filesystem (via
`new URL('../bento/...', import.meta.url)` so Vercel's Node File Tracer
bundles them automatically — NO `includeFiles` glob) → passes them in
`config.bento` → worker writes them into each variation's dir →
`BENTO_ADDENDUM` is appended to `SYSTEM_PROMPT` so the agent knows to
read them → **post-edit**, worker injects three `<style>` blocks into
`<head>`, in order: `data-bento="safety"`, `data-bento="tokens"`,
`data-bento="components"` — safety first so component rules override
defensive defaults — before data-URI restoration.
```

- [ ] **Step 2: Commit.**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Document Bento safety layer in CLAUDE.md

Adds bento-safety.css to the Files list and updates the flow paragraph
to reflect the three-block injection order (safety, tokens, components)
and the current NFT-based loader (not the includeFiles glob).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Validation

### Task 10: End-to-end validation

**Files:** none modified. Pure verification.

Do not declare the feature complete until all four sub-steps pass.

- [ ] **Sub-step A — Reproduce the failing case.**

  1. Reload the extension: `chrome://extensions` → refresh the Mocker card. (Backend-only change, but reload anyway so the sidebar loads any stale logic fresh.)
  2. Open the sidebar. Confirm the "Use Bento" toggle is visible and checked.
  3. In a new tab, go to `https://app.devcat.ninja/agency/data/agents/` and capture a snapshot.
  4. In the sidebar, remix with prompt `Add More Actions secondary button beside New Agent`, `count: 1`.
  5. When complete, click Preview on the new variation.

  Expected: both the new `.bento-button--secondary "More Actions"` and the original "+ New Agent" button sit side-by-side at their natural widths. Neither is squished, shrunk, or wrapped.

- [ ] **Sub-step B — Safety block presence check.**

  From the sidebar result card, copy the variation's blob URL (it is the `blobUrl` on the variation result — you can grab it by clicking Download or from the Preview link). Then:

  ```bash
  curl -s "<BLOB_URL>" | grep -oE 'data-bento="[^"]+"' | head -5
  ```

  Expected:
  ```
  data-bento="safety"
  data-bento="tokens"
  data-bento="components"
  ```

  Order matters — safety must be the first match. If `safety` is absent entirely, the deploy did not pick up the new code.

- [ ] **Sub-step C — DevTools computed-style check.**

  With the Preview open, right-click the `More Actions` button → Inspect. In the Computed panel:
  - `min-width` resolves to `0px`
  - `max-width` resolves to `100%` of the parent

  If `min-width: auto`, the safety rule didn't apply — most likely cause is the injection order got swapped or the `[class*="bento-"]` selector was tightened.

- [ ] **Sub-step D — Non-Bento regression.**

  1. Toggle "Use Bento" off in the sidebar.
  2. Capture any page. Remix with prompt `add an HTML comment at the top of <body> that reads <!-- safety regression check -->`, `count: 1`.
  3. Copy the variation's blob URL.

  ```bash
  curl -s "<BLOB_URL>" | grep -c 'data-bento'
  ```

  Expected: `0`. The safety layer is part of the Bento payload — when Bento is off, none of the three `<style data-bento="...">` blocks should appear in the output.

- [ ] **Sub-step E — Fail-fast check (optional, only if suspicious).**

  Confirms the loader's existence-check path covers the new file. Skip unless A–D passed but you want an extra safety net before ending the session.

  ```bash
  # Temporarily rename the file locally and hit the handler.
  mv backend/bento/bento-safety.css backend/bento/bento-safety.css.bak

  # Start the Vercel dev server in another terminal (requires vercel login):
  #   cd backend && npx vercel dev
  #
  # Then:
  SECRET=$(grep -E "^MOCKER_API_SECRET" backend/.env.local | cut -d'=' -f2- | tr -d '"')
  curl -sS -X POST "http://localhost:3000/api/remix" \
    -H "Authorization: Bearer $SECRET" \
    -H "Content-Type: application/json" \
    -d '{"useBento": true, "prompt": "x", "count": 1, "snapshotName": "x", "snapshotBlobId": "nonexistent", "dataUriMapBlobId": "nonexistent"}'

  # Expected response mentions "Bento reference file missing: bento-safety.css".
  # Restore the file — DO NOT commit a broken bundle.
  mv backend/bento/bento-safety.css.bak backend/bento/bento-safety.css
  ```

  Expected: the 500 response error string contains the literal substring `bento-safety.css`. If the error names a different file, the loader's existence check did not include `BENTO_SAFETY_URL` — go back and fix Task 3.

- [ ] **Sub-step F — Final commit of any fixes.**

  If any of A–E required an adjustment to the rules or the injection order, commit the fix and push. Once A–D pass on the deployed backend, the feature is complete.

  ```bash
  git status
  # If any stray changes exist, stage and commit. Otherwise:
  echo "All validation passed."
  ```

---

## Self-Review Notes

**Spec coverage.** Cross-checked against every section of `2026-04-15-bento-safety-layer-design.md`:

- New `backend/bento/bento-safety.css` → Task 1
- `BentoReference.safetyCss` type addition → Task 2
- `/api/remix.ts` loader → Task 3
- Per-variation write → Task 4
- Post-edit injection (order: safety, tokens, components) → Task 5
- Deploy → Task 6
- `_gallery.html` update → Task 7
- `backend/bento/README.md` update → Task 8
- `CLAUDE.md` update → Task 9
- Manual validation (A–E) → Task 10 (A–D are required; E is an optional fail-fast probe)

**Placeholder scan.** Every step shows actual code or an exact command. The only runtime placeholder is `<BLOB_URL>` in the Task 10 curl commands, which is a concrete value the operator obtains from the sidebar during validation — not a plan-authoring gap.

**Type consistency.** `safetyCss` (camelCase) used uniformly across `BentoReference`, the loader return value, the worker writes, and the injection block. `data-bento="safety"` attribute value used consistently in the injection string, the gallery link ordering context, the README documentation, and the CLAUDE.md flow paragraph.

**Scope.** Single file addition plus five targeted edits. Comfortably one implementation plan.

**Sequencing note.** Task 2 intentionally leaves the backend in a briefly-broken compile state (the object literal is missing `safetyCss`). Task 3 resolves it in the next commit. This is flagged in Task 2 Step 2's "Expected" block so an executor doesn't think they've made a mistake.
