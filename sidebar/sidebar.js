const STORAGE_KEY = 'mocker_settings';

const sections = {
  noConfig: document.getElementById('no-config'),
  captureForm: document.getElementById('capture-form'),
  progress: document.getElementById('progress'),
  result: document.getElementById('result'),
  error: document.getElementById('error'),
};

const currentUrlEl = document.getElementById('current-url');
const snapshotNameInput = document.getElementById('snapshot-name');
const branchNameInput = document.getElementById('branch-name');
const branchHint = document.getElementById('branch-hint');
const branchToggleBtns = document.querySelectorAll('.toggle-btn');

let branchMode = 'new';
const saveBtn = document.getElementById('save-btn');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const resultUrl = document.getElementById('result-url');
const errorText = document.getElementById('error-text');
const previewRow = document.getElementById('preview-row');
const previewUrl = document.getElementById('preview-url');
const copyPreviewBtn = document.getElementById('copy-preview');
const remixSection = document.getElementById('remix-section');
const remixPrompt = document.getElementById('remix-prompt');
const remixCount = document.getElementById('remix-count');
const remixBtn = document.getElementById('remix-btn');
const remixStatus = document.getElementById('remix-status');
const remixResults = document.getElementById('remix-results');

function showSection(name) {
  Object.values(sections).forEach(el => el.hidden = true);
  sections[name].hidden = false;
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

function setProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

function isConfigured(settings) {
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

let hasClaudeKey = false;
let hasVercelBackend = false;

/**
 * Refresh the form fields based on the currently active tab.
 */
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

async function init() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];

  hasClaudeKey = !!(settings?.claudeApiKey);
  hasVercelBackend = !!(settings?.vercelUrl && settings?.vercelApiKey);

  if (!isConfigured(settings)) {
    showSection('noConfig');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    showSection('noConfig');
    return;
  }

  currentUrlEl.textContent = tab.url;
  currentUrlEl.title = tab.url;
  snapshotNameInput.value = slugFromUrl(tab.url);
  if (branchMode === 'new') {
    branchNameInput.value = generateBranchName(tab.url);
  }
  showSection('captureForm');
}

saveBtn.addEventListener('click', async () => {
  const name = snapshotNameInput.value.trim();
  if (!name) {
    snapshotNameInput.focus();
    return;
  }

  const branch = branchNameInput.value.trim();
  if (!branch) {
    branchNameInput.focus();
    return;
  }

  const slug = name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const branchSlug = branch.replace(/[^a-z0-9/_-]+/gi, '-').toLowerCase();
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

    document.getElementById('result-branch').textContent = response.branch;
    resultUrl.href = response.fileUrl;
    resultUrl.textContent = response.fileUrl;
    if (response.previewUrl) {
      previewUrl.href = response.previewUrl;
      previewUrl.textContent = 'Open preview';
      previewRow.hidden = false;
    } else {
      previewRow.hidden = true;
    }
    showSection('result');
    const canRemix = hasClaudeKey || hasVercelBackend;
    remixSection.hidden = !canRemix;
    updateRemixIndicator();
    resetRemixState();
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

// Header gear icon
document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Card settings button (no-config section)
document.getElementById('open-options-card').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('copy-path').addEventListener('click', () => {
  navigator.clipboard.writeText(resultUrl.textContent);
  document.getElementById('copy-path').textContent = 'Copied!';
  setTimeout(() => {
    document.getElementById('copy-path').textContent = 'Copy URL';
  }, 1500);
});

copyPreviewBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(previewUrl.href);
  copyPreviewBtn.textContent = 'Copied!';
  setTimeout(() => { copyPreviewBtn.textContent = 'Copy link'; }, 1500);
});

function updateRemixIndicator() {
  const el = document.getElementById('remix-backend-indicator');
  if (!el) return;
  if (hasVercelBackend) {
    el.textContent = 'Using Vercel backend';
    el.className = 'remix-indicator vercel';
  } else if (hasClaudeKey) {
    el.textContent = 'Using direct API';
    el.className = 'remix-indicator direct';
  } else {
    el.textContent = '';
  }
}

function resetRemixState() {
  remixPrompt.value = '';
  remixBtn.disabled = false;
  remixStatus.hidden = true;
  remixStatus.textContent = '';
  remixStatus.className = 'remix-status';
  remixResults.hidden = true;
  remixResults.innerHTML = '';
}

document.getElementById('new-snapshot').addEventListener('click', () => {
  resetRemixState();
  remixSection.hidden = true;
  setBranchMode('new');
  showSection('captureForm');
  refreshActiveTab();
});

document.getElementById('retry-btn').addEventListener('click', () => {
  setBranchMode('new');
  showSection('captureForm');
  refreshActiveTab();
});

remixBtn.addEventListener('click', async () => {
  const prompt = remixPrompt.value.trim();
  if (!prompt) {
    remixPrompt.focus();
    return;
  }

  const count = parseInt(remixCount.value, 10);
  remixBtn.disabled = true;
  remixResults.hidden = true;
  remixResults.innerHTML = '';
  remixStatus.hidden = false;
  remixStatus.className = 'remix-status';
  remixStatus.textContent = `Generating variation 1 of ${count}...`;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'remixSnapshot',
      prompt,
      count,
    });

    if (response.error) {
      throw new Error(response.error);
    }

    remixStatus.textContent = 'Done!';
    remixResults.hidden = false;
    for (const r of response.results) {
      const row = document.createElement('div');
      row.className = 'remix-result-row';

      const a = document.createElement('a');
      a.href = r.fileUrl;
      a.target = '_blank';
      a.textContent = r.fileName;
      a.title = r.fileUrl;

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-copy';
      copyBtn.textContent = 'Copy link';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(r.fileUrl).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1500);
        });
      });

      row.appendChild(a);
      row.appendChild(copyBtn);
      remixResults.appendChild(row);
    }
  } catch (err) {
    remixStatus.className = 'remix-status error';
    remixStatus.textContent = err.message || 'Remix failed';
  } finally {
    remixBtn.disabled = false;
  }
});

// Listen for remix progress updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'remixProgress') {
    remixStatus.textContent = msg.text;
  }
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

// Re-run init when settings change (sidebar stays open, unlike the old popup)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) {
    init();
  }
});

init();
