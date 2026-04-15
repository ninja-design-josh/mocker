# Bento-Assisted Remixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Use Bento" toggle to the Mocker remix flow so Claude produces HTML snapshots that reflect NinjaCat's Bento design system — tokens, typography, spacing, and canonical component markup — while keeping remix artifacts self-contained HTML.

**Architecture:** Hand-author three reference files in `backend/bento/` (`bento-tokens.css`, `bento.css`, `bento-reference.md`). When the sidebar toggle is on, the backend reads those files, appends a Bento addendum to the agent's system prompt, and ships the three files into each variation's sandbox dir. After the agent finishes editing `page.html`, a new post-edit step injects `<style data-bento="tokens">` and `<style data-bento="components">` into `<head>` so the `.bento-*` classes the agent wrote actually render.

**Tech Stack:** Vanilla Chrome Extension (MV3), TypeScript backend on Vercel, Vercel Sandbox (Firecracker microVM), Claude Agent SDK. No build step in the extension. Mocker has no test harness — validation is manual, per the spec's A–G checklist.

**Spec reference:** `docs/superpowers/specs/2026-04-15-bento-integration-design.md`

---

## Pre-Flight

- [ ] **Ensure Bento source is available.** The Bento library lives in an authenticated GitLab repo. Before starting Phase 1, clone it somewhere outside this project (do NOT commit it into Mocker):

  ```bash
  # Example location — adjust if you have it cloned elsewhere
  cd ~/Desktop && git clone <bento-gitlab-url> bento
  ```

  You'll read from `bento/src/**/*.vue` and wherever its tokens/variables live (commonly `bento/src/assets/tokens/*.css`, `bento/src/styles/*.css`, or a `design-tokens.json`). When writing the v1 CSS you'll need actual Bento values, not guesses.

- [ ] **Consider using the `bento-component` skill** when reasoning about Bento's conventions. Its description mentions it carries Bento's authoring patterns and is a good reference for naming, token usage, and SFC structure.

---

## Phase 1 — Bento reference artifact

This phase produces files that do nothing by themselves. They're the inputs Phase 2 will ship into the sandbox.

### Task 1: Scaffold `backend/bento/` directory

**Files:**
- Create: `backend/bento/bento-tokens.css`
- Create: `backend/bento/bento.css`
- Create: `backend/bento/bento-reference.md`
- Create: `backend/bento/README.md`

- [ ] **Step 1: Create directory and four empty placeholder files with header comments.**

`backend/bento/bento-tokens.css`:
```css
/* Bento design tokens.
 * Hand-authored mirror of NinjaCat's Bento design system.
 * Every variable is prefixed --bento-* to avoid collisions with the
 * snapshot's original page. Referenced by bento.css and, at runtime,
 * injected on :root in the final remix HTML.
 * Source: <bento-gitlab-url>
 */
:root {
  /* Populated in Task 2. */
}
```

`backend/bento/bento.css`:
```css
/* Bento component class rules.
 * Every selector is scoped to .bento-* — no bare-tag or html/body rules,
 * so these styles never leak onto the snapshot's original page.
 * Built on top of bento-tokens.css (no raw hex, no magic numbers).
 * Populated in Task 3.
 */
```

`backend/bento/bento-reference.md`:
```markdown
# Bento Component Reference (v1)

Canonical HTML snippets for NinjaCat's Bento design system. This file is
read by the remix agent when the "Use Bento" toggle is on. Each entry is
a **blueprint to copy**, not a component the agent can import.

Populated in Task 4.
```

`backend/bento/README.md`:
```markdown
# backend/bento

Hand-authored reference for the Bento design system, consumed by the
remix agent when the "Use Bento" sidebar toggle is on.

## Files

- `bento-tokens.css` — CSS custom properties on `:root`. All variables
  prefixed `--bento-*`.
- `bento.css` — Component class rules (`.bento-button`, `.bento-card`, …)
  built from tokens. Every selector is `.bento-*`-scoped.
- `bento-reference.md` — Component catalog with canonical HTML snippets
  the agent copies from.

## How it reaches the agent

`backend/api/remix.ts` reads these three files from disk on each `useBento:
true` request and passes them to `startRemixJob` in `backend/lib/agent.ts`.
The sandbox worker writes them into each variation's dir alongside
`page.html`, then the agent Reads/Greps them directly. After the agent
finishes editing, the worker injects `<style data-bento="tokens">` and
`<style data-bento="components">` into the modified page's `<head>`.

## Refreshing from Bento

This is hand-authored today. To refresh:

1. Clone the Bento GitLab repo locally.
2. For `bento-tokens.css`: open Bento's token source (Vue variables,
   design-tokens.json, or SCSS partials) and mirror values into CSS
   custom properties. Preserve the `--bento-*` prefix.
3. For `bento.css`: for each component in v1 scope, open its `.vue` file,
   translate the `<style scoped>` block into flat `.bento-<name>`
   rules. Drop any Vue-specific class hashes.
4. For `bento-reference.md`: update the snippet, variants, and tokens
   callout to match the refreshed component.
5. Redeploy the backend (`cd backend && vercel --prod`). The extension
   picks up the new reference on the next remix.
```

- [ ] **Step 2: Verify files exist.**

```bash
ls -la backend/bento/
```

Expected: four files listed (`bento-tokens.css`, `bento.css`, `bento-reference.md`, `README.md`).

- [ ] **Step 3: Commit.**

```bash
git add backend/bento/
git commit -m "$(cat <<'EOF'
Scaffold backend/bento/ for Bento-assisted remixes

Empty placeholders — content added in follow-up commits.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Author `bento-tokens.css`

**Files:**
- Modify: `backend/bento/bento-tokens.css`

**Reference:** open the cloned Bento repo's token source. Expect to find them in one of: `src/assets/tokens/`, `src/styles/tokens*`, `src/design-tokens*`, or inline SCSS/CSS variables. If Bento uses a design-tokens-compatible JSON, translate that to CSS custom properties.

- [ ] **Step 1: Replace `backend/bento/bento-tokens.css` with the full token set.**

The file **must** define at minimum the variable groups below. Values come from real Bento — do not invent them. Names below are required; if Bento uses different names internally, map them to these:

```css
/* Bento design tokens.
 * Hand-authored mirror of NinjaCat's Bento design system.
 * Source: <bento-gitlab-url>
 */
