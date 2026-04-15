# Bento-Assisted Remixes — Design Spec (v1)

**Date:** 2026-04-15
**Status:** Design approved, ready for implementation plan
**Author:** Josh Brinksman + Claude (brainstorming session)

## Goal

Give Mocker's AI remix flow access to **Bento**, NinjaCat's Vue 3 design system, so that remixed HTML snapshots reflect NinjaCat's visual language — same tokens, typography, spacing, and component patterns — without introducing a build step into the sandbox or changing Mocker's self-contained-HTML output format.

## Key Decisions (from brainstorming)

| # | Decision | Chosen |
|---|----------|--------|
| 1 | Output format | **Bento-styled HTML** — remix artifacts remain self-contained `.html` files; Bento is a visual/style reference only. No Vue runtime, no build step in the sandbox. |
| 2 | What the agent sees | **Tokens + curated component reference doc** — design tokens CSS, a compiled component CSS, and a markdown catalog with canonical HTML+class snippets. |
| 3 | How the artifact is produced & delivered | **Hand-authored now, script-generated later; bundled into the Mocker backend repo.** Lives at `backend/bento/`; no GitLab access from the sandbox. |
| 4 | How users opt in | **Sidebar toggle "Use Bento," default on**, persisted in `chrome.storage.sync`. |
| 5 | Styling strategy | **Flat compiled `bento.css`** with `.bento-*` class rules built from tokens. Class-based catalog entries. |
| 6 | Rewrite posture | **Opportunistic** — use Bento for anything the prompt touches, *and* replace obvious equivalents (plain buttons → Bento buttons) when doing so doesn't fight the page's layout. Not additive-only; not full-page rewrite. |

## Scope

**v1 component catalog (~12):** Button, Input, Textarea, Select, Checkbox, Radio, Card, Badge, Dialog/Modal, Table, Tabs, Avatar, Alert/Toast.

**v1 token categories (required):** color, typography (families, scale, weights, line heights), spacing, radii, borders, shadows, motion (durations + easings).

**Explicitly out of scope for v1:**

- Generating the Bento artifact from the Bento GitLab repo (future — when the shape of the reference is stable).
- Vue output, SFC output, or any non-HTML output format.
- Automated tests, CSS validation, visual-regression diffing.
- Token-sync checks against Bento's real values.
- Sandbox ↔ GitLab access.
- New API endpoints (reuses `/api/remix` and `/api/remix-status`).

## Architecture

```
Sidebar (UI)                    Backend (Vercel)                   Sandbox (microVM)
─────────────                    ─────────────────                  ──────────────────
[Remix prompt]
[x] Use Bento  ─── useBento ──▶ /api/remix
[Reference imgs]                  │
                                  ├─ reads backend/bento/*
                                  ├─ startRemixJob(…, bento: {
                                  │    tokensCss, componentsCss,
                                  │    referenceMd })
                                  └────────────────────────────▶ worker-config.json
                                                                  ├─ writes bento-tokens.css
                                                                  ├─ writes bento.css
                                                                  ├─ writes bento-reference.md
                                                                  ├─ writes page.html
                                                                  ├─ system prompt includes
                                                                  │   Bento guidance + file paths
                                                                  ├─ agent: Read/Grep Bento files,
                                                                  │   Edit page.html opportunistically
                                                                  └─ final step: inject <style> blocks
                                                                      (tokens then components) into
                                                                      page.html's <head>
```

**Key property:** the sandbox never talks to GitLab. Bento is a bundled artifact in the Mocker backend. Upgrading Bento = edit files in `backend/bento/` and redeploy.

## Files & Components

### New files (Mocker backend)

- `backend/bento/bento-tokens.css` — `:root` CSS custom properties only. All values prefixed `--bento-*` to avoid collisions with the snapshot's original page. Load-order: **first**.
  - Must cover: color (brand/accent palette, semantic roles, surfaces), typography (display + body + mono families, full type scale with size + line-height, weights), spacing (full scale), radii (`sm/md/lg/full`), borders, shadows (`sm/md/lg`), motion (`duration-fast/base/slow`, `ease-*`).
