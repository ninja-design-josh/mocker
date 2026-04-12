# Mocker

A Chrome extension that captures full-page snapshots and commits them to GitLab or GitHub. Each snapshot is a self-contained HTML file with all images, fonts, and CSS embedded as data URIs — no external dependencies, viewable offline.

## What It Does

1. Click the extension icon on any page
2. Name your snapshot and branch
3. Mocker captures the DOM, downloads every linked resource (stylesheets, images, fonts), strips scripts and event handlers, and assembles a single static HTML file
4. The file is committed to your configured GitLab or GitHub repository on a new branch

The result is a pixel-accurate, static copy of the page stored in version control — useful for archiving design variations, tracking visual changes, or sharing mockups.

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

## Usage

1. Navigate to the page you want to capture
2. Click the Mocker extension icon
3. Adjust the snapshot name and branch name if needed
4. Click **Save Snapshot**
5. A progress bar tracks each step: DOM capture, resource fetching, assembly, and commit
6. On success, the branch name and file path are shown with a copy button

Snapshots are saved to `{basePath}/{snapshotName}/original.html` on the specified branch.

## Project Structure

```
background/service-worker.js   Main orchestration — capture pipeline and provider dispatch
content/capture.js              Injected into pages to extract DOM and resource URLs
lib/gitlab-api.js               GitLab commit API
lib/github-api.js               GitHub commit API
options/                        Settings page (provider selection, credentials, connection test)
popup/                          Extension popup (snapshot form, progress, results)
```