:root {
  /* ── Color: brand & accent ─────────────────────────────────── */
  --bento-color-brand-50: <hex>;
  --bento-color-brand-100: <hex>;
  /* … full scale through 900 … */
  --bento-color-accent-500: <hex>;
  /* … full accent scale … */

  /* ── Color: neutrals ───────────────────────────────────────── */
  --bento-color-neutral-0: <hex>;   /* white */
  /* … through 1000 (black) … */

  /* ── Color: semantic roles ─────────────────────────────────── */
  --bento-fg-default: <var or hex>;
  --bento-fg-muted: <var or hex>;
  --bento-fg-on-accent: <var or hex>;
  --bento-bg-surface: <var or hex>;
  --bento-bg-surface-raised: <var or hex>;
  --bento-bg-accent: <var or hex>;
  --bento-border-default: <var or hex>;
  --bento-border-strong: <var or hex>;

  /* ── Color: status ────────────────────────────────────────── */
  --bento-color-success: <hex>;
  --bento-color-warning: <hex>;
  --bento-color-danger: <hex>;
  --bento-color-info: <hex>;

  /* ── Typography: families ─────────────────────────────────── */
  --bento-font-display: <stack>;
  --bento-font-body: <stack>;
  --bento-font-mono: <stack>;

  /* ── Typography: scale (size / line-height pairs) ─────────── */
  --bento-text-xs: <size>;        --bento-leading-xs: <line-height>;
  --bento-text-sm: <size>;        --bento-leading-sm: <line-height>;
  --bento-text-base: <size>;      --bento-leading-base: <line-height>;
  --bento-text-lg: <size>;        --bento-leading-lg: <line-height>;
  --bento-text-xl: <size>;        --bento-leading-xl: <line-height>;
  --bento-text-2xl: <size>;       --bento-leading-2xl: <line-height>;
  --bento-text-3xl: <size>;       --bento-leading-3xl: <line-height>;

  /* ── Typography: weights ──────────────────────────────────── */
  --bento-font-weight-regular: 400;
  --bento-font-weight-medium: 500;
  --bento-font-weight-semibold: 600;
  --bento-font-weight-bold: 700;

  /* ── Spacing (4px or 8px grid — match Bento) ──────────────── */
  --bento-space-0: 0;
  --bento-space-1: <value>;
  --bento-space-2: <value>;
  --bento-space-3: <value>;
  --bento-space-4: <value>;
  --bento-space-5: <value>;
  --bento-space-6: <value>;
  --bento-space-8: <value>;
  --bento-space-10: <value>;
  --bento-space-12: <value>;
  --bento-space-16: <value>;

  /* ── Radii ────────────────────────────────────────────────── */
  --bento-radius-sm: <value>;
  --bento-radius-md: <value>;
  --bento-radius-lg: <value>;
  --bento-radius-full: 9999px;

  /* ── Borders ──────────────────────────────────────────────── */
  --bento-border-width-sm: 1px;
  --bento-border-width-md: 2px;

  /* ── Shadows ──────────────────────────────────────────────── */
  --bento-shadow-sm: <shadow>;
  --bento-shadow-md: <shadow>;
  --bento-shadow-lg: <shadow>;

  /* ── Motion ───────────────────────────────────────────────── */
  --bento-duration-fast: <ms>;
  --bento-duration-base: <ms>;
  --bento-duration-slow: <ms>;
  --bento-ease-standard: cubic-bezier(...);
  --bento-ease-emphasized: cubic-bezier(...);
}
```

Replace every `<...>` placeholder with the actual value from Bento. Do not ship the file with any `<...>` left in it.

- [ ] **Step 2: Sanity-check the file with a CSS parser.**

```bash
npx --yes csso backend/bento/bento-tokens.css -o /tmp/tokens.min.css && echo OK
```

Expected: prints `OK`. `csso` fails loudly on syntax errors. If csso isn't available, fall back to:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('backend/bento/bento-tokens.css','utf8');const opens=(s.match(/{/g)||[]).length;const closes=(s.match(/}/g)||[]).length;console.log({opens, closes, balanced: opens===closes});"
```

Expected: `{ opens: 1, closes: 1, balanced: true }` (one `:root {…}` block).

- [ ] **Step 3: Commit.**

```bash
git add backend/bento/bento-tokens.css
git commit -m "$(cat <<'EOF'
Populate bento-tokens.css with color, typography, spacing, radii, shadows, motion

Hand-authored from the Bento GitLab source. All variables prefixed
--bento-* to prevent collisions with a snapshot's original page styles.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Author `bento.css` (component rules)

**Files:**
- Modify: `backend/bento/bento.css`

**v1 component classes (required):** `.bento-button` (with `--primary`, `--secondary`, `--ghost`, `--danger`, `--sm`, `--lg`, `:disabled`), `.bento-input`, `.bento-textarea`, `.bento-select`, `.bento-checkbox` + `.bento-checkbox__label`, `.bento-radio` + `.bento-radio__label`, `.bento-card` (+ `.bento-card__header`, `.bento-card__body`, `.bento-card__footer`), `.bento-badge` (with `--neutral`, `--success`, `--warning`, `--danger`, `--info`), `.bento-dialog` (+ `.bento-dialog__backdrop`, `.bento-dialog__panel`, `.bento-dialog__header`, `.bento-dialog__body`, `.bento-dialog__footer`), `.bento-table` (with `.bento-table__row`, `.bento-table__cell`, `.bento-table__header-cell`), `.bento-tabs` (+ `.bento-tabs__list`, `.bento-tabs__tab`, `.bento-tabs__panel`, `.bento-tabs__tab--active`), `.bento-avatar` (with `--sm`, `--md`, `--lg`), `.bento-alert` (with `--info`, `--success`, `--warning`, `--danger`).

- [ ] **Step 1: Open each Bento `.vue` source file and translate its `<style scoped>` block into flat `.bento-*` rules.**

Principles:

- Every selector starts with `.bento-`. No bare-tag selectors like `button`, `input`, `h1`. No `html`/`body` rules.
- Every value references a token (`var(--bento-*)`) or a computed expression on tokens. **No raw hex, no px/rem literals** except where tokens explicitly don't cover (border widths, `1` in flex, etc.).
- Use BEM-style modifiers for variants: `.bento-button--primary`, `.bento-button--lg`, `.bento-button--disabled`, `.bento-badge--success`.
- For sub-elements, use `__`: `.bento-card__header`, `.bento-dialog__panel`.
- Preserve Bento's focus ring style (typically a 2px ring with an offset). Use `:focus-visible`, not `:focus`.
- Include `:hover`, `:active`, `:focus-visible`, `:disabled` states where Bento defines them.

Illustrative example (replace with real Bento button styles, not these placeholders):

```css
/* ── Button ───────────────────────────────────────────────── */
.bento-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--bento-space-2);
  padding: var(--bento-space-2) var(--bento-space-4);
  font-family: var(--bento-font-body);
  font-size: var(--bento-text-sm);
  line-height: var(--bento-leading-sm);
  font-weight: var(--bento-font-weight-medium);
  border-radius: var(--bento-radius-md);
  border: var(--bento-border-width-sm) solid transparent;
  transition: background-color var(--bento-duration-fast) var(--bento-ease-standard),
              border-color var(--bento-duration-fast) var(--bento-ease-standard);
  cursor: pointer;
}
.bento-button:focus-visible {
  outline: var(--bento-border-width-md) solid var(--bento-color-accent-500);
  outline-offset: 2px;
}
.bento-button--primary {
  background: var(--bento-bg-accent);
  color: var(--bento-fg-on-accent);
}
.bento-button--primary:hover { background: var(--bento-color-accent-600); /* adjust to real token */ }
.bento-button--secondary {
  background: var(--bento-bg-surface-raised);
  color: var(--bento-fg-default);
  border-color: var(--bento-border-default);
}
.bento-button--ghost { background: transparent; color: var(--bento-fg-default); }
.bento-button--danger { background: var(--bento-color-danger); color: var(--bento-fg-on-accent); }
.bento-button--sm { padding: var(--bento-space-1) var(--bento-space-3); font-size: var(--bento-text-xs); }
.bento-button--lg { padding: var(--bento-space-3) var(--bento-space-6); font-size: var(--bento-text-base); }
.bento-button:disabled,
.bento-button[aria-disabled="true"] {
  opacity: 0.5;
  pointer-events: none;
}
```

Repeat for every component in the v1 list. Aim for ~600–1200 lines of CSS, all `.bento-*` scoped.

- [ ] **Step 2: Grep for violations.**

```bash
# No bare-tag selectors at start of a rule
grep -nE '^\s*[a-zA-Z]+\s*\{' backend/bento/bento.css ; echo "^ should be empty"