- `backend/bento/bento.css` — Bento component class rules (`.bento-button`, `.bento-card`, …) built on top of tokens (no raw hex, no magic numbers). **Every selector is scoped to `.bento-*` classes — no bare-tag or `html`/`body` selectors.** Load-order: after tokens.
- `backend/bento/bento-reference.md` — component catalog (~12 entries). Each entry:
  - Component name + one-paragraph "when to use"
  - Canonical HTML snippet with `.bento-*` classes
  - Variants/states (sizes, disabled, loading, error, etc.)
  - A "tokens it leans on" callout
- `backend/bento/README.md` — short "how this was authored / how to refresh" note.

### Modified files (Mocker backend)

- `backend/lib/types.ts` — add `useBento?: boolean` to `RemixRequest`.
- `backend/api/remix.ts` — read `useBento` from request; when true, load the three `backend/bento/*` files from disk (via `fs.readFileSync` relative to the deployed function) and pass them to `startRemixJob` under a new `bento` parameter. **Fail fast** with a 500 if the files can't be read.
- `backend/lib/agent.ts`:
  - `startRemixJob` signature gains `bento?: { tokensCss, componentsCss, referenceMd }`.
  - `worker-config.json` carries a `bento` key (three strings) when opted in.
  - System prompt composition happens **in `startRemixJob`** (not in the worker): `systemPrompt = SYSTEM_PROMPT + (opts.bento ? BENTO_ADDENDUM : '')`, written once onto `config.systemPrompt`. The worker continues to pass `config.systemPrompt` through to `query(...)` unchanged.
  - `WORKER_SCRIPT`:
    - In `runVariation(i)`, if `config.bento`, write `bento-tokens.css`, `bento.css`, `bento-reference.md` into `v{N}` alongside `page.html`. Agent reads them via relative paths (`bento-reference.md`, etc.) since its `cwd` is `v{N}`.
    - **Post-edit injection step (new):** after the agent finishes and before `restoreDataUris`, read modified `page.html`, insert two `<style>` blocks (`data-bento="tokens"` then `data-bento="components"`) into `<head>`, then restore data URIs, then upload.
  - `BENTO_ADDENDUM` — new constant in `agent.ts`: tells the agent the three files exist in its working directory by relative name, instructs it to Read/Grep `bento-reference.md`, prefer `.bento-*` classes and `var(--bento-*)` tokens, **not** to add `<link>` or `<style>` tags for Bento (worker injects them post-edit), and that the page is still a script-free static snapshot (the existing Snapshot rules still apply).

### Modified files (Mocker extension)

- `sidebar/*.html` + `sidebar/*.js` — new "Use Bento" toggle near the remix prompt; checked by default on first load; persisted in `chrome.storage.sync` under `mocker_settings.useBento`.
- `background/service-worker.js` — read `useBento` from settings and include it in the POST body to `/api/remix`.
- `options/*` — optional: expose `useBento` in the Options page as well (same storage key).
- `CLAUDE.md` — short "Bento integration" section explaining the `backend/bento/` files, the `useBento` flow, and how to extend the catalog.

### Untouched

- `content/capture.js` — no changes to snapshot capture.
- `lib/gitlab-api.js`, `lib/github-api.js` — committing a Bento-styled snapshot works exactly like any other.
- No new API endpoint.
- No GitLab-from-sandbox plumbing.

## Data Flow (Bento-on remix)

