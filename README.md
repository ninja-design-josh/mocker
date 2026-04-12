# Mocker

A Chrome extension that captures full-page snapshots and commits them to GitLab or GitHub. Each snapshot is a self-contained HTML file with all images, fonts, and CSS embedded as data URIs — no external dependencies, viewable offline.

Snapshots can be **remixed** using Claude: describe the changes you want and an AI agent iteratively edits the HTML, producing new variations stored in Vercel Blob.

## What It Does

1. Click the extension icon on any page
2. Name your snapshot and branch
3. Mocker captures the DOM, downloads every linked resource (stylesheets, images, fonts), strips scripts and event handlers, and assembles a single static HTML file
4. The file is committed to your configured GitLab or GitHub repository on a new branch

The result is a pixel-accurate, static copy of the page stored in version control — useful for archiving design variations, tracking visual changes, or sharing mockups.

### Remix

After capturing a snapshot, click **Remix** in the sidebar to create AI-powered variations:

1. Enter a prompt describing the changes (e.g. "make it dark mode", "change the hero text to French")
2. Choose the number of variations
3. The Vercel backend spins up a sandboxed environment, runs the Claude Agent SDK to iteratively edit the HTML, and streams progress back via SSE
4. Each variation is uploaded to Vercel Blob with a public URL

The agent uses `Read` and `Edit` tools to make surgical changes — it never rewrites the entire file, preserving layout fidelity.

## Install

No build step required.

1. Clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the repository folder

## Setup

Click the extension icon, then **Open Settings** (or right-click the extension icon and choose **Options**).

### GitLab

1. Select **GitLab** as the provider
2. Enter your GitLab instance URL (e.g. `https://gitlab.com`)
3. Add a Personal Access Token with `api` scope
4. Enter the Project ID (numeric) or URL-encoded path (e.g. `my-group%2Fmy-repo`)
5. Optionally adjust the target branch and base path
6. Click **Test Connection**, then **Save Settings**

### GitHub

1. Select **GitHub** as the provider
2. Add a Personal Access Token with `repo` scope
3. Enter the repository owner (username or org) and repository name
4. Optionally adjust the target branch and base path
5. Click **Test Connection**, then **Save Settings**

Switching providers preserves credentials for both, so you can switch back without re-entering anything.

### Remix Backend (Vercel)

The remix feature requires a Vercel backend. See [Backend Setup](#backend-setup) below for deployment instructions.

Once deployed, configure the extension:

1. In **Remix Settings**, set Storage Mode to **Vercel (recommended)**
2. Enter your Vercel backend URL (e.g. `https://mocker-woad.vercel.app`)
3. Enter the Backend API Key (must match `MOCKER_API_SECRET` on Vercel)
4. Click **Test Backend** to verify the connection
5. Optionally check **Also commit remixes to repository** to save variations to Git as well

A fallback **Direct API** mode (browser-side Claude call) is available if you prefer not to deploy a backend — set Storage Mode to **Repository only** and provide a Claude API key.

## Usage

1. Navigate to the page you want to capture
2. Click the Mocker extension icon
3. Adjust the snapshot name and branch name if needed
4. Click **Save Snapshot**
5. A progress bar tracks each step: DOM capture, resource fetching, assembly, and commit
6. On success, the branch name and file path are shown with a copy button

Snapshots are saved to `{basePath}/{snapshotName}/original.html` on the specified branch.

## Backend Setup

The `backend/` directory is a standalone Vercel project that powers the remix feature.

### Deploy

```bash
cd backend
npm install
vercel --yes          # first deploy — creates project
vercel --prod         # production deploy
```

### Environment Variables

Set these in the Vercel dashboard (Settings > Environment Variables):

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key for Claude |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage token (create a Blob store in Vercel Storage) |
| `MOCKER_API_SECRET` | Shared secret for authenticating extension requests |

### How It Works

The remix endpoint (`POST /api/remix`) uses [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) to run the Claude Agent SDK in an isolated Firecracker microVM:

1. Extension strips data URIs from the snapshot HTML, replacing them with `{{DATAURI_N}}` placeholders
2. Stripped HTML and data URI map are uploaded to Vercel Blob (avoids payload size limits)
3. Extension calls the remix endpoint with blob URLs, prompt, and variation count
4. For each variation, the backend creates a sandbox, installs the Agent SDK, writes the HTML file, and runs a script that calls `query()` with `Read` and `Edit` tools
5. The agent reads the file, makes targeted edits, and the backend reads back the modified HTML
6. Data URIs are restored server-side, and the complete HTML is uploaded to Vercel Blob
7. Progress and results stream back to the extension via SSE

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/remix` | POST | Run AI remix (SSE stream) |
| `/api/store` | POST | Upload HTML to Blob storage |
| `/api/upload-token` | POST | Generate client-side Blob upload token |

All endpoints except `/api/health` require `Authorization: Bearer <MOCKER_API_SECRET>`.

## Project Structure

```
background/service-worker.js   Main orchestration — capture pipeline, remix dispatch
content/capture.js              Injected into pages to extract DOM and resource URLs
lib/gitlab-api.js               GitLab commit API
lib/github-api.js               GitHub commit API
options/                        Settings page (provider, credentials, remix config)
sidebar/                        Side panel (snapshot form, remix UI, progress, results)
backend/
  api/health.ts                 Health check endpoint
  api/remix.ts                  Remix endpoint — SSE streaming, blob upload
  api/store.ts                  Blob storage upload
  api/upload-token.ts           Client-side blob upload token
  lib/agent.ts                  Sandbox-based Agent SDK wrapper
  lib/auth.ts                   Bearer token auth
  lib/types.ts                  Shared TypeScript interfaces
```