# No html/body selectors
grep -nE '\b(html|body)\b\s*\{' backend/bento/bento.css ; echo "^ should be empty"

# No raw hex codes (tokens only)
grep -nE '#[0-9a-fA-F]{3,8}\b' backend/bento/bento.css ; echo "^ should be empty"
```

Expected: all three searches return no matches. Fix any offender before proceeding.

- [ ] **Step 3: Parse-check.**

```bash
npx --yes csso backend/bento/bento.css -o /tmp/bento.min.css && echo OK
```

Expected: prints `OK`.

- [ ] **Step 4: Commit.**

```bash
git add backend/bento/bento.css
git commit -m "$(cat <<'EOF'
Populate bento.css with v1 component class rules

Covers button, input, textarea, select, checkbox, radio, card, badge,
dialog, table, tabs, avatar, alert. All selectors .bento-*-scoped and
built from tokens — no raw hex, no magic numbers.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Author `bento-reference.md` catalog

**Files:**
- Modify: `backend/bento/bento-reference.md`

- [ ] **Step 1: Replace the file with a catalog covering every v1 component.**

Structure: top-level overview, then one `##` section per component. Each section has exactly four subsections in this order: **When to use**, **Canonical HTML**, **Variants**, **Tokens it leans on**.

Template (fill in from Bento source, one entry per component):

````markdown
# Bento Component Reference (v1)

Canonical HTML snippets for NinjaCat's Bento design system. This file is
read by the remix agent when the "Use Bento" toggle is on. Copy these
snippets into `page.html` — do not import Vue components, do not add
`<link>` or `<style>` tags for Bento (the worker injects styles after
you finish editing).

Every element uses a `.bento-*` class and every inline value (where
used) references `var(--bento-*)` tokens.

---

## Button

**When to use.** Primary actions (Submit, Save, Continue) use `--primary`.
Secondary/dismiss actions use `--secondary`. Destructive actions use
`--danger`. Low-emphasis inline actions use `--ghost`.

**Canonical HTML.**

```html
<button type="button" class="bento-button bento-button--primary">Continue</button>
```

**Variants.**

```html
<button class="bento-button bento-button--secondary">Cancel</button>
<button class="bento-button bento-button--ghost">Skip</button>
<button class="bento-button bento-button--danger">Delete</button>
<button class="bento-button bento-button--primary bento-button--sm">Small</button>
<button class="bento-button bento-button--primary bento-button--lg">Large</button>
<button class="bento-button bento-button--primary" disabled>Disabled</button>
```

**Tokens it leans on.** `--bento-bg-accent`, `--bento-fg-on-accent`,
`--bento-radius-md`, `--bento-space-2`/`--bento-space-4`, `--bento-text-sm`.

---

## Input

[same four subsections …]

---

[continue for: Textarea, Select, Checkbox, Radio, Card, Badge, Dialog, Table, Tabs, Avatar, Alert]
````

Populate every entry with real Bento markup patterns. The agent will use these as copy-paste blueprints, so:

- The **Canonical HTML** snippet must be a complete, paste-able fragment.
- Variants should cover every modifier class the component supports.
- Include `aria-*` attributes where Bento uses them (dialogs, tabs, alerts).

- [ ] **Step 2: Sanity-check section count.**

```bash
grep -cE '^## ' backend/bento/bento-reference.md
```

Expected: `13` (12 components + the Alert/Toast section — or 12 if you treat Alert+Toast as one).

- [ ] **Step 3: Commit.**

