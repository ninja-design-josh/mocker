# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Mocker is a Chrome Extension (Manifest V3) that captures full-page snapshots — embedding all images, fonts, and CSS as data URIs — and commits the self-contained HTML file to GitLab or GitHub.

## Development

No build step, bundler, or package manager. Load the extension directly in Chrome:
1. `chrome://extensions` → Enable Developer Mode → "Load unpacked" → select the repo root
2. After code changes, click the refresh button on the extension card

There are no tests or linters configured.

### Deploy

"Deploy" means commit, push to GitHub, and deploy the backend:
```
git add -A && git commit -m "..." && git push
cd backend && vercel --prod
```
The Vercel project is `mocker-backend` (production alias: `mocker-backend-ninjacat-ui.vercel.app`; `mocker-backend-git-main-ninjacat-ui.vercel.app` also tracks `main`). Deploy from the `backend/` directory — `.vercel/project.json` lives there. GitHub pushes also trigger auto-deploys via the Git integration, which is the most reliable path since deployments are SSO-protected.

## Architecture

The extension uses Chrome's messaging system to coordinate between four contexts:

**Sidebar** (`sidebar/`) → sends `captureSnapshot` message → **Service Worker** (`background/service-worker.js`) → injects **Content Script** (`content/capture.js`) into the active tab → service worker fetches all resources and assembles the snapshot → calls the appropriate **API module** (`lib/gitlab-api.js` or `lib/github-api.js`) to commit.

The sidebar is a Chrome Side Panel (`chrome.sidePanel` API) and is also the UI for remix, history, and version trees. Progress flows back via `captureProgress` messages from service worker to sidebar. There is also an **Options page** (`options/`) for settings, and a shared utility module (`lib/utils.js`).

### Provider System

A `provider` field in settings (`"gitlab"` or `"github"`) controls which API module is used. Both providers' credentials coexist in the same flat settings object so switching doesn't lose data. Missing `provider` defaults to `"gitlab"` for backward compatibility.

Both API modules export the same function signature:
```
commitSnapshot(snapshotName, branchName, htmlContent) → { filePath, branch, commitUrl }
```

The service worker reads `provider` from `chrome.storage.sync` and dispatches to the correct module.

### Snapshot Assembly Pipeline (service-worker.js)

This is the most complex file. The capture pipeline:
1. Injects `content/capture.js` to extract DOM, resource URLs, stylesheet URLs, inline styles
2. Fetches external CSS, recursively resolving `@import` directives
3. Collects all `url()` references from CSS
4. Fetches all resources (batches of 10) — either uploaded to Vercel Blob as public URLs or inlined as data URIs depending on whether Vercel credentials are configured
5. Replaces CSS `url()` references with resolved URLs
6. Injects an assembler function into the page context (needed for `DOMParser`, unavailable in service workers) that strips scripts/event handlers, inlines stylesheets, and replaces resource URLs
7. Uploads final HTML to Vercel Blob (primary) and optionally commits to Git provider

### Settings Storage

All settings stored under `chrome.storage.sync` key `mocker_settings`. The flat schema:
```
{ provider, gitlabUrl, accessToken, projectId, githubToken, githubOwner, githubRepo, branch, basePath,
  remixModel, vercelUrl, vercelApiKey, alsoCommitToRepo, defaultSaveToRepo }
```

### Remix Feature

After capturing a snapshot, the sidebar offers AI-powered remixing via a Vercel backend (`backend/`):

1. Extension strips data URIs from the HTML, replacing them with `{{DATAURI_N}}` placeholders (keeps payloads small)
2. Stripped HTML and data URI map are uploaded to Vercel Blob via client upload (upload-token → direct PUT)
3. Service worker POSTs to `/api/remix` with blob URLs, prompt, and variation count — returns a `jobId`
4. Backend spins up a Vercel Sandbox (Firecracker microVM), installs the Claude Agent SDK, and runs `query()` with `Read`/`Edit` tools against the HTML file. Variations run in parallel, each in its own sandbox directory.
5. Data URIs are restored server-side; complete HTML is uploaded to Vercel Blob
6. Service worker polls `/api/remix-status?jobId=` every 3s for progress, phase transitions, and completed variations. Results are saved to IndexedDB incrementally as each variation completes.

### Backend (`backend/`)

The `mocker-backend` Vercel project (TypeScript, no framework). Deploy with:
```
cd backend && npm install && vercel --prod
```

Required Vercel env vars: `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `MOCKER_API_SECRET`.

Key files:
- `api/remix.ts` — starts a sandbox remix job, returns `jobId`
- `api/remix-status.ts` — returns current phase/progress for a running job (polled by the extension)
- `api/generate-spec.ts` — generates a markdown spec from a diff between original and remixed HTML (uses Claude)
- `api/store.ts` / `api/upload-token.ts` — Vercel Blob storage helpers
- `api/health.ts` — health check (no auth required, but reports auth status if header present)
- `lib/agent.ts` — builds the sandbox worker script and system prompt for the Claude agent
- `lib/auth.ts` — validates `Authorization: Bearer <MOCKER_API_SECRET>` on all non-health endpoints
- `lib/types.ts` — shared TypeScript interfaces (`RemixRequest`, `VariationResult`, etc.)

### Key Constraints

- Service workers cannot use `DOMParser` — HTML assembly is done by injecting a function into the page tab via `chrome.scripting.executeScript`
- `lib/gitlab-api.js` uses `PRIVATE-TOKEN` header; `lib/github-api.js` uses `Authorization: Bearer` header
- GitHub Contents API requires the existing file SHA for updates; GitLab uses `create`/`update` action strings
- Resource fetching uses `credentials: 'omit'` to avoid CORS issues
- The sandbox microVM has no access to extension state — all data passes via Vercel Blob URLs
