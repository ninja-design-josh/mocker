const STORAGE_KEY = 'mocker_settings';

const form = document.getElementById('settings-form');
const testBtn = document.getElementById('test-btn');
const statusEl = document.getElementById('status');
const providerSelect = document.getElementById('provider');
const gitlabFields = document.getElementById('gitlab-fields');
const githubFields = document.getElementById('github-fields');

const fields = {
  provider: providerSelect,
  gitlabUrl: document.getElementById('gitlab-url'),
  accessToken: document.getElementById('access-token'),
  projectId: document.getElementById('project-id'),
  githubToken: document.getElementById('github-token'),
  githubOwner: document.getElementById('github-owner'),
  githubRepo: document.getElementById('github-repo'),
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

function updateProviderFields() {
  const provider = providerSelect.value;
  gitlabFields.hidden = provider !== 'gitlab';
  githubFields.hidden = provider !== 'github';
  hideStatus();
}

providerSelect.addEventListener('change', updateProviderFields);

function getFormValues() {
  return {
    provider: fields.provider.value,
    gitlabUrl: fields.gitlabUrl.value.replace(/\/+$/, ''),
    accessToken: fields.accessToken.value.trim(),
    projectId: fields.projectId.value.trim(),
    githubToken: fields.githubToken.value.trim(),
    githubOwner: fields.githubOwner.value.trim(),
    githubRepo: fields.githubRepo.value.trim(),
    branch: fields.branch.value.trim() || 'main',
    basePath: fields.basePath.value.trim() || 'snapshots',
  };
}

function validateForProvider(values) {
  if (values.provider === 'github') {
    if (!values.githubToken || !values.githubOwner || !values.githubRepo) {
      return 'Please fill in Token, Owner, and Repository.';
    }
  } else {
    if (!values.gitlabUrl || !values.accessToken || !values.projectId) {
      return 'Please fill in GitLab URL, Access Token, and Project ID.';
    }
  }
  return null;
}

async function loadSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];
  if (!settings) return;

  fields.provider.value = settings.provider || 'gitlab';
  fields.gitlabUrl.value = settings.gitlabUrl || '';
  fields.accessToken.value = settings.accessToken || '';
  fields.projectId.value = settings.projectId || '';
  fields.githubToken.value = settings.githubToken || '';
  fields.githubOwner.value = settings.githubOwner || '';
  fields.githubRepo.value = settings.githubRepo || '';
  fields.branch.value = settings.branch || 'main';
  fields.basePath.value = settings.basePath || 'snapshots';

  updateProviderFields();
}

async function saveSettings(values) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: values });
}

async function testConnection(values) {
  if (values.provider === 'github') {
    const resp = await fetch(
      `https://api.github.com/repos/${values.githubOwner}/${values.githubRepo}`,
      {
        headers: {
          'Authorization': `Bearer ${values.githubToken}`,
          'Accept': 'application/vnd.github+json',
        },
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      if (resp.status === 401) throw new Error('Invalid access token (401 Unauthorized)');
      if (resp.status === 404) throw new Error('Repository not found (404). Check the Owner and Repository name.');
      throw new Error(`GitHub responded with ${resp.status}: ${body}`);
    }

    return await resp.json();
  }

  // GitLab
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

  return await resp.json();
}

testBtn.addEventListener('click', async () => {
  const values = getFormValues();
  const error = validateForProvider(values);
  if (error) {
    showStatus(error, 'error');
    return;
  }

  testBtn.disabled = true;
  showStatus('Testing connection...', 'info');

  try {
    const project = await testConnection(values);
    if (values.provider === 'github') {
      showStatus(`Connected to "${project.full_name}"`, 'success');
    } else {
      showStatus(`Connected to "${project.name_with_namespace}" (ID: ${project.id})`, 'success');
    }
  } catch (err) {
    showStatus(`Connection failed: ${err.message}`, 'error');
  } finally {
    testBtn.disabled = false;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = getFormValues();

  const error = validateForProvider(values);
  if (error) {
    showStatus(error, 'error');
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