```bash
git add backend/bento/bento-reference.md
git commit -m "$(cat <<'EOF'
Populate bento-reference.md catalog with v1 component snippets

Twelve component entries (button, input, textarea, select, checkbox,
radio, card, badge, dialog, table, tabs, avatar, alert). Each has
when-to-use, canonical HTML, variants, and tokens-it-leans-on.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Local visual-inspection gallery (cheap iteration loop)

**Files:**
- Create: `backend/bento/_gallery.html` (gitignored — for local inspection only, never shipped to sandbox)

- [ ] **Step 1: Create `backend/bento/_gallery.html`.**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bento gallery (v1)</title>
<link rel="stylesheet" href="./bento-tokens.css">
<link rel="stylesheet" href="./bento.css">
<style>
  body { font-family: var(--bento-font-body); background: var(--bento-bg-surface); color: var(--bento-fg-default); margin: 0; padding: var(--bento-space-8); }
  h1, h2 { font-family: var(--bento-font-display); margin-top: var(--bento-space-8); }
  .gallery-row { display: flex; flex-wrap: wrap; gap: var(--bento-space-4); margin-block: var(--bento-space-4); padding: var(--bento-space-4); background: var(--bento-bg-surface-raised); border-radius: var(--bento-radius-md); border: 1px solid var(--bento-border-default); }
</style>
</head>
<body>
  <h1>Bento v1 gallery</h1>

  <h2>Button</h2>
  <div class="gallery-row">
    <button class="bento-button bento-button--primary">Primary</button>
    <button class="bento-button bento-button--secondary">Secondary</button>
    <button class="bento-button bento-button--ghost">Ghost</button>
    <button class="bento-button bento-button--danger">Danger</button>
    <button class="bento-button bento-button--primary bento-button--sm">Small</button>
    <button class="bento-button bento-button--primary bento-button--lg">Large</button>
    <button class="bento-button bento-button--primary" disabled>Disabled</button>
  </div>

  <!-- Add one <h2> + <div class="gallery-row"> per remaining v1 component,
       copying the Canonical HTML + Variants out of bento-reference.md. -->

</body>
</html>
```

- [ ] **Step 2: Add `_gallery.html` to `.gitignore`.**

```bash
echo "backend/bento/_gallery.html" >> .gitignore
```

- [ ] **Step 3: Open in Chrome and eyeball each component against Bento in Figma/Storybook.** Note any visual mismatches and fix in `bento.css` / `bento-tokens.css`.

```bash
open backend/bento/_gallery.html
```

Iterate until every component reads as "looks like Bento."

- [ ] **Step 4: Commit the `.gitignore` change.**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
Gitignore backend/bento/_gallery.html (local visual check only)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Backend wiring

Files in play: `backend/lib/types.ts`, `backend/lib/agent.ts`, `backend/api/remix.ts`. Deploy to Vercel at the end of the phase.

### Task 6: Extend `RemixRequest` type with `useBento` and add `BentoReference`

**Files:**
- Modify: `backend/lib/types.ts`

- [ ] **Step 1: Add `useBento` field to `RemixRequest` and export a new `BentoReference` interface.**

Current state (for reference):

```ts
export interface RemixRequest {
  strippedHtml?: string;
  dataUriMap?: string[];
  snapshotBlobId?: string;
  dataUriMapBlobId?: string;
  prompt: string;
  count: number;
  snapshotName: string;
  model?: string;
  referenceImages?: ReferenceImage[];
}
```

Edit to:

```ts
export interface RemixRequest {
  strippedHtml?: string;
  dataUriMap?: string[];
  snapshotBlobId?: string;
  dataUriMapBlobId?: string;
  prompt: string;
  count: number;
  snapshotName: string;
  model?: string;
  referenceImages?: ReferenceImage[];
  /** When true, the backend loads backend/bento/* and the agent is
   *  instructed to produce Bento-styled HTML. Defaults to false. */
  useBento?: boolean;
}

/** Bento reference material shipped into the sandbox when useBento=true. */
export interface BentoReference {
  tokensCss: string;
  componentsCss: string;
  referenceMd: string;
}
```

- [ ] **Step 2: Type-check the backend.**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
cd .. && git add backend/lib/types.ts
git commit -m "$(cat <<'EOF'
Add useBento flag to RemixRequest and BentoReference interface

Prepares the backend types for the Bento-assisted remix flow.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Add `BENTO_ADDENDUM` constant in `agent.ts`

**Files:**
- Modify: `backend/lib/agent.ts`

- [ ] **Step 1: Add the `BENTO_ADDENDUM` constant immediately below `SYSTEM_PROMPT` (around line 30, after the existing `const SYSTEM_PROMPT = ...;` declaration).**

```ts
const BENTO_ADDENDUM = `

Bento design system:
You have access to NinjaCat's Bento design system via three files in your current directory:
- bento-reference.md — canonical HTML snippets, one per component. Read this first to see what components exist and how to use them.
- bento.css — the compiled component class rules (.bento-*). You do NOT need to add a <link> or <style> tag for this — the worker injects it into <head> after you finish editing.
- bento-tokens.css — CSS custom properties (--bento-*). Also injected for you.

How to use Bento:
- When you add or modify UI that has a Bento equivalent (button, input, card, dialog, table, etc.), use the canonical snippet from bento-reference.md. Prefer .bento-* classes over raw markup.
- When you touch a plain element that has an obvious Bento equivalent right next to your edit, upgrade it opportunistically. Do NOT restructure the whole page or swap unrelated elements.
- For colors, typography, spacing, radii: use var(--bento-*) tokens. Do not hardcode hex or pixel values that a token already covers.
- Do NOT add <link rel="stylesheet"> or a <style> tag for Bento — the worker injects both bento-tokens.css and bento.css into <head> after your edits.
- All existing Snapshot rules still apply (no scripts, no CDN links, no tracking).
`;
```

- [ ] **Step 2: Type-check.**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
cd .. && git add backend/lib/agent.ts
git commit -m "$(cat <<'EOF'
Add BENTO_ADDENDUM system-prompt fragment

Appended to SYSTEM_PROMPT at remix-start when useBento is true.
Tells the agent where Bento files live, how to use them, and that
the worker injects styles post-edit.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Update `startRemixJob` to accept and wire the `bento` option

**Files:**
- Modify: `backend/lib/agent.ts`

- [ ] **Step 1: Import `BentoReference` and update `startRemixJob`'s signature + body.**

At the top of `backend/lib/agent.ts`, update the type import:

```ts
import type { ReferenceImage, BentoReference } from './types.js';
```

Then modify `startRemixJob`'s `opts` parameter type (currently around line 192) and the body. New signature:

```ts
export async function startRemixJob(opts: {
  snapshotBlobUrl: string;
  dataUriMapBlobUrl: string;
  prompt: string;
  model: string;
  count: number;
  snapshotName: string;
  referenceImages?: ReferenceImage[];
  bento?: BentoReference;
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

  const systemPrompt = opts.bento
    ? SYSTEM_PROMPT + BENTO_ADDENDUM
    : SYSTEM_PROMPT;

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
```

- [ ] **Step 2: Type-check.**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
cd .. && git add backend/lib/agent.ts
git commit -m "$(cat <<'EOF'
Thread bento option through startRemixJob