1. **Capture snapshot** (unchanged). Service worker produces `strippedHtml` + `dataUriMap`, uploads both to Vercel Blob.
2. **User writes remix prompt,** leaves "Use Bento" checked. Clicks Remix.
3. **Service worker POSTs to `/api/remix`** with existing payload plus `"useBento": true`.
4. **`/api/remix`** validates, reads `backend/bento/*` files, calls `startRemixJob({ ..., bento })`, returns `{ jobId }`.
5. **`startRemixJob`** creates sandbox, writes `worker-config.json` (now with `bento` key), `worker.mjs`, `status.json`; launches `node worker.mjs` detached.
6. **Worker, per variation (in parallel):**
   1. `mkdir v{N}`, write `page.html`.
   2. If `config.bento`: write `bento-tokens.css`, `bento.css`, `bento-reference.md` into `v{N}` (agent's `cwd`).
   3. Run `query({ systemPrompt: config.systemPrompt, ... })`. The Bento addendum was already baked into `config.systemPrompt` by `startRemixJob`. Agent Reads/Greps the reference (via relative paths) and Edits `page.html` opportunistically.
7. **Post-edit injection step (new, Bento-only):**
   - Read modified `page.html`.
   - Build injection string:
     ```html
     <style data-bento="tokens">/* contents of bento-tokens.css */</style>
     <style data-bento="components">/* contents of bento.css */</style>
     ```
   - Insert immediately after opening `<head>` tag. Fallbacks (in order): before `</head>`, after `<html ...>`, at document start. Log which path was taken on the variation result (`bentoInjection: "head-start" | "head-end" | "html-start" | "doc-start"`).
   - Write back, then `restoreDataUris`, then `put` to Blob.
8. **`/api/remix-status`** polling unchanged. Existing phases/turns/costUsd/results flow works as-is.
9. **Sidebar renders** variation cards as today. Preview button works unchanged — the remix HTML is still self-contained.

## Error Handling

| Failure | Behavior |
|---------|----------|
| Backend can't read `backend/bento/*` (missing, path wrong, deploy issue) with `useBento: true` | **Fail fast**: 500 `{ error: "Bento reference unavailable; redeploy or disable Bento toggle" }`. No silent fallback — the user would think they got a Bento remix and didn't. |
| Malformed Bento CSS (syntax error from a bad hand-edit) | No validation in v1. Acceptable failure: "the remix preview looks wrong." If recurrent, add a CSS-parse build-time check later. |
| Agent ignores Bento entirely | Injection still happens. Unused token vars and unmatched class rules are harmless. Not a bug; if frequent, strengthen the system prompt in a follow-up. |
| Agent invents `.bento-*` classes not in `bento.css` | Element renders unstyled. User can re-remix or extend the catalog. No runtime check in v1. |
| Injection step can't find `<head>` | Two-tier fallback to `html-start` then `doc-start`. Record which path was taken on the variation result. |
| `worker-config.json` size | Not a concern at v1 scale (~12 components, well under 200KB total). Revisit if catalog exceeds ~500KB. |
| Sandbox timeouts / budget / partial-variation failures | Existing error handling in `agent.ts` (Promise.allSettled, phase-based status reporting). No regressions. |
| Toggle state drift across sessions | Persist `useBento` in `chrome.storage.sync`. `undefined` = default to true; explicit `false` is respected. |

## Testing & Validation

Mocker has no test harness (per CLAUDE.md). Validation is manual; the v1 checklist:

- **A. Bento CSS in isolation.** Local HTML gallery file that includes only `bento-tokens.css` + `bento.css` and a hand-authored section for every catalog entry. Cheap visual iteration loop.
- **B. E2E smoke, Bento on.** Capture a plain non-Bento page, remix with "add a primary CTA," `count: 1`. Expect `.bento-button.bento-button--primary`, renders visibly as a Bento button, both `<style data-bento>` tags in `<head>`, no console errors.
- **C. E2E smoke, Bento off.** Same snapshot, toggle off. Expect no `.bento-*` classes, no `data-bento` style tags, no Bento tokens. Confirms the opt-out path is fully inert.
- **D. Opportunistic-rewrite spot check.** Snapshot of a page with plain buttons. Remix with "change Submit button copy to 'Go'" + Bento on. Expect the Submit button upgraded to `.bento-button`; other untouched areas unchanged. Posture check — guards against drift toward additive-only or full-rewrite.
- **E. Scoping regression.** Snapshot of a page with common class names (`.button`, `.card`). Remix with Bento on and a no-op-ish prompt. Expect visually identical to pre-remix. Confirms Bento CSS isn't leaking onto non-Bento elements.
- **F. Catalog coverage pass.** For each of the ~12 components, one-shot remix requesting just that component ("add a Bento alert that says X"). Each renders correctly. v1 acceptance test.
- **G. CLAUDE.md smoke.** After implementation, re-read the new Bento section. A fresh Claude session should be able to extend the catalog from it alone.

## Open Questions / Deferred

- **Generating the Bento artifact from the Bento repo** (Q3 option B) — deferred until the reference shape is stable and drift pain is felt.
- **Extending the catalog** past the v1 essentials — done incrementally as real remixes surface the need.
- **Token sync** with Bento's actual values — will matter when Bento changes meaningfully; punt to the generated-artifact phase.
- **Storybook integration** (Q2 option C) — if Bento gets Storybook coverage, revisit as a replacement source for the reference catalog.
