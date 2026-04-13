const STORAGE_KEY = 'mocker_settings';

const form = document.getElementById('settings-form');
const testBtn = document.getElementById('test-btn');
const testBackendBtn = document.getElementById('test-backend-btn');
const createRepoBtn = document.getElementById('create-repo-btn');
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
  repoVisibility: document.getElementById('repo-visibility'),
  githubPages: document.getElementById('github-pages'),
  remixModel: document.getElementById('remix-model'),
  vercelUrl: document.getElementById('vercel-url'),
  vercelApiKey: document.getElementById('vercel-api-key'),
  alsoCommitToRepo: document.getElementById('also-commit-to-repo'),
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
    remixModel: fields.remixModel.value,
    vercelUrl: fields.vercelUrl.value.replace(/\/+$/, ''),
    vercelApiKey: fields.vercelApiKey.value.trim(),
    alsoCommitToRepo: fields.alsoCommitToRepo.checked,
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
  fields.remixModel.value = settings.remixModel || 'claude-sonnet-4-6';
  fields.vercelUrl.value = settings.vercelUrl || '';
  fields.vercelApiKey.value = settings.vercelApiKey || '';
  fields.alsoCommitToRepo.checked = !!settings.alsoCommitToRepo;

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

async function createRepository(values) {
  const visibility = fields.repoVisibility.value;

  if (values.provider === 'github') {
    const headers = {
      'Authorization': `Bearer ${values.githubToken}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
    const body = {
      name: values.githubRepo,
      private: visibility === 'private',
      auto_init: true,
    };

    // Try org endpoint first, fall back to user endpoint
    let resp = await fetch(`https://api.github.com/orgs/${values.githubOwner}/repos`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (resp.status === 404) {
      resp = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    }

    if (!resp.ok) {
      if (resp.status === 401) throw new Error('Invalid access token (401 Unauthorized)');
      if (resp.status === 422) throw new Error('Repository already exists or invalid name (422)');
      const text = await resp.text();
      throw new Error(`GitHub responded with ${resp.status}: ${text}`);
    }

    const repo = await resp.json();
    const result = { url: repo.html_url, name: repo.full_name };

    // Enable GitHub Pages if checked and repo is public
    if (fields.githubPages.checked && visibility === 'public') {
      const pagesResp = await fetch(
        `https://api.github.com/repos/${values.githubOwner}/${values.githubRepo}/pages`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source: { branch: values.branch, path: '/' },
          }),
        }
      );
      if (pagesResp.ok) {
        const pages = await pagesResp.json();
        result.pagesUrl = pages.html_url;
      }
    }

    return result;
  }

  // GitLab
  let repoName = values.projectId;
  const body = {
    name: repoName.includes('/') ? repoName.split('/').pop() : repoName,
    visibility,
    initialize_with_readme: true,
  };

  // If projectId contains a namespace path, look up the namespace ID
  if (repoName.includes('/')) {
    const namespacePath = repoName.split('/').slice(0, -1).join('/');
    const nsResp = await fetch(
      `${values.gitlabUrl}/api/v4/namespaces?search=${encodeURIComponent(namespacePath)}`,
      { headers: { 'PRIVATE-TOKEN': values.accessToken } }
    );
    if (nsResp.ok) {
      const namespaces = await nsResp.json();
      const ns = namespaces.find(n => n.full_path === namespacePath);
      if (ns) body.namespace_id = ns.id;
    }
  }

  const resp = await fetch(`${values.gitlabUrl}/api/v4/projects`, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': values.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    if (resp.status === 401) throw new Error('Invalid access token (401 Unauthorized)');
    if (resp.status === 400) throw new Error('Repository already exists or invalid name (400)');
    const text = await resp.text();
    throw new Error(`GitLab responded with ${resp.status}: ${text}`);
  }

  const project = await resp.json();
  return { url: project.web_url, name: project.name_with_namespace, id: project.id };
}

createRepoBtn.addEventListener('click', async () => {
  const values = getFormValues();

  if (values.provider === 'github') {
    if (!values.githubToken || !values.githubOwner || !values.githubRepo) {
      showStatus('Please fill in Token, Owner, and Repository name.', 'error');
      return;
    }
  } else {
    if (!values.gitlabUrl || !values.accessToken || !values.projectId) {
      showStatus('Please fill in GitLab URL, Access Token, and Project ID/name.', 'error');
      return;
    }
  }

  createRepoBtn.disabled = true;
  showStatus('Creating repository...', 'info');

  try {
    const result = await createRepository(values);

    if (values.provider === 'gitlab') {
      fields.projectId.value = result.id;
    }

    let msg = `Repository created: ${result.name} — ${result.url}`;
    if (result.pagesUrl) {
      msg += ` | Pages: ${result.pagesUrl}`;
    }
    showStatus(msg, 'success');
  } catch (err) {
    showStatus(`Failed to create repository: ${err.message}`, 'error');
  } finally {
    createRepoBtn.disabled = false;
  }
});

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

testBackendBtn.addEventListener('click', async () => {
  const values = getFormValues();
  if (!values.vercelUrl || !values.vercelApiKey) {
    showStatus('Please fill in Backend URL and Backend API Key.', 'error');
    return;
  }

  testBackendBtn.disabled = true;
  showStatus('Testing backend connection...', 'info');

  try {
    const resp = await fetch(`${values.vercelUrl}/api/health`, {
      headers: { 'Authorization': `Bearer ${values.vercelApiKey}` },
    });

    if (!resp.ok) {
      throw new Error(`Backend responded with ${resp.status}`);
    }

    const data = await resp.json();
    showStatus(`Backend connected (${data.timestamp})`, 'success');
  } catch (err) {
    showStatus(`Backend connection failed: ${err.message}`, 'error');
  } finally {
    testBackendBtn.disabled = false;
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