Adds bento to the opts signature and the worker-config payload.
Composes systemPrompt = SYSTEM_PROMPT + BENTO_ADDENDUM when bento is
provided. Worker consumes config.systemPrompt unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Update `WORKER_SCRIPT` to write Bento files into each variation dir

**Files:**
- Modify: `backend/lib/agent.ts` (the `WORKER_SCRIPT` template literal)

- [ ] **Step 1: Inside `WORKER_SCRIPT`'s `runVariation(i)`, after `writeFileSync(dir + '/page.html', strippedHtml);` and before the `turns = []` line, add the Bento file writes.**

Current region (around line 70–74 of agent.ts, inside the backticked `WORKER_SCRIPT`):

```js
  async function runVariation(i) {
    const dir = '/vercel/sandbox/v' + i;
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + '/page.html', strippedHtml);

    const turns = [];
```

Insert a new block:

```js
  async function runVariation(i) {
    const dir = '/vercel/sandbox/v' + i;
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + '/page.html', strippedHtml);

    if (config.bento) {
      writeFileSync(dir + '/bento-tokens.css', config.bento.tokensCss);
      writeFileSync(dir + '/bento.css', config.bento.componentsCss);
      writeFileSync(dir + '/bento-reference.md', config.bento.referenceMd);
    }

    const turns = [];
```

- [ ] **Step 2: Type-check (the template literal is JS, but the surrounding TS should still compile).**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
cd .. && git add backend/lib/agent.ts
git commit -m "$(cat <<'EOF'
Write Bento files into each variation's sandbox dir when opted in

Agent can now Read/Grep bento-reference.md, bento.css, and
bento-tokens.css via relative paths (cwd is v{N}).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add the post-edit CSS injection step to `WORKER_SCRIPT`

**Files:**
- Modify: `backend/lib/agent.ts` (the `WORKER_SCRIPT` template literal)

- [ ] **Step 1: Replace the "read modified, restore data URIs, upload" block with a version that injects Bento `<style>` blocks before `restoreDataUris` when `config.bento` is set.**

Current region (around line 142–153 of agent.ts, inside `WORKER_SCRIPT`):

```js
    updateStatus({ phase: 'uploading', variation: i, total: config.count, results, logUrl: logBlob.url });
    const modified = readFileSync(dir + '/page.html', 'utf-8');
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
```

Change to:

```js
    updateStatus({ phase: 'uploading', variation: i, total: config.count, results, logUrl: logBlob.url });
    let modified = readFileSync(dir + '/page.html', 'utf-8');

    let bentoInjection = null;
    if (config.bento) {
      const injection =
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

    const blob = await put('mocker/' + config.snapshotName + '/remix-' + i + '.html', final, {
      access: 'public',
      contentType: 'text/html',
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    const entry = { variationNumber: i, blobUrl: blob.url, fileName: 'remix-' + i + '.html' };
    if (bentoInjection) entry.bentoInjection = bentoInjection;
    results.push(entry);
    updateStatus({ phase: 'variation-complete', variation: i, total: config.count, results });
  }
```

Note: the regex escapes are **doubled** (`\\b`, `\\/`) because `WORKER_SCRIPT` is inside a template literal and JS regex escapes need to survive through JSON-stringification. Verify by grepping after the edit:

```bash
grep -nE 'head\\\\b|\\\\\\/head' backend/lib/agent.ts
```

Expected: hits the injection block you just added.

- [ ] **Step 2: Update the `VariationResult` type to allow the optional `bentoInjection` field.**

In `backend/lib/types.ts`:

```ts
export interface VariationResult {
  variationNumber: number;
  blobUrl: string;
  fileName: string;
  /** Present when useBento=true. Records which fallback path the worker
   *  used to inject Bento <style> blocks. */
  bentoInjection?: 'head-start' | 'head-end' | 'html-start' | 'doc-start';
}
```

- [ ] **Step 3: Type-check.**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
cd .. && git add backend/lib/agent.ts backend/lib/types.ts
git commit -m "$(cat <<'EOF'
Inject Bento styles into remix HTML after agent finishes

Post-edit step: when useBento is on, prepend <style data-bento="tokens">
and <style data-bento="components"> to the modified page.html before
data-URI restoration. Four-tier fallback for missing <head>. Records
which path was used on the variation result.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Load Bento files in `/api/remix.ts` and fail fast

**Files:**
- Modify: `backend/api/remix.ts`

- [ ] **Step 1: Read the three files from the deployed function's filesystem when `useBento` is true, then pass them to `startRemixJob`.**

Vercel bundles files referenced by the function at build time. To guarantee `backend/bento/*` is included in the deployment, add a `vercel.json` include glob (next step) — but first, write the handler. Replace the full contents of `backend/api/remix.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateAuth } from '../lib/auth.js';
import { startRemixJob } from '../lib/agent.js';
import type { RemixRequest, BentoReference } from '../lib/types.js';

const BENTO_DIR = join(process.cwd(), 'bento');

function loadBentoReference(): BentoReference {
  const tokensPath = join(BENTO_DIR, 'bento-tokens.css');
  const componentsPath = join(BENTO_DIR, 'bento.css');
  const referencePath = join(BENTO_DIR, 'bento-reference.md');

  for (const p of [tokensPath, componentsPath, referencePath]) {
    if (!existsSync(p)) {
      throw new Error(`Bento reference file missing at ${p}`);
    }
  }

  return {
    tokensCss: readFileSync(tokensPath, 'utf-8'),
    componentsCss: readFileSync(componentsPath, 'utf-8'),
    referenceMd: readFileSync(referencePath, 'utf-8'),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body as RemixRequest;
    const { prompt, count, snapshotName, model, referenceImages, useBento } = body;

    if (!prompt || !count) {
      return res.status(400).json({ error: 'Missing prompt or count' });
    }

    if (!body.snapshotBlobId || !body.dataUriMapBlobId) {
      return res.status(400).json({ error: 'Missing snapshot blob URLs' });
    }

    if (referenceImages) {
      if (!Array.isArray(referenceImages)) {
        return res.status(400).json({ error: 'referenceImages must be an array' });
      }
      if (referenceImages.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 reference images per remix' });
      }
      for (const img of referenceImages) {
        if (!img || typeof img.url !== 'string' || typeof img.mediaType !== 'string') {
          return res.status(400).json({ error: 'Each reference image requires url and mediaType' });
        }
      }
    }

    let bento;
    if (useBento) {
      try {
        bento = loadBentoReference();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        return res.status(500).json({
          error: `Bento reference unavailable; redeploy or disable Bento toggle (${message})`,
        });
      }
    }

    const jobId = await startRemixJob({
      snapshotBlobUrl: body.snapshotBlobId,
      dataUriMapBlobUrl: body.dataUriMapBlobId,
      prompt,
      model: model || 'claude-sonnet-4-6',
      count,
      snapshotName,
      referenceImages,
      bento,
    });

    res.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}
```

