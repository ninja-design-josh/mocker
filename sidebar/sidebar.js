import { uploadImageToBlob } from '../lib/utils.js';

const STORAGE_KEY = 'mocker_settings';
const MAX_REFERENCE_IMAGES = 10;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — Claude's per-image limit

const phases = {
  noConfig: document.getElementById('no-config'),
  noTab: document.getElementById('no-tab'),
  capture: document.getElementById('capture-form'),
  progress: document.getElementById('progress'),
  prompt: document.getElementById('phase-prompt'),
  plan: document.getElementById('phase-plan'),
  remixProgress: document.getElementById('phase-remix-progress'),
  error: document.getElementById('error'),
};
const historySection = document.getElementById('history');
const versionTreeSection = document.getElementById('version-tree-section');

const currentUrlEl = document.getElementById('current-url');
const snapshotNameInput = document.getElementById('snapshot-name');
const branchNameInput = document.getElementById('branch-name');
const branchHint = document.getElementById('branch-hint');
const branchToggleBtns = document.querySelectorAll('.toggle-btn');
const repoOptions = document.getElementById('repo-options');
const saveToRepoCheck = document.getElementById('save-to-repo-check');
const branchFields = document.getElementById('branch-fields');

let branchMode = 'new';
const saveBtn = document.getElementById('save-btn');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const errorText = document.getElementById('error-text');
const copyPreviewBtn = document.getElementById('copy-preview');
const downloadSnapshotBtn = document.getElementById('download-snapshot');
const saveToRepoBtn = document.getElementById('save-to-repo-btn');
const newCaptureBtn = document.getElementById('new-capture-btn');
const repoResult = document.getElementById('repo-result');
const resultUrl = document.getElementById('result-url');
const remixSection = document.getElementById('phase-prompt');
const remixPrompt = document.getElementById('remix-prompt');
const remixCount = document.getElementById('remix-count');
const remixUseBento = document.getElementById('remix-use-bento');
const remixPlanFirst = document.getElementById('remix-plan-first');
const remixBtn = document.getElementById('remix-btn');
const planPanel = document.getElementById('plan-panel');
const planBullets = document.getElementById('plan-bullets');
const planQuestionsEl = document.getElementById('plan-questions');
const planConfirmBtn = document.getElementById('plan-confirm-btn');
const planSkipBtn = document.getElementById('plan-skip-btn');
const planCancelBtn = document.getElementById('plan-cancel-btn');
const remixComposerSection = document.getElementById('remix-composer-section');
const remixStatus = document.getElementById('remix-status');
const remixTurns = document.getElementById('remix-turns');
const remixSourceName = document.getElementById('remix-source-name');
const clearRemixSource = document.getElementById('clear-remix-source');
const versionTreeCard = versionTreeSection; // alias for backward compat
const versionTree = document.getElementById('version-tree');
const tabCapture = document.getElementById('tab-capture');
const tabHistory = document.getElementById('tab-history');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const snapshotTitle = document.getElementById('snapshot-title');
const snapshotMeta = document.getElementById('snapshot-meta');

// Reference image elements
const remixRefsThumbs = document.getElementById('remix-refs-thumbs');
const remixRefsInput = document.getElementById('remix-refs-input');
const remixAddRefsBtn = document.getElementById('remix-add-refs');
const remixRefsCount = document.getElementById('remix-refs-count');
const remixDropOverlay = document.getElementById('remix-drop-overlay');
const lightboxEl = document.getElementById('image-lightbox');
const lightboxImg = document.getElementById('image-lightbox-img');
const lightboxCaption = document.getElementById('image-lightbox-caption');
const lightboxClose = document.getElementById('image-lightbox-close');

// Current workspace state
let suppressStorageReinit = false;
let currentSnapshotId = null;
let remixSourceVersionId = null; // null = remix from original
let hasVercelBackend = false;
let hasRepoCreds = false;
let currentBlobUrl = null;
let activeTab = 'capture'; // 'capture' or 'history'
let currentPhase = null;
let lastCapturePhase = 'capture'; // remember which capture phase was showing

// Track spinner elements for active remixes on history cards, keyed by snapshotId
const historySpinners = new Map();

// Plan-first pending context: set when the plan panel is open waiting for user review.
let pendingPlanContext = null;

// Reference image state: items = [{ id, name, mediaType, previewUrl, url?, uploading, error? }]
// Only items with `url` set are sent to the backend.
let referenceImages = [];
let refImageIdCounter = 0;
let currentSettings = null; // cached from init() so upload helpers have vercelUrl/apiKey

// Focus area state — populated by the element picker
let focusAreas = [];        // [{ index, selector, tagName, id, classes, textPreview, rect }]
let focusScreenshotUrl = null; // Blob URL of annotated screenshot with overlays
let focusPickerActive = false;

// Capture-flow phases (everything except history)
const capturePhases = ['noConfig', 'noTab', 'capture', 'progress', 'prompt', 'plan', 'remixProgress', 'error'];

function showPhase(name) {
  // Hide all phase containers
  Object.values(phases).forEach(el => el.hidden = true);
  historySection.hidden = true;
  if (name === 'history') {
    historySection.hidden = false;
  } else {
    phases[name].hidden = false;
  }
  currentPhase = name;
  // Track last capture phase so we can restore when switching tabs
  if (capturePhases.includes(name)) {
    lastCapturePhase = name;
  }
}

function setVersionTreeVisible(visible) {
  versionTreeSection.hidden = !visible;
}

// Route blob URLs through the backend preview proxy so Chrome renders the
// HTML inline instead of downloading it. Falls back to the raw blob URL if
// the backend isn't configured.
function buildPreviewUrl(blobUrl) {
  const base = currentSettings?.vercelUrl;
  if (!base || !blobUrl) return blobUrl;
  return `${base.replace(/\/$/, '')}/api/preview?url=${encodeURIComponent(blobUrl)}`;
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return path || 'home';
  } catch {
    return 'page';
  }
}

function generateBranchName(url) {
  const slug = slugFromUrl(url);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `mocker/${slug}-${date}-${time}`;
}

