import { uploadImageToBlob } from '../lib/utils.js';

const STORAGE_KEY = 'mocker_settings';
const MAX_REFERENCE_IMAGES = 10;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — Claude's per-image limit

const sections = {
  noConfig: document.getElementById('no-config'),
  noTab: document.getElementById('no-tab'),
  captureForm: document.getElementById('capture-form'),
  progress: document.getElementById('progress'),
  result: document.getElementById('result'),
  error: document.getElementById('error'),
  history: document.getElementById('history'),
};

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
const remixSection = document.getElementById('remix-section');
const remixPrompt = document.getElementById('remix-prompt');
const remixCount = document.getElementById('remix-count');
const remixBtn = document.getElementById('remix-btn');
const remixStatus = document.getElementById('remix-status');
const remixTurns = document.getElementById('remix-turns');
const remixSourceName = document.getElementById('remix-source-name');
const clearRemixSource = document.getElementById('clear-remix-source');
const versionTreeCard = document.getElementById('version-tree-card');
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
let currentSnapshotId = null;
let remixSourceVersionId = null; // null = remix from original
let hasVercelBackend = false;
let hasRepoCreds = false;
let currentBlobUrl = null;
let activeTab = 'capture'; // 'capture' or 'history'
let lastCaptureSection = 'captureForm'; // remember which capture section was showing

// Reference image state: items = [{ id, name, mediaType, previewUrl, url?, uploading, error? }]
// Only items with `url` set are sent to the backend.
let referenceImages = [];
let refImageIdCounter = 0;
let currentSettings = null; // cached from init() so upload helpers have vercelUrl/apiKey

// Capture-flow sections (everything except history)
const captureSections = ['noConfig', 'noTab', 'captureForm', 'progress', 'result', 'error'];

function showSection(name) {
  // Hide all sections
  Object.values(sections).forEach(el => el.hidden = true);
  sections[name].hidden = false;
  // Track last capture section so we can restore when switching tabs
  if (captureSections.includes(name)) {
    lastCaptureSection = name;
  }
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

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

// ── Render version tree ───────────────────────────────────────────────

function renderVersionTree(versions) {
  versionTree.innerHTML = '';
  if (!versions.length) {
    versionTreeCard.hidden = true;
    return;
  }

  labelVersions(versions);
  versionTreeCard.hidden = false;

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
      time.textContent = formatTime(v.createdAt);

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
          downloadFromUrl(v.blobUrl, `${v.label}.html`);
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

        const pubBtn = document.createElement('button');
        pubBtn.className = 'version-btn';
        pubBtn.textContent = 'Publish';
        pubBtn.addEventListener('click', async () => {
          pubBtn.disabled = true;
          pubBtn.textContent = 'Publishing...';
          try {
            const resp = await chrome.runtime.sendMessage({
              action: 'publishVersion',
              versionId: v.id,
              versionLabel: v.label,
            });
            if (resp.error) throw new Error(resp.error);
            await navigator.clipboard.writeText(resp.url);
            pubBtn.textContent = 'Copied!';
            setTimeout(() => { pubBtn.textContent = 'Publish'; }, 2000);
          } catch (err) {
            console.error('Publish failed:', err);
            showToast(err.message || 'Publish failed');
            pubBtn.textContent = 'Publish';
          } finally {
            pubBtn.disabled = false;
          }
        });
        actions.appendChild(pubBtn);
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
    showSection(lastCaptureSection);
  } else {
    showSection('history');
    loadFullHistory();
  }
}

tabCapture.addEventListener('click', () => switchTab('capture'));
tabHistory.addEventListener('click', () => switchTab('history'));

// ── Full history view ─────────────────────────────────────────────────

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadFullHistory() {
  const resp = await chrome.runtime.sendMessage({ action: 'getSnapshotsWithVersions' });
  if (!resp.snapshots) return;

  historyList.innerHTML = '';

  if (!resp.snapshots.length) {
    historyEmpty.hidden = false;
    return;
  }
  historyEmpty.hidden = true;

  for (const s of resp.snapshots) {
    const card = document.createElement('div');
    card.className = 'history-snapshot-card';

    // Header: name + date
    const header = document.createElement('div');
    header.className = 'history-snapshot-header';

    const name = document.createElement('span');
    name.className = 'history-snapshot-name';
    name.textContent = s.snapshotName;

    const date = document.createElement('span');
    date.className = 'history-snapshot-date';
    date.textContent = formatDate(s.createdAt);

    header.appendChild(name);
    header.appendChild(date);
    card.appendChild(header);

    // Snapshot actions: Download + Copy link
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

      const copyBtn = document.createElement('button');
      copyBtn.className = 'version-btn';
      copyBtn.textContent = 'Copy link';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(s.blobUrl);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1500);
      });
      actions.appendChild(copyBtn);

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
          time.textContent = formatTime(v.createdAt);

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
              downloadFromUrl(v.blobUrl, `${v.label}.html`);
            });
            vActions.appendChild(vDl);

            const vCopy = document.createElement('button');
            vCopy.className = 'version-btn';
            vCopy.textContent = 'Copy link';
            vCopy.addEventListener('click', () => {
              navigator.clipboard.writeText(v.blobUrl);
              vCopy.textContent = 'Copied!';
              setTimeout(() => { vCopy.textContent = 'Copy link'; }, 1500);
            });
            vActions.appendChild(vCopy);

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

            const vPub = document.createElement('button');
            vPub.className = 'version-btn';
            vPub.textContent = 'Publish';
            vPub.addEventListener('click', async () => {
              vPub.disabled = true;
              vPub.textContent = 'Publishing...';
              try {
                const resp = await chrome.runtime.sendMessage({
                  action: 'publishVersion',
                  versionId: v.id,
                  versionLabel: v.label,
                });
                if (resp.error) throw new Error(resp.error);
                await navigator.clipboard.writeText(resp.url);
                vPub.textContent = 'Copied!';
                setTimeout(() => { vPub.textContent = 'Publish'; }, 2000);
              } catch (err) {
                console.error('Publish failed:', err);
                showToast(err.message || 'Publish failed');
                vPub.textContent = 'Publish';
              } finally {
                vPub.disabled = false;
              }
            });
            vActions.appendChild(vPub);
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

  // Download + copy link
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

  // Show remix section if backend configured
  remixSection.hidden = !hasVercelBackend;
  resetRemixState();

  showSection('result');
  await refreshVersionTree();
}