- [ ] **Step 2: Update `backend/vercel.json` to include `bento/**` files in the function bundle.**

Read `backend/vercel.json` to see its current shape, then add the `functions` block if it doesn't already exist.

```bash
cat backend/vercel.json
```

If it looks like `{ "...": "..." }` without a `functions` key, edit to:

```json
{
  "functions": {
    "api/remix.ts": { "includeFiles": "bento/**" }
  }
}
```

Merge with any existing keys — don't clobber them.

- [ ] **Step 3: Type-check.**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Local smoke test — handler wiring only (no sandbox).**

This won't run the full flow, but confirms the file-loading path works and doesn't throw:

```bash
cd backend && node -e "
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const dir = join(process.cwd(), 'bento');
['bento-tokens.css', 'bento.css', 'bento-reference.md'].forEach(f => {
  const p = join(dir, f);
  if (!existsSync(p)) { console.error('MISSING', p); process.exit(1); }
  const size = readFileSync(p, 'utf-8').length;
  console.log(f, size, 'bytes');
});
"
```

Expected: three lines printing filename + byte count, all non-zero.

- [ ] **Step 5: Commit.**

```bash
cd .. && git add backend/api/remix.ts backend/vercel.json
git commit -m "$(cat <<'EOF'
Load Bento reference in /api/remix and pass to startRemixJob

When useBento=true, reads backend/bento/{tokens,components,reference}
from the function's deployed filesystem and threads them through to
the sandbox. Fails fast with a 500 if any file is missing rather than
silently degrading. vercel.json includeFiles ensures the bento/ dir
ships with the function.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Deploy backend

**Files:** none modified.

- [ ] **Step 1: Push to GitHub (triggers auto-deploy).**

```bash
git push origin main
```

- [ ] **Step 2: Deploy to production from the backend dir (belt and suspenders — Git integration is sometimes flaky for SSO-protected deploys).**

```bash
cd backend && vercel --prod
```

Expected: prints the production URL. Aliases point to `mocker-backend-ninjacat-ui.vercel.app` and `mocker-backend-git-main-ninjacat-ui.vercel.app`.

- [ ] **Step 3: Verify deploy with health check.**

```bash
curl -s https://mocker-backend-ninjacat-ui.vercel.app/api/health | jq .
```

Expected: JSON with `"ok": true` or similar health payload.

- [ ] **Step 4: Verify Bento files are included in the deployed function.**

```bash
curl -s -X POST "https://mocker-backend-ninjacat-ui.vercel.app/api/remix" \
  -H "Authorization: Bearer $MOCKER_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"useBento": true, "prompt": "x", "count": 1, "snapshotName": "x", "snapshotBlobId": "nonexistent", "dataUriMapBlobId": "nonexistent"}' \
  | jq .
```

(Set `MOCKER_API_SECRET` from your local `backend/.env.local` first.)

Expected: a 500 response about sandbox/snapshot blob failure — NOT a "Bento reference unavailable" error. That confirms file loading worked before the invalid snapshot broke things.

If you instead see `"Bento reference unavailable"`, the `includeFiles` glob didn't ship `bento/*`. Inspect `backend/vercel.json`, fix the glob, redeploy.

---

## Phase 3 — Extension wiring

### Task 13: Add "Use Bento" toggle to the sidebar

**Files:**
- Modify: `sidebar/sidebar.html` (around line 141, the `.remix-options` block)
- Modify: `sidebar/sidebar.css` (append new rules)

- [ ] **Step 1: Add the toggle markup inside `.remix-options`, adjacent to the variations select and remix button.**

Open `sidebar/sidebar.html` and find this block (around line 141–153):

```html
          <div class="remix-options">
            <div class="remix-option-item">
              <label for="remix-count">Variations</label>
              <select id="remix-count">
                …
              </select>
            </div>
            <button type="button" id="remix-btn" class="btn btn-primary">Remix</button>
          </div>
```

Add a new `.remix-option-item` with a checkbox immediately after the `remix-count` item and before the `remix-btn`:

```html
          <div class="remix-options">
            <div class="remix-option-item">
              <label for="remix-count">Variations</label>
              <select id="remix-count">
                …
              </select>
            </div>
            <div class="remix-option-item remix-option-toggle">
              <label class="remix-bento-toggle">
                <input type="checkbox" id="remix-use-bento" checked>
                <span>Use Bento</span>
              </label>
            </div>
            <button type="button" id="remix-btn" class="btn btn-primary">Remix</button>
          </div>
```

- [ ] **Step 2: Style the toggle in `sidebar/sidebar.css`.**

Append to the bottom of `sidebar/sidebar.css`:

```css
/* ── Use Bento toggle ───────────────────────────────────────── */
.remix-option-toggle {
  display: flex;
  align-items: center;
}
.remix-bento-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg-muted, #6b7280);
  cursor: pointer;
  user-select: none;
}
.remix-bento-toggle input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}
```

(Check the existing CSS for a muted text color variable name and substitute the real one if it differs from `--fg-muted`.)

- [ ] **Step 3: Reload the extension in Chrome (`chrome://extensions` → refresh the Mocker card) and open the sidebar. Confirm the "Use Bento" checkbox is visible, checked by default, sits next to the Variations select.**

- [ ] **Step 4: Commit.**

```bash
git add sidebar/sidebar.html sidebar/sidebar.css
git commit -m "$(cat <<'EOF'
Add "Use Bento" toggle next to remix Variations select

Checked by default. Wired to remix flow in the next commit.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Persist toggle state in `chrome.storage.sync` and wire to remix flow

**Files:**
- Modify: `sidebar/sidebar.js`

- [ ] **Step 1: Grab the new input and persist/restore its state.**

Near the other `getElementById` calls for remix controls (around line 36–42), add:

```js
const remixUseBento = document.getElementById('remix-use-bento');
```

Inside the existing `init()` function (around line 658), after settings are loaded, set the checkbox from persisted state. Find this block:

```js
async function init() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];
  currentSettings = settings;