// Download a cross-origin blob URL as a file
async function downloadFromUrl(url, filename) {
  const resp = await fetch(url);
  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// Toast notification
const toast = document.getElementById('toast');
let toastTimer = null;
function showToast(message, duration = 5000) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}

// Download text content as a file
function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function setProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

function isConfigured(settings) {
  if (!settings) return false;
  // Backend-only config is sufficient
  if (settings.vercelUrl && settings.vercelApiKey) return true;
  // Or repo-only (legacy)
  const provider = settings.provider || 'gitlab';
  if (provider === 'github') {
    return !!(settings.githubToken && settings.githubOwner && settings.githubRepo);
  }
  return !!(settings.gitlabUrl && settings.accessToken && settings.projectId);
}

function checkRepoCreds(settings) {
  if (!settings) return false;
  const provider = settings.provider || 'gitlab';
  if (provider === 'github') {
    return !!(settings.githubToken && settings.githubOwner && settings.githubRepo);
  }
  return !!(settings.gitlabUrl && settings.accessToken && settings.projectId);
}

function setBranchMode(mode) {
  branchMode = mode;
  branchToggleBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  if (mode === 'new') {
    branchHint.textContent = 'A new branch will be created from the base branch';
  } else {
    branchNameInput.value = '';
    branchNameInput.placeholder = 'main';
    branchHint.textContent = 'Snapshot will be committed to this branch';
  }
}

branchToggleBtns.forEach(btn => {
  btn.addEventListener('click', () => setBranchMode(btn.dataset.mode));
});

// Toggle branch fields when "Also save to Git repository" is checked
saveToRepoCheck.addEventListener('change', () => {
  branchFields.hidden = !saveToRepoCheck.checked;
});

// ── Version labeling ──────────────────────────────────────────────────

function labelVersions(versions) {
  const roots = versions.filter(v => v.parentId === null)
    .sort((a, b) => a.createdAt - b.createdAt);
  roots.forEach((v, i) => { v.label = `v${i + 1}`; });

  function labelChildren(parent) {
    const children = versions.filter(v => v.parentId === parent.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    children.forEach((v, i) => {
      v.label = `${parent.label}.${i + 1}`;
      labelChildren(v);
    });
  }
  roots.forEach(labelChildren);
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return minutes === 1 ? '1 min ago' : `${minutes} mins ago`;
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) {
    return new Date(ts).toLocaleDateString([], { weekday: 'long' });
  }
  if (days < 14) return 'Last week';
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} weeks ago`;
  }
  if (days < 60) return 'Last month';
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} months ago`;
  }
  if (days < 730) return 'Last year';
  const years = Math.floor(days / 365);
  return `${years} years ago`;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

// ── Render version tree ───────────────────────────────────────────────

function renderVersionTree(versions) {
  versionTree.innerHTML = '';
  if (!versions.length) {
    return;
  }

  labelVersions(versions);

  // Sort by createdAt for display order, but grouped by tree structure
  function renderSubtree(parentId, depth) {
    const children = versions
      .filter(v => v.parentId === parentId)
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const v of children) {
      const row = document.createElement('div');
      row.className = 'version-row';
      row.style.paddingLeft = `${depth * 16 + 8}px`;

      const info = document.createElement('div');
      info.className = 'version-info';

      const label = document.createElement('span');
      label.className = 'version-label';
      label.textContent = v.label;

      const prompt = document.createElement('span');
      prompt.className = 'version-prompt';
      prompt.textContent = truncate(v.prompt, 30);
      prompt.title = v.prompt;

      const time = document.createElement('span');
      time.className = 'version-time';
      time.textContent = formatRelativeTime(v.createdAt);

      info.appendChild(label);
      info.appendChild(prompt);
      const refExpand = buildVersionRefBadge(v, info);
      info.appendChild(time);

      const actions = document.createElement('div');
      actions.className = 'version-actions';

      if (v.blobUrl) {
        const dlBtn = document.createElement('button');
        dlBtn.className = 'version-btn';
        dlBtn.textContent = 'Download';
        dlBtn.addEventListener('click', () => {
          const snapName = snapshotTitle.textContent || 'snapshot';
          downloadFromUrl(v.blobUrl, `${snapName} ${v.label}.html`);
        });
        actions.appendChild(dlBtn);

        const specBtn = document.createElement('button');
        specBtn.className = 'version-btn';
        specBtn.textContent = 'Spec';
        specBtn.addEventListener('click', async () => {
          specBtn.disabled = true;
          specBtn.textContent = 'Generating...';
          try {
            const resp = await chrome.runtime.sendMessage({
              action: 'generateSpec',
              versionId: v.id,
              versionLabel: v.label,
            });
            if (resp.error) throw new Error(resp.error);
            const snapName = snapshotTitle.textContent || 'snapshot';
            downloadText(resp.spec, `${snapName}-${v.label}.spec.md`);
            specBtn.textContent = 'Spec';
          } catch (err) {
            console.error('Spec generation failed:', err);
            showToast(err.message || 'Spec generation failed');
            specBtn.textContent = 'Spec';
          } finally {
            specBtn.disabled = false;
          }
        });
        actions.appendChild(specBtn);

        const previewBtn = document.createElement('button');
        previewBtn.className = 'version-btn';
        previewBtn.textContent = 'Preview';
        previewBtn.addEventListener('click', () => {
          chrome.tabs.create({ url: buildPreviewUrl(v.blobUrl) });
        });
        actions.appendChild(previewBtn);
      }

      const remixThisBtn = document.createElement('button');
      remixThisBtn.className = 'version-btn';
      remixThisBtn.textContent = 'Remix this';
      remixThisBtn.addEventListener('click', () => {
        setRemixSource(v.id, v.label);
      });
      actions.appendChild(remixThisBtn);

      row.appendChild(info);
      row.appendChild(actions);
      versionTree.appendChild(row);
      if (refExpand) {
        refExpand.style.paddingLeft = `${depth * 16 + 16}px`;
        versionTree.appendChild(refExpand);
      }

      // Render children recursively
      renderSubtree(v.id, depth + 1);
    }
  }

  renderSubtree(null, 0);
}