// ── Init ──────────────────────────────────────────────────────────────

async function init() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];
  currentSettings = settings;

  hasVercelBackend = !!(settings?.vercelUrl && settings?.vercelApiKey);
  hasRepoCreds = checkRepoCreds(settings);

  if (!isConfigured(settings)) {
    showSection('noConfig');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    showSection('noTab');
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

  showSection('captureForm');
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
  showSection('progress');
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
    showSection('error');
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

// ── Header buttons ────────────────────────────────────────────────────

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('open-options-card').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

copyPreviewBtn.addEventListener('click', () => {
  if (currentBlobUrl) navigator.clipboard.writeText(currentBlobUrl);
  copyPreviewBtn.textContent = 'Copied!';
  setTimeout(() => { copyPreviewBtn.textContent = 'Copy link'; }, 1500);
});

// Save to repo on demand
saveToRepoBtn.addEventListener('click', async () => {
  if (!currentSnapshotId) return;
  saveToRepoBtn.disabled = true;
  saveToRepoBtn.textContent = 'Saving...';

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
    saveToRepoBtn.textContent = 'Failed';
    setTimeout(() => {
      saveToRepoBtn.textContent = 'Save to repo';
      saveToRepoBtn.disabled = false;
    }, 2000);
  }
});

// New capture button — return to capture form
newCaptureBtn.addEventListener('click', () => {
  currentSnapshotId = null;
  clearRemixSourceFn();
  setBranchMode('new');
  showSection('captureForm');
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

function resetRemixState() {
  remixPrompt.value = '';
  remixBtn.disabled = false;
  remixStatus.hidden = true;
  remixStatus.textContent = '';
  remixStatus.className = 'remix-status';
  remixTurns.hidden = true;
  remixTurns.innerHTML = '';
  resetReferenceImages();
}

remixBtn.addEventListener('click', async () => {
  const prompt = remixPrompt.value.trim();
  if (!prompt) {
    remixPrompt.focus();
    return;
  }

  // Block while any image is still uploading
  if (referenceImages.some(x => x.uploading)) {
    showToast('Wait for reference images to finish uploading');
    return;
  }

  const uploadedRefs = referenceImages
    .filter(x => x.url)
    .map(x => ({ url: x.url, mediaType: x.mediaType, name: x.name }));

  const count = parseInt(remixCount.value, 10);
  remixBtn.disabled = true;
  remixStatus.hidden = false;
  remixStatus.className = 'remix-status';
  remixStatus.textContent = `Generating variation 1 of ${count}...`;

  try {
    const action = remixSourceVersionId ? 'remixFromVersion' : 'remixSnapshot';
    const msg = { action, prompt, count, snapshotId: currentSnapshotId };
    if (remixSourceVersionId) msg.versionId = remixSourceVersionId;
    if (uploadedRefs.length) msg.referenceImages = uploadedRefs;

    const response = await chrome.runtime.sendMessage(msg);

    if (response.error) {
      throw new Error(response.error);
    }

    remixStatus.textContent = 'Done!';

    // Clear attached references after a successful remix (no auto-carry-forward)
    resetReferenceImages();

    // Refresh version tree to show new versions
    await refreshVersionTree();
  } catch (err) {
    remixStatus.className = 'remix-status error';
    remixStatus.textContent = err.message || 'Remix failed';
  } finally {
    remixBtn.disabled = false;
  }
});

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
  const card = document.getElementById('remix-section');
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

// Listen for remix progress updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'remixProgress') {
    const costStr = msg.costUsd != null ? ` — $${msg.costUsd.toFixed(2)}` : '';
    remixStatus.textContent = msg.text + costStr;

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
  showSection('captureForm');
  refreshActiveTab();
});

// Refresh form when user switches tabs (only if capture form is visible)
chrome.tabs.onActivated.addListener(() => {
  if (!sections.captureForm.hidden) {
    refreshActiveTab();
  }
});

// Refresh when a page finishes loading in the active tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && !sections.captureForm.hidden) {
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
    init();
  }
});

init();
