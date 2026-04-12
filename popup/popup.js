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
const saveBtn = document.getElementById('save-btn');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const resultUrl = document.getElementById('result-url');
const errorText = document.getElementById('error-text');

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

async function init() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];

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
  branchNameInput.value = generateBranchName(tab.url);
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
    showSection('result');
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

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('copy-path').addEventListener('click', () => {
  navigator.clipboard.writeText(resultUrl.textContent);
  document.getElementById('copy-path').textContent = 'Copied!';
  setTimeout(() => {
    document.getElementById('copy-path').textContent = 'Copy URL';
  }, 1500);
});

document.getElementById('new-snapshot').addEventListener('click', () => {
  showSection('captureForm');
});

document.getElementById('retry-btn').addEventListener('click', () => {
  showSection('captureForm');
});

init();