// ── Remix source management ───────────────────────────────────────────

function setRemixSource(versionId, label) {
  remixSourceVersionId = versionId;
  remixSourceName.textContent = label;
  clearRemixSource.hidden = false;
  // Scroll remix section into view
  remixSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearRemixSourceFn() {
  remixSourceVersionId = null;
  remixSourceName.textContent = 'Original';
  clearRemixSource.hidden = true;
}

clearRemixSource.addEventListener('click', clearRemixSourceFn);

// ── Refresh version tree from service worker ──────────────────────────

async function refreshVersionTree() {
  if (!currentSnapshotId) return;
  const resp = await chrome.runtime.sendMessage({
    action: 'getVersionTree',
    snapshotId: currentSnapshotId,
  });
  if (resp.versions) {
    renderVersionTree(resp.versions);
  }
}

// ── Active tab helpers ────────────────────────────────────────────────

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  currentUrlEl.textContent = tab.url;
  currentUrlEl.title = tab.url;
  snapshotNameInput.value = slugFromUrl(tab.url);
  if (branchMode === 'new') {
    branchNameInput.value = generateBranchName(tab.url);
  }
}

// ── Tab switching ─────────────────────────────────────────────────────

function switchTab(tab) {
  activeTab = tab;
  tabCapture.classList.toggle('active', tab === 'capture');
  tabHistory.classList.toggle('active', tab === 'history');

  if (tab === 'capture') {
    showPhase(lastCapturePhase);
    setVersionTreeVisible(!!currentSnapshotId);
  } else {
    setVersionTreeVisible(false);
    showPhase('history');
    loadFullHistory();
  }
}

tabCapture.addEventListener('click', () => switchTab('capture'));
tabHistory.addEventListener('click', () => switchTab('history'));

// ── Full history view ─────────────────────────────────────────────────

function buildHistorySpinner(variation, total) {
  const wrap = document.createElement('span');
  wrap.className = 'history-snapshot-spinner';
  wrap.addEventListener('click', (e) => e.stopPropagation()); // don't trigger card restore
  const dot = document.createElement('span');
  dot.className = 'history-spinner-dot';
  wrap.appendChild(dot);
  const label = document.createElement('span');
  label.className = 'history-spinner-label';
  label.textContent = variation && total ? `Remixing ${variation}/${total}…` : 'Remixing…';
  wrap.appendChild(label);
  return wrap;
}

async function loadFullHistory() {
  const [resp, remixResp] = await Promise.all([
    chrome.runtime.sendMessage({ action: 'getSnapshotsWithVersions' }),
    chrome.runtime.sendMessage({ action: 'getActiveRemixes' }),
  ]);
  if (!resp.snapshots) return;

  historyList.innerHTML = '';
  historySpinners.clear();

  // Build lookup of active remix jobs
  const activeInfo = new Map();
  if (remixResp?.active) {
    for (const a of remixResp.active) activeInfo.set(a.snapshotId, a);
  }

  if (!resp.snapshots.length) {
    historyEmpty.hidden = false;
    return;
  }
  historyEmpty.hidden = true;

  for (const s of resp.snapshots) {
    const card = document.createElement('div');
    card.className = 'history-snapshot-card';
    card._snapshotId = s.id;

    // Header: name + date — clickable to restore capture session
    const header = document.createElement('div');
    header.className = 'history-snapshot-header';

    const name = document.createElement('span');
    name.className = 'history-snapshot-name';
    name.textContent = s.snapshotName;

    const date = document.createElement('span');
    date.className = 'history-snapshot-date';
    date.textContent = formatRelativeTime(s.createdAt);

    header.appendChild(name);
    header.appendChild(date);

    // Spinner for active remix jobs
    if (activeInfo.has(s.id)) {
      const a = activeInfo.get(s.id);
      const spinner = buildHistorySpinner(a.variation, a.total);
      header.appendChild(spinner);
      historySpinners.set(s.id, spinner);
    }

    // Click header to restore this snapshot in the capture tab
    header.addEventListener('click', () => {
      loadSnapshotWorkspace(s.id, s).then(() => switchTab('capture'));
    });

    card.appendChild(header);

    // Snapshot actions: Download + Preview
    if (s.blobUrl) {
      const actions = document.createElement('div');
      actions.className = 'history-snapshot-actions';

      const dlBtn = document.createElement('button');
      dlBtn.className = 'version-btn';
      dlBtn.textContent = 'Download';
      dlBtn.addEventListener('click', () => {
        downloadFromUrl(s.blobUrl, `${s.snapshotName}.html`);
      });
      actions.appendChild(dlBtn);

      const previewBtn = document.createElement('button');
      previewBtn.className = 'version-btn';
      previewBtn.textContent = 'Preview';
      previewBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: buildPreviewUrl(s.blobUrl) });
      });
      actions.appendChild(previewBtn);

      card.appendChild(actions);
    }

    // Version tree (if any)
    const versions = s.versions || [];
    if (versions.length) {
      labelVersions(versions);
      const versionsContainer = document.createElement('div');
      versionsContainer.className = 'history-versions';

      function renderHistorySubtree(parentId, depth) {
        const children = versions
          .filter(v => v.parentId === parentId)
          .sort((a, b) => a.createdAt - b.createdAt);

        for (const v of children) {
          const row = document.createElement('div');
          row.className = 'version-row';
          row.style.paddingLeft = `${depth * 16 + 4}px`;

          const info = document.createElement('div');
          info.className = 'version-info';

          const label = document.createElement('span');
          label.className = 'version-label';
          label.textContent = v.label;

          const prompt = document.createElement('span');
          prompt.className = 'version-prompt';
          prompt.textContent = truncate(v.prompt, 25);
          prompt.title = v.prompt;

          const time = document.createElement('span');
          time.className = 'version-time';
          time.textContent = formatRelativeTime(v.createdAt);

          info.appendChild(label);
          info.appendChild(prompt);
          const vRefExpand = buildVersionRefBadge(v, info);
          info.appendChild(time);

          const vActions = document.createElement('div');
          vActions.className = 'version-actions';

          if (v.blobUrl) {
            const vDl = document.createElement('button');
            vDl.className = 'version-btn';
            vDl.textContent = 'Download';
            vDl.addEventListener('click', () => {
              downloadFromUrl(v.blobUrl, `${s.snapshotName} ${v.label}.html`);
            });
            vActions.appendChild(vDl);

            const vPreview = document.createElement('button');
            vPreview.className = 'version-btn';
            vPreview.textContent = 'Preview';
            vPreview.addEventListener('click', () => {
              chrome.tabs.create({ url: buildPreviewUrl(v.blobUrl) });
            });
            vActions.appendChild(vPreview);

            const vSpec = document.createElement('button');
            vSpec.className = 'version-btn';
            vSpec.textContent = 'Spec';
            vSpec.addEventListener('click', async () => {
              vSpec.disabled = true;
              vSpec.textContent = 'Generating...';
              try {
                const resp = await chrome.runtime.sendMessage({
                  action: 'generateSpec',
                  versionId: v.id,
                  versionLabel: v.label,
                });
                if (resp.error) throw new Error(resp.error);
                downloadText(resp.spec, `${s.snapshotName}-${v.label}.spec.md`);
                vSpec.textContent = 'Spec';
              } catch (err) {
                console.error('Spec generation failed:', err);
                showToast(err.message || 'Spec generation failed');
                vSpec.textContent = 'Spec';
              } finally {
                vSpec.disabled = false;
              }
            });
            vActions.appendChild(vSpec);
          }

          const remixThisBtn = document.createElement('button');
          remixThisBtn.className = 'version-btn';
          remixThisBtn.textContent = 'Remix this';
          remixThisBtn.addEventListener('click', () => {
            // Load the parent snapshot workspace, set remix source, switch to capture tab
            currentSnapshotId = s.id;
            loadSnapshotWorkspace(s.id, s).then(() => {
              setRemixSource(v.id, v.label);
              switchTab('capture');
            });
          });
          vActions.appendChild(remixThisBtn);

          row.appendChild(info);
          row.appendChild(vActions);
          versionsContainer.appendChild(row);
          if (vRefExpand) {
            vRefExpand.style.paddingLeft = `${depth * 16 + 12}px`;
            versionsContainer.appendChild(vRefExpand);
          }

          renderHistorySubtree(v.id, depth + 1);
        }
      }

      renderHistorySubtree(null, 0);
      card.appendChild(versionsContainer);
    }

    historyList.appendChild(card);
  }
}