```

Insert right after `currentSettings = settings;`:

```js
  // useBento toggle: default on, respect explicit false.
  const useBentoStored = settings?.useBento;
  remixUseBento.checked = useBentoStored !== false;
```

Then, attach a change listener so updates persist (add near the other event listeners in the file, e.g. right after the existing remix-refs wiring around line 1033):

```js
remixUseBento.addEventListener('change', async () => {
  const next = { ...(currentSettings || {}), useBento: remixUseBento.checked };
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  currentSettings = next;
});
```

- [ ] **Step 2: Attach `useBento` to the remix action message.**

Find the remix-btn click handler (around line 1004–1010):

```js
  try {
    const action = remixSourceVersionId ? 'remixFromVersion' : 'remixSnapshot';
    const msg = { action, prompt, count, snapshotId: currentSnapshotId };
    if (remixSourceVersionId) msg.versionId = remixSourceVersionId;
    if (uploadedRefs.length) msg.referenceImages = uploadedRefs;
```

Add one line:

```js
  try {
    const action = remixSourceVersionId ? 'remixFromVersion' : 'remixSnapshot';
    const msg = { action, prompt, count, snapshotId: currentSnapshotId };
    if (remixSourceVersionId) msg.versionId = remixSourceVersionId;
    if (uploadedRefs.length) msg.referenceImages = uploadedRefs;
    msg.useBento = remixUseBento.checked;
```

- [ ] **Step 3: Reload the extension. Toggle the checkbox off, close the sidebar, reopen. Confirm it stays off. Toggle on again, close/reopen, confirm it stays on.**

- [ ] **Step 4: Commit.**

```bash
git add sidebar/sidebar.js
git commit -m "$(cat <<'EOF'
Persist Use Bento toggle and pass through to remix message

Stores settings.useBento in chrome.storage.sync (default true, respects
explicit false). Attaches to remixSnapshot/remixFromVersion messages
so the service worker can forward it to /api/remix.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Thread `useBento` through service worker to `/api/remix`

**Files:**
- Modify: `background/service-worker.js`

- [ ] **Step 1: Update `remixSnapshot` and `remixFromVersion` signatures (and callers in the message handler) to accept `useBento`.**

Find the message handlers (around line 1144–1158):

```js
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
```

Update both calls to pass `msg.useBento`:

```js
  if (msg.action === 'remixSnapshot') {
    remixSnapshot(msg.snapshotId, msg.prompt, msg.count, msg.referenceImages, msg.useBento)
      .then(data => sendResponse({ results: data.results, logUrl: data.logUrl, versionIds: data.versionIds }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === 'remixFromVersion') {
    remixFromVersion(msg.versionId, msg.prompt, msg.count, msg.referenceImages, msg.useBento)
      .then(data => sendResponse({ results: data.results, logUrl: data.logUrl, versionIds: data.versionIds }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
```

- [ ] **Step 2: Update `remixSnapshot` (around line 1030) and `remixFromVersion` (around line 1072) to accept `useBento` and forward it to `remixViaVercel` through `sourceContext`.**

Find:

```js
async function remixSnapshot(snapshotId, prompt, count, referenceImages) {
  …
  const sourceContext = {
    html,
    snapshotName: snapshot.snapshotName || 'snapshot',
    branchName: snapshot.branchName,
    referenceImages,
  };

  return remixViaVercel(prompt, count, settings, sourceContext);
}
```

Change to:

```js
async function remixSnapshot(snapshotId, prompt, count, referenceImages, useBento) {
  …
  const sourceContext = {
    html,
    snapshotName: snapshot.snapshotName || 'snapshot',
    branchName: snapshot.branchName,
    referenceImages,
    useBento,
  };

  return remixViaVercel(prompt, count, settings, sourceContext);
}
```

And similarly for `remixFromVersion`:

```js
async function remixFromVersion(versionId, prompt, count, referenceImages, useBento) {
  …
  const sourceContext = {
    html,
    snapshotName: snapshot?.snapshotName || 'snapshot',
    branchName: snapshot?.branchName,
    referenceImages,
    useBento,
  };

  return remixViaVercel(prompt, count, settings, sourceContext);
}
```

- [ ] **Step 3: Include `useBento` in the POST body inside `remixViaVercel` (around line 870–888).**

Find:

```js
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
```

Add `useBento` to the body:

```js
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
      useBento: sourceContext.useBento === true,
    }),
  });
```

Using `=== true` makes `undefined` / missing → `false`, which is the safe default for the backend.

- [ ] **Step 4: Reload the extension. Kick off a remix with the toggle on. In the browser's Network panel for the sidebar, inspect the `/api/remix` request body — confirm `"useBento": true` is present.**

- [ ] **Step 5: Commit.**

```bash
git add background/service-worker.js
git commit -m "$(cat <<'EOF'
Forward useBento from sidebar to /api/remix

Threads useBento through remixSnapshot / remixFromVersion message
handlers into sourceContext, then into the POST body. Defaults to
false on the wire if the field is missing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Docs + validation

### Task 16: Update `CLAUDE.md` with a Bento section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Insert a new `### Bento Integration` subsection inside `## Architecture`, after the existing `### Remix Feature` section.**

Find the `### Remix Feature` section in `CLAUDE.md` and insert after its closing paragraph:

```markdown
### Bento Integration

When the sidebar's "Use Bento" toggle is on (default), the remix agent is
given access to NinjaCat's Bento design system as a **visual/style
reference only** — remixes stay self-contained HTML.

Three hand-authored files in `backend/bento/` power this:
- `bento-tokens.css` — `:root` CSS custom properties (all prefixed `--bento-*`)
- `bento.css` — component class rules (all `.bento-*`-scoped)
- `bento-reference.md` — canonical HTML snippet catalog for each component

Flow: sidebar toggle → `msg.useBento` → service worker POST body →
`/api/remix` reads the three files from its deployed filesystem (via
`vercel.json`'s `includeFiles: "bento/**"`) → passes them in
`config.bento` → worker writes them into each variation's dir →
`BENTO_ADDENDUM` is appended to `SYSTEM_PROMPT` so the agent knows to
read them → **post-edit**, worker injects `<style data-bento="tokens">`
and `<style data-bento="components">` into the modified page's `<head>`
before data-URI restoration.

The sandbox never talks to GitLab. To refresh Bento:
1. Edit the three files in `backend/bento/`.
2. Redeploy (`git push` + `cd backend && vercel --prod`).

To extend the v1 catalog, add both the component's `.bento-*` rules to
`bento.css` AND its entry (canonical HTML / variants / tokens) to
`bento-reference.md`. Keep every new selector `.bento-*`-scoped so
Bento styles never leak onto a snapshot's original markup.
```

- [ ] **Step 2: Commit.**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Document Bento integration in CLAUDE.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: End-to-end validation (spec checklist A–G)

**Files:** none modified. Pure verification.

This is the acceptance test for v1. Run each sub-step and do not declare the feature complete until all pass.

- [ ] **Sub-step A — Bento CSS in isolation.** Open `backend/bento/_gallery.html` in Chrome. Every component reads as "looks like Bento" compared to Figma/Storybook. No visual holes.

- [ ] **Sub-step B — E2E smoke, Bento on.**
  1. Reload the extension. Confirm "Use Bento" is checked.
  2. Capture a snapshot of a plain, non-Bento page (e.g. `https://en.wikipedia.org/wiki/Design_system`).
  3. Remix with prompt: `add a primary call-to-action button at the top of the article that says "Get started"` — `count: 1`.
  4. When done, open the result's preview.
  5. Use DevTools to verify the CTA element has class `bento-button bento-button--primary` and renders as a Bento button.
  6. In the remix HTML's `<head>`, confirm two `<style>` tags: `data-bento="tokens"` **then** `data-bento="components"` (in that order).
  7. Console: no errors.

- [ ] **Sub-step C — E2E smoke, Bento off.**
  1. Toggle "Use Bento" off in the sidebar.
  2. Capture or reuse a snapshot. Remix with the same prompt, `count: 1`.
  3. In the resulting HTML: **zero** `bento-` strings (classes, data attributes, CSS variables, style tags). Grep the returned blob to confirm.

  Shell check (replace `<BLOB_URL>` with the variation's blob URL visible in the sidebar result card):

  ```bash
  curl -s <BLOB_URL> | grep -c 'bento' || echo 0
  ```

  Expected: `0`.

- [ ] **Sub-step D — Opportunistic-rewrite spot check.**
  1. Capture a snapshot of a page with a plain, recognizable button (something like a blog's subscribe form). Toggle Bento on.
  2. Remix with prompt: `change the copy on the subscribe button to say "Go"`.
  3. Verify the subscribe button came back with `bento-button bento-button--primary` (or similar) — opportunistic upgrade happened.
  4. Visually scan the rest of the page: layout and other elements look structurally intact. No unprompted full-page rewrite.

- [ ] **Sub-step E — Scoping regression.**
  1. Capture a snapshot of a page that uses common class names like `.button`, `.card`, `.input` (most product marketing sites do).
  2. Toggle Bento on.
  3. Remix with prompt: `don't change anything visible — just add an HTML comment at the top of <body> that reads <!-- debug: bento on -->`.
  4. Open both pre- and post-remix previews side by side. Visually indistinguishable. If something shifted, Bento CSS leaked — review `bento.css` for bare-tag or html/body selectors.

- [ ] **Sub-step F — Catalog coverage pass.**
  For each of the v1 components, run a one-shot remix requesting just that component and verify it appears styled:
  - `add a Bento info alert that says "Heads up"` → `.bento-alert.bento-alert--info`
  - `add a Bento badge labeled "New"` → `.bento-badge`
  - `add a Bento card with a header and body` → `.bento-card` + `__header` + `__body`
  - `add a Bento dialog with OK/Cancel buttons` → `.bento-dialog` + backdrop/panel
  - `add a Bento avatar` → `.bento-avatar`
  - `add a Bento tabs block with three tabs` → `.bento-tabs` + tab list / active / panel
  - `add a Bento table with three rows` → `.bento-table` + row/cell classes
  - `add a Bento select with three options` → `.bento-select`
  - `add a Bento checkbox and a Bento radio group` → `.bento-checkbox`, `.bento-radio`
  - `add a Bento textarea` → `.bento-textarea`
  - (Button and Input implicitly covered by B.)

  Any component that doesn't produce the expected class → open that entry in `bento-reference.md` and strengthen the "when to use" / canonical HTML. Re-author, redeploy, re-test.

- [ ] **Sub-step G — CLAUDE.md smoke.** Read the new "Bento Integration" section in `CLAUDE.md`. Mentally simulate: could a fresh Claude session use this section alone to add a new component to the catalog (CSS + reference entry)? If not, refine.

- [ ] **Sub-step H — Final commit of any fixes.**

```bash
# After all A–G pass. If any fixes were made along the way, commit them.
git status
# Stage and commit any stray changes, then push + deploy.
```

---

## Self-Review Notes

**Spec coverage.** Cross-checked against every bullet in `2026-04-15-bento-integration-design.md`:

- New `backend/bento/` files → Tasks 1–5
- `types.ts` additions → Task 6 (+ patched in Task 10 for `bentoInjection`)
- `/api/remix.ts` read + fail-fast → Task 11
- `agent.ts` `BENTO_ADDENDUM`, `startRemixJob` signature, `config.bento`, `config.systemPrompt` composed in `startRemixJob` (not in worker) → Tasks 7, 8
- Worker writes Bento files into `v{N}` → Task 9
- Post-edit injection with four-tier fallback → Task 10
- Sidebar toggle default-on, persisted in `mocker_settings.useBento` → Tasks 13, 14
- Service worker forwards `useBento` in POST → Task 15
- Options page toggle → **intentionally deferred per YAGNI** (spec marked it optional; sidebar toggle is the single source of truth for v1)
- CLAUDE.md update → Task 16
- Manual validation checklist A–G → Task 17

**Placeholder scan.** Every step shows actual code or an exact command. The only true placeholders are the `<hex>` / `<value>` markers in the tokens template (Task 2), which are unavoidable — Bento's actual values are not known at plan-authoring time and must be filled in from the Bento source during execution. Explicitly called out in Task 2 step 1.

**Type consistency.** `useBento` (camelCase) used uniformly across types, extension, and backend. `BentoReference` shape (`tokensCss` / `componentsCss` / `referenceMd`) is identical in `types.ts`, `startRemixJob`, and the worker's `config.bento` accessor. `VariationResult.bentoInjection` added in Task 10 matches the `'head-start' | 'head-end' | 'html-start' | 'doc-start'` values the worker writes.

**Scope.** Single implementation plan, single integration, no decomposition needed. Deferred items (artifact-from-Bento generator, options-page toggle, catalog extensions beyond v1) are explicitly listed in the spec's "Open Questions / Deferred" section and left untouched here.
