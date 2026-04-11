const STORAGE_KEY = 'mocker_settings';

const form = document.getElementById('settings-form');
const testBtn = document.getElementById('test-btn');
const statusEl = document.getElementById('status');

const fields = {
  gitlabUrl: document.getElementById('gitlab-url'),
  accessToken: document.getElementById('access-token'),
  projectId: document.getElementById('project-id'),
  branch: document.getElementById('branch'),
  basePath: document.getElementById('base-path'),
};

function showStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.hidden = false;
}

function hideStatus() {
  statusEl.hidden = true;
}

function getFormValues() {
  return {
    gitlabUrl: fields.gitlabUrl.value.replace(/\/+$/, ''),
    accessToken: fields.accessToken.value.trim(),
    projectId: fields.projectId.value.trim(),
    branch: fields.branch.value.trim() || 'main',
    basePath: fields.basePath.value.trim() || 'snapshots',
  };
}

async function loadSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];
  if (!settings) return;

  fields.gitlabUrl.value = settings.gitlabUrl || '';
  fields.accessToken.value = settings.accessToken || '';
  fields.projectId.value = settings.projectId || '';
  fields.branch.value = settings.branch || 'main';
  fields.basePath.value = settings.basePath || 'snapshots';
}

async function saveSettings(values) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: values });
}

async function testConnection(values) {
  const projectPath = encodeURIComponent(values.projectId);
  const url = `${values.gitlabUrl}/api/v4/projects/${projectPath}`;

  const resp = await fetch(url, {
    headers: { 'PRIVATE-TOKEN': values.accessToken },
  });

  if (!resp.ok) {
    const body = await resp.text();
    if (resp.status === 401) throw new Error('Invalid access token (401 Unauthorized)');
    if (resp.status === 404) throw new Error('Project not found (404). Check the Project ID or path.');
    throw new Error(`GitLab responded with ${resp.status}: ${body}`);
  }

  const project = await resp.json();
  return project;
}

testBtn.addEventListener('click', async () => {
  const values = getFormValues();
  if (!values.gitlabUrl || !values.accessToken || !values.projectId) {
    showStatus('Please fill in GitLab URL, Access Token, and Project ID.', 'error');
    return;
  }

  testBtn.disabled = true;
  showStatus('Testing connection...', 'info');

  try {
    const project = await testConnection(values);
    showStatus(`Connected to "${project.name_with_namespace}" (ID: ${project.id})`, 'success');
  } catch (err) {
    showStatus(`Connection failed: ${err.message}`, 'error');
  } finally {
    testBtn.disabled = false;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = getFormValues();

  if (!values.gitlabUrl || !values.accessToken || !values.projectId) {
    showStatus('Please fill in all required fields.', 'error');
    return;
  }

  try {
    await saveSettings(values);
    showStatus('Settings saved.', 'success');
  } catch (err) {
    showStatus(`Failed to save: ${err.message}`, 'error');
  }
});

loadSettings();