// ── Load snapshot workspace ───────────────────────────────────────────

async function loadSnapshotWorkspace(snapshotId, snapshotData) {
  currentSnapshotId = snapshotId;
  clearRemixSourceFn();

  // Tell service worker to set active context
  await chrome.runtime.sendMessage({ action: 'loadSnapshot', snapshotId });

  snapshotTitle.textContent = snapshotData.snapshotName;
  snapshotMeta.textContent = new Date(snapshotData.createdAt).toLocaleString();

  // Download + preview
  currentBlobUrl = snapshotData.blobUrl || null;
  if (snapshotData.blobUrl) {
    downloadSnapshotBtn.hidden = false;
    downloadSnapshotBtn.onclick = () => downloadFromUrl(snapshotData.blobUrl, `${snapshotData.snapshotName}.html`);
    copyPreviewBtn.hidden = false;
  } else {
    downloadSnapshotBtn.hidden = true;
    copyPreviewBtn.hidden = true;
  }

  // Repo result
  if (snapshotData.repoUrl) {
    resultUrl.href = snapshotData.repoUrl;
    resultUrl.textContent = snapshotData.repoUrl;
    repoResult.hidden = false;
  } else {
    repoResult.hidden = true;
  }

  // Save to repo button
  saveToRepoBtn.hidden = !hasRepoCreds || !!snapshotData.repoUrl;

  // Reset remix state (prompt phase IS the remix section now)
  resetRemixState();

  setVersionTreeVisible(true);
  showPhase('prompt');
  await refreshVersionTree();
}

// ── Init ──────────────────────────────────────────────────────────────

async function init() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];
  currentSettings = settings;

  // useBento toggle: default on, respect explicit false.
  const useBentoStored = settings?.useBento;
  remixUseBento.checked = useBentoStored !== false;

  // planFirst toggle: default off, opt-in.
  remixPlanFirst.checked = settings?.planFirst === true;

  hasVercelBackend = !!(settings?.vercelUrl && settings?.vercelApiKey);
  hasRepoCreds = checkRepoCreds(settings);

  if (!isConfigured(settings)) {
    showPhase('noConfig');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    showPhase('noTab');
    return;
  }

  currentUrlEl.textContent = tab.url;
  currentUrlEl.title = tab.url;
  snapshotNameInput.value = slugFromUrl(tab.url);
  if (branchMode === 'new') {
    branchNameInput.value = generateBranchName(tab.url);
  }

  // Show repo options only if creds exist
  if (hasRepoCreds) {
    repoOptions.hidden = false;
    saveToRepoCheck.checked = !!settings.defaultSaveToRepo;
    branchFields.hidden = !saveToRepoCheck.checked;
  } else {
    repoOptions.hidden = true;
  }

  showPhase('capture');
}

// ── Capture ───────────────────────────────────────────────────────────

saveBtn.addEventListener('click', async () => {
  const name = snapshotNameInput.value.trim();
  if (!name) {
    snapshotNameInput.focus();
    return;
  }

  const slug = name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const branch = branchNameInput.value.trim();
  const branchSlug = branch ? branch.replace(/[^a-z0-9/_-]+/gi, '-').toLowerCase() : 'main';

  saveBtn.disabled = true;
  showPhase('progress');
  setProgress(5, 'Capturing page...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const response = await chrome.runtime.sendMessage({
      action: 'captureSnapshot',
      tabId: tab.id,
      snapshotName: slug,
      branchName: branchSlug,
      sourceUrl: tab.url,
    });

    if (response.error) {
      throw new Error(response.error);
    }

    currentSnapshotId = response.snapshotId;

    // Build snapshot data for workspace
    const snapshotData = {
      snapshotName: slug,
      blobUrl: response.blobUrl || response.previewUrl || null,
      repoUrl: response.repoUrl || response.fileUrl || null,
      createdAt: Date.now(),
    };

    await loadSnapshotWorkspace(response.snapshotId, snapshotData);
  } catch (err) {
    errorText.textContent = err.message || 'Unknown error';
    showPhase('error');
  } finally {
    saveBtn.disabled = false;
  }
});

// Listen for progress updates from the service worker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'captureProgress') {
    setProgress(msg.percent, msg.text);
  }
});

// ── Focus area picker messages ───────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'focusAreasComplete') {
    focusAreas = msg.areas || [];
    focusScreenshotUrl = msg.screenshotUrl || null;
    focusPickerActive = false;
    focusPickerBtn.classList.remove('picking');
    renderFocusChips();
  }
  if (msg.action === 'focusAreasCancelled') {
    focusPickerActive = false;
    focusPickerBtn.classList.remove('picking');
  }
});

// ── Header buttons ────────────────────────────────────────────────────

document.getElementById('reload-extension').addEventListener('click', () => {
  chrome.runtime.reload();
});

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('open-options-card').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

copyPreviewBtn.addEventListener('click', () => {
  if (currentBlobUrl) chrome.tabs.create({ url: buildPreviewUrl(currentBlobUrl) });
});

// Save to repo on demand
saveToRepoBtn.addEventListener('click', async () => {
  if (!currentSnapshotId) return;
  saveToRepoBtn.disabled = true;
  saveToRepoBtn.title = 'Saving...';

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'commitToRepo',
      snapshotId: currentSnapshotId,
    });

    if (resp.error) throw new Error(resp.error);

    resultUrl.href = resp.fileUrl;
    resultUrl.textContent = resp.fileUrl;
    repoResult.hidden = false;
    saveToRepoBtn.hidden = true;
  } catch (err) {
    saveToRepoBtn.title = 'Failed — click to retry';
    setTimeout(() => {
      saveToRepoBtn.title = 'Save to repo';
      saveToRepoBtn.disabled = false;
    }, 2000);
  }
});

// New capture button — return to capture form
newCaptureBtn.addEventListener('click', () => {
  currentSnapshotId = null;
  clearRemixSourceFn();
  setBranchMode('new');
  setVersionTreeVisible(false);
  showPhase('capture');
  refreshActiveTab();
});

// ── Reference images ──────────────────────────────────────────────────

function resetReferenceImages() {
  for (const img of referenceImages) {
    if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
  }
  referenceImages = [];
  renderReferenceThumbs();
}

function renderReferenceThumbs() {
  if (!referenceImages.length) {
    remixRefsThumbs.hidden = true;
    remixRefsThumbs.innerHTML = '';
    remixRefsCount.hidden = true;
    return;
  }
  remixRefsThumbs.hidden = false;
  remixRefsThumbs.innerHTML = '';
  for (const img of referenceImages) {
    const thumb = document.createElement('div');
    thumb.className = 'remix-refs-thumb' + (img.uploading ? ' uploading' : '');
    thumb.title = img.name + (img.uploading ? ' (uploading...)' : '');

    const imgEl = document.createElement('img');
    imgEl.src = img.previewUrl || img.url;
    imgEl.alt = img.name;
    imgEl.addEventListener('click', () => openLightbox(img.previewUrl || img.url, img.name));
    thumb.appendChild(imgEl);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remix-refs-thumb-remove';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', 'Remove ' + img.name);
    removeBtn.addEventListener('click', () => removeReferenceImage(img.id));
    thumb.appendChild(removeBtn);

    remixRefsThumbs.appendChild(thumb);
  }
  remixRefsCount.hidden = false;
  remixRefsCount.textContent = `${referenceImages.length} of ${MAX_REFERENCE_IMAGES}`;
}

function removeReferenceImage(id) {
  const idx = referenceImages.findIndex(x => x.id === id);
  if (idx < 0) return;
  const img = referenceImages[idx];
  if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
  referenceImages.splice(idx, 1);
  renderReferenceThumbs();
}

async function handleIncomingFiles(fileList) {
  if (!currentSettings?.vercelUrl || !currentSettings?.vercelApiKey) {
    showToast('Backend not configured — cannot upload reference images');
    return;
  }
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
  if (remaining <= 0) {
    showToast(`Maximum ${MAX_REFERENCE_IMAGES} reference images`);
    return;
  }

  const toProcess = [];
  for (const file of files) {
    if (toProcess.length >= remaining) {
      showToast(`Only ${remaining} more image${remaining === 1 ? '' : 's'} allowed — extras skipped`);
      break;
    }
    if (!file.type || !file.type.startsWith('image/')) {
      showToast(`Skipped "${file.name || 'file'}" — not an image`);
      continue;
    }
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
      showToast(`Skipped "${file.name}" — over 5MB`);
      continue;
    }
    toProcess.push(file);
  }

  // Add placeholders with local preview, then upload in parallel
  const items = toProcess.map(file => ({
    id: ++refImageIdCounter,
    name: file.name || 'image',
    mediaType: file.type,
    previewUrl: URL.createObjectURL(file),
    url: null,
    uploading: true,
    file,
  }));
  referenceImages.push(...items);
  renderReferenceThumbs();

  await Promise.all(items.map(async (item) => {
    try {
      const result = await uploadImageToBlob(item.file, currentSettings.vercelUrl, currentSettings.vercelApiKey);
      item.url = result.url;
      item.mediaType = result.mediaType;
      item.name = result.name;
    } catch (err) {
      console.error('Image upload failed:', err);
      showToast(`Upload failed for "${item.name}": ${err.message || err}`);
      const idx = referenceImages.findIndex(x => x.id === item.id);
      if (idx >= 0) {
        if (referenceImages[idx].previewUrl) URL.revokeObjectURL(referenceImages[idx].previewUrl);
        referenceImages.splice(idx, 1);
      }
    } finally {
      item.uploading = false;
      item.file = undefined;
      renderReferenceThumbs();
    }
  }));
}

function openLightbox(src, caption) {
  lightboxImg.src = src;
  lightboxCaption.textContent = caption || '';
  lightboxEl.hidden = false;
}

function closeLightbox() {
  lightboxEl.hidden = true;
  lightboxImg.src = '';
}

// Build an expandable thumbnail row for a persisted version's referenceImages.
// Appends a badge to infoEl (click toggles visibility) and returns the row
// the caller should insert after the version row, or null if no images.
function buildVersionRefBadge(v, infoEl) {
  const refs = v.referenceImages;
  if (!refs || !refs.length) return null;

  const badge = document.createElement('span');
  badge.className = 'version-refs-badge';
  badge.setAttribute('role', 'button');
  badge.setAttribute('aria-label', `${refs.length} reference image${refs.length === 1 ? '' : 's'}`);
  badge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>${refs.length}`;
  badge.title = `${refs.length} reference image${refs.length === 1 ? '' : 's'}`;

  const expandRow = document.createElement('div');
  expandRow.className = 'version-refs-expand';
  expandRow.hidden = true;
  for (const r of refs) {
    const thumb = document.createElement('div');
    thumb.className = 'remix-refs-thumb';
    const img = document.createElement('img');
    img.src = r.url;
    img.alt = r.name || '';
    img.title = r.name || '';
    img.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(r.url, r.name); });
    thumb.appendChild(img);
    expandRow.appendChild(thumb);
  }

  badge.addEventListener('click', () => { expandRow.hidden = !expandRow.hidden; });
  infoEl.appendChild(badge);
  return expandRow;
}

// ── Remix ─────────────────────────────────────────────────────────────

function setRemixStatus(text, spinning) {
  remixStatus.innerHTML = '';
  if (spinning) {
    const spinner = document.createElement('span');
    spinner.className = 'remix-spinner';
    remixStatus.appendChild(spinner);
  }
  remixStatus.appendChild(document.createTextNode(text));
}

// ── Focus area picker ─────────────────────────────────────────────

const focusChipsContainer = document.getElementById('focus-area-chips');
const focusPickerBtn = document.getElementById('remix-focus-picker');
const focusCountBadge = document.getElementById('remix-focus-count');

function clearFocusAreas() {
  focusAreas = [];
  focusScreenshotUrl = null;
  focusPickerActive = false;
  focusPickerBtn.classList.remove('picking');
  renderFocusChips();
}

function renderFocusChips() {
  if (!focusChipsContainer) return;
  if (!focusAreas.length) {
    focusChipsContainer.hidden = true;
    focusChipsContainer.innerHTML = '';
    focusCountBadge.hidden = true;
    return;
  }
  focusChipsContainer.hidden = false;
  focusChipsContainer.innerHTML = '';
  focusCountBadge.textContent = focusAreas.length;
  focusCountBadge.hidden = false;

  for (const area of focusAreas) {
    const chip = document.createElement('div');
    chip.className = 'focus-area-chip';

    const num = document.createElement('span');
    num.className = 'focus-area-chip-num';
    num.textContent = area.index;

    const label = document.createElement('span');
    label.className = 'focus-area-chip-label';

    const tag = document.createElement('span');
    tag.className = 'focus-area-chip-tag';
    const classStr = area.classes.length ? '.' + area.classes.slice(0, 2).join('.') : '';
    tag.textContent = area.tagName + classStr;

    label.appendChild(tag);
    if (area.textPreview) {
      const preview = document.createElement('span');
      preview.className = 'focus-area-chip-preview';
      preview.textContent = ' — ' + area.textPreview;
      label.appendChild(preview);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'focus-area-chip-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove focus area';
    removeBtn.addEventListener('click', () => removeFocusArea(area.index));

    chip.appendChild(num);
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    focusChipsContainer.appendChild(chip);
  }
}

function removeFocusArea(index) {
  focusAreas = focusAreas.filter(a => a.index !== index);
  // Renumber remaining
  focusAreas.forEach((a, i) => { a.index = i + 1; });
  // Screenshot is now stale if areas changed
  focusScreenshotUrl = null;
  renderFocusChips();
}

function buildFocusPrefix() {
  let prefix = 'FOCUS AREAS — Only modify the elements listed below. Do not change anything outside these areas.\n\n';
  for (const area of focusAreas) {
    const attrs = [area.tagName];
    if (area.id) attrs[0] += '#' + area.id;
    if (area.classes.length) attrs[0] += '.' + area.classes.join('.');
    prefix += `[${area.index}] <${attrs[0]}> — "${area.textPreview}"\n`;
    prefix += `    Selector: ${area.selector}\n\n`;
  }
  prefix += 'The first attached reference image shows these areas highlighted with numbered purple overlays.\n---\n\n';
  return prefix;
}

focusPickerBtn.addEventListener('click', async () => {
  if (focusPickerActive) return;

  // Clear previous focus areas when re-picking
  clearFocusAreas();
  focusPickerActive = true;
  focusPickerBtn.classList.add('picking');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'startFocusPicker' });
    if (response?.error) {
      showToast(response.error);
      focusPickerActive = false;
      focusPickerBtn.classList.remove('picking');
    }
  } catch (err) {
    showToast('Failed to start focus picker');
    focusPickerActive = false;
    focusPickerBtn.classList.remove('picking');
  }
});

function resetRemixState() {
  remixPrompt.value = '';
  remixBtn.disabled = false;
  remixBtn.classList.remove('is-planning');
  remixBtn.textContent = 'Remix';
  remixStatus.hidden = true;
  remixStatus.textContent = '';
  remixStatus.className = 'remix-status';
  remixTurns.hidden = true;
  remixTurns.innerHTML = '';
  if (planBullets) planBullets.value = '';
  if (planQuestionsEl) planQuestionsEl.innerHTML = '';
  pendingPlanContext = null;
  resetReferenceImages();
  clearFocusAreas();
}

function collectRemixContext() {
  const prompt = remixPrompt.value.trim();
  if (!prompt) {
    remixPrompt.focus();
    return null;
  }

  // Block while any image is still uploading
  if (referenceImages.some(x => x.uploading)) {
    showToast('Wait for reference images to finish uploading');
    return null;
  }

  const uploadedRefs = referenceImages
    .filter(x => x.url)
    .map(x => ({ url: x.url, mediaType: x.mediaType, name: x.name }));

  const allRefs = [];
  if (focusScreenshotUrl && focusAreas.length) {
    allRefs.push({ url: focusScreenshotUrl, mediaType: 'image/png', name: 'focus-areas.png' });
  }
  allRefs.push(...uploadedRefs);

  const focusPrefix = focusAreas.length ? buildFocusPrefix() : '';
  const count = parseInt(remixCount.value, 10);

  return { userPrompt: prompt, focusPrefix, allRefs, count };
}

async function dispatchRemix(finalPrompt, ctx) {
  remixBtn.disabled = true;
  remixStatus.hidden = false;
  remixStatus.className = 'remix-status';
  setRemixStatus(`Generating variation 1 of ${ctx.count}...`, true);
  showPhase('remixProgress');

  try {
    const action = remixSourceVersionId ? 'remixFromVersion' : 'remixSnapshot';
    const msg = { action, prompt: finalPrompt, count: ctx.count, snapshotId: currentSnapshotId };
    if (remixSourceVersionId) msg.versionId = remixSourceVersionId;
    if (ctx.allRefs.length) msg.referenceImages = ctx.allRefs;
    msg.useBento = remixUseBento.checked;
    if (focusAreas.length) msg.useFocusAreas = true;

    const response = await chrome.runtime.sendMessage(msg);
    if (response.error) throw new Error(response.error);

    setRemixStatus('Done!', false);
    resetReferenceImages();
    clearFocusAreas();
    await refreshVersionTree();
    showPhase('prompt');
  } catch (err) {
    remixStatus.className = 'remix-status error';
    setRemixStatus(err.message || 'Remix failed', false);
    showPhase('prompt');
  } finally {
    remixBtn.disabled = false;
  }
}

function renderPlanPanel(plan, questions) {
  planBullets.value = Array.isArray(plan) && plan.length
    ? plan.map(b => `- ${String(b).replace(/^[-*•\s]+/, '')}`).join('\n')
    : '';

  planQuestionsEl.innerHTML = '';
  (questions || []).forEach((q, i) => {
    const id = q.id || `q${i + 1}`;
    const row = document.createElement('div');
    row.className = 'plan-question';
    row.dataset.questionId = id;
    row.dataset.questionText = q.question;

    const label = document.createElement('label');
    label.className = 'plan-question-label';
    label.setAttribute('for', `plan-q-${id}`);
    label.textContent = q.question;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'plan-question-input';
    input.id = `plan-q-${id}`;
    if (q.suggestedAnswer) input.placeholder = q.suggestedAnswer;

    row.appendChild(label);
    row.appendChild(input);
    planQuestionsEl.appendChild(row);
  });

  showPhase('plan');
}

function hidePlanPanel() {
  planBullets.value = '';
  planQuestionsEl.innerHTML = '';
  pendingPlanContext = null;
  remixBtn.classList.remove('is-planning');
  remixBtn.textContent = 'Remix';
  remixBtn.disabled = false;
  showPhase('prompt');
}

function buildCombinedPrompt(ctx) {
  const original = ctx.userPrompt;
  const bulletLines = planBullets.value
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const planBody = bulletLines
    .map(l => (l.startsWith('-') || l.startsWith('*') ? l : `- ${l}`))
    .join('\n');

  const answeredQs = [];
  planQuestionsEl.querySelectorAll('.plan-question').forEach((row) => {
    const question = row.dataset.questionText;
    const input = row.querySelector('.plan-question-input');
    const answer = input?.value.trim();
    if (question && answer) answeredQs.push(`- Q: ${question} / A: ${answer}`);
  });

  const sections = [ctx.focusPrefix + original];
  if (planBody) sections.push(`Approved plan:\n${planBody}`);
  if (answeredQs.length) sections.push(`Clarifications:\n${answeredQs.join('\n')}`);
  return sections.join('\n\n');
}

remixBtn.addEventListener('click', async () => {
  const ctx = collectRemixContext();
  if (!ctx) return;

  // Plan-first path: fetch plan, show panel, return. Final dispatch happens
  // after the user confirms/skips in the panel.
  if (remixPlanFirst.checked && currentPhase !== 'plan') {
    remixBtn.disabled = true;
    remixBtn.classList.add('is-planning');
    remixBtn.textContent = 'Planning…';
    remixStatus.hidden = true;

    try {
      const action = remixSourceVersionId ? 'planRemixFromVersion' : 'planRemixSnapshot';
      const msg = {
        action,
        prompt: (ctx.focusPrefix || '') + ctx.userPrompt,
        snapshotId: currentSnapshotId,
        useBento: remixUseBento.checked,
        useFocusAreas: focusAreas.length > 0,
        referenceImageCount: ctx.allRefs.length,
        variationCount: ctx.count,
      };
      if (remixSourceVersionId) msg.versionId = remixSourceVersionId;

      const response = await chrome.runtime.sendMessage(msg);
      if (response?.error) throw new Error(response.error);

      pendingPlanContext = ctx;
      renderPlanPanel(response.plan, response.questions);
      remixBtn.textContent = 'Remix';
      remixBtn.classList.remove('is-planning');
    } catch (err) {
      remixStatus.hidden = false;
      remixStatus.className = 'remix-status error';
      setRemixStatus(err.message || 'Planning failed', false);
      remixBtn.disabled = false;
      remixBtn.classList.remove('is-planning');
      remixBtn.textContent = 'Remix';
    }
    return;
  }

  // Direct-remix path
  const finalPrompt = (ctx.focusPrefix || '') + ctx.userPrompt;
  await dispatchRemix(finalPrompt, ctx);
});

planConfirmBtn.addEventListener('click', async () => {
  if (!pendingPlanContext) return;
  const ctx = pendingPlanContext;
  const finalPrompt = buildCombinedPrompt(ctx);
  hidePlanPanel();
  await dispatchRemix(finalPrompt, ctx);
});

planSkipBtn.addEventListener('click', async () => {
  if (!pendingPlanContext) return;
  const ctx = pendingPlanContext;
  const finalPrompt = (ctx.focusPrefix || '') + ctx.userPrompt;
  hidePlanPanel();
  await dispatchRemix(finalPrompt, ctx);
});

planCancelBtn.addEventListener('click', () => {
  hidePlanPanel();
});

// ── Use Bento toggle persistence ───────────────────────────────────────

remixUseBento.addEventListener('change', async () => {
  const next = { ...(currentSettings || {}), useBento: remixUseBento.checked };
  suppressStorageReinit = true;
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  currentSettings = next;
});

remixPlanFirst.addEventListener('change', async () => {
  const next = { ...(currentSettings || {}), planFirst: remixPlanFirst.checked };
  suppressStorageReinit = true;
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  currentSettings = next;
});

// ── Auto-resize prompt textarea ──────────────────────────────────────
function autoResizePrompt() {
  remixPrompt.style.height = 'auto';
  remixPrompt.style.height = remixPrompt.scrollHeight + 'px';
}
remixPrompt.addEventListener('input', autoResizePrompt);

// ── Reference image input wiring ──────────────────────────────────────

remixAddRefsBtn.addEventListener('click', () => remixRefsInput.click());
remixRefsInput.addEventListener('change', (e) => {
  handleIncomingFiles(e.target.files);
  e.target.value = ''; // allow re-picking the same file
});

// Paste images from clipboard while focused in the prompt textarea
remixPrompt.addEventListener('paste', (e) => {
  if (!e.clipboardData) return;
  const files = [];
  for (const item of e.clipboardData.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length) {
    e.preventDefault();
    handleIncomingFiles(files);
  }
});

// Drag-and-drop anywhere on the remix card
(() => {
  const card = document.getElementById('phase-prompt');
  let dragCounter = 0;
  const hasFiles = (e) => {
    const types = e.dataTransfer?.types;
    return types && Array.from(types).includes('Files');
  };
  card.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter++;
    remixDropOverlay.hidden = false;
  });
  card.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  card.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) remixDropOverlay.hidden = true;
  });
  card.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter = 0;
    remixDropOverlay.hidden = true;
    handleIncomingFiles(e.dataTransfer.files);
  });
})();

// Lightbox dismiss: close button, backdrop click, ESC key
lightboxClose.addEventListener('click', closeLightbox);
lightboxEl.addEventListener('click', (e) => {
  if (e.target === lightboxEl) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lightboxEl.hidden) closeLightbox();
});

// Listen for remix progress updates — scoped to the active snapshot
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'remixProgress') {
    // Update history-card spinner regardless of which snapshot is active
    if (msg.snapshotId != null) {
      const spinner = historySpinners.get(msg.snapshotId);
      if (spinner) {
        const label = spinner.querySelector('.history-spinner-label');
        if (label) label.textContent = msg.current && msg.total ? `Remixing ${msg.current}/${msg.total}…` : 'Remixing…';
      } else {
        // Remix started while history was open — lazily add spinner to the rendered card
        const cards = historyList.querySelectorAll('.history-snapshot-card');
        for (const card of cards) {
          if (card._snapshotId === msg.snapshotId) {
            const header = card.querySelector('.history-snapshot-header');
            if (header) {
              const newSpinner = buildHistorySpinner(msg.current, msg.total);
              header.appendChild(newSpinner);
              historySpinners.set(msg.snapshotId, newSpinner);
            }
            break;
          }
        }
      }
    }

    // Only update the capture-screen remix status if this message is for the active snapshot
    if (msg.snapshotId == null || msg.snapshotId === currentSnapshotId) {
      const costStr = msg.costUsd != null ? ` — $${msg.costUsd.toFixed(2)}` : '';
      setRemixStatus(msg.text + costStr, true);

      // Render live turns feed
      if (msg.turns && msg.turns.length) {
        remixTurns.hidden = false;
        remixTurns.innerHTML = '';
        for (const t of msg.turns) {
          if (t.type !== 'assistant') continue;
          const el = document.createElement('div');
          el.className = 'turn-entry';
          const label = document.createElement('span');
          label.className = 'turn-label';
          const tools = (t.tools || []).join(', ');
          label.textContent = `Turn ${t.turn}` + (tools ? ` [${tools}]` : '');
          el.appendChild(label);
          if (t.thinking) {
            const think = document.createElement('div');
            think.className = 'turn-thinking';
            think.textContent = t.thinking;
            el.appendChild(think);
          }
          if (t.text) {
            const text = document.createElement('div');
            text.className = 'turn-text';
            text.textContent = t.text;
            el.appendChild(text);
          }
          remixTurns.appendChild(el);
        }
        remixTurns.scrollTop = remixTurns.scrollHeight;
      }
    }
  }

  // Clear spinner when a remix job ends
  if (msg.action === 'remixJobEnded' && msg.snapshotId != null) {
    const spinner = historySpinners.get(msg.snapshotId);
    if (spinner) {
      spinner.remove();
      historySpinners.delete(msg.snapshotId);
    }
  }
});

// Listen for individual variation completions — refresh tree immediately
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'remixVariationComplete' && msg.snapshotId === currentSnapshotId) {
    refreshVersionTree();
  }
});

// ── Navigation helpers ────────────────────────────────────────────────

document.getElementById('retry-btn').addEventListener('click', () => {
  setBranchMode('new');
  showPhase('capture');
  refreshActiveTab();
});

// Refresh form when user switches tabs (only if capture form is visible)
chrome.tabs.onActivated.addListener(() => {
  if (currentPhase === 'capture') {
    refreshActiveTab();
  }
});

// Refresh when a page finishes loading in the active tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && currentPhase === 'capture') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab && tab.id === tabId) {
        refreshActiveTab();
      }
    });
  }
});

// Re-run init when settings change (sidebar stays open)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) {
    if (suppressStorageReinit) {
      suppressStorageReinit = false;
      return;
    }
    init();
  }
});

init();
