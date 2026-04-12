const STORAGE_KEY = 'mocker_settings';
const BASE_URL = 'https://api.github.com';

async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];
  if (!settings || !settings.githubToken || !settings.githubOwner || !settings.githubRepo) {
    throw new Error('GitHub settings not configured. Open extension options to set up.');
  }
  return settings;
}

/**
 * Create a new branch from the configured base branch.
 * If the branch already exists, this is a no-op.
 */
async function createBranch(settings, branchName) {
  const baseBranch = settings.branch || 'main';
  const headers = {
    'Authorization': `Bearer ${settings.githubToken}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // Get SHA of the base branch
  const refResp = await fetch(
    `${BASE_URL}/repos/${settings.githubOwner}/${settings.githubRepo}/git/ref/heads/${baseBranch}`,
    { headers }
  );

  if (!refResp.ok) {
    if (refResp.status === 401) throw new Error('Invalid GitHub token (401).');
    if (refResp.status === 404) throw new Error('GitHub repo or base branch not found (404).');
    const body = await refResp.text();
    throw new Error(`Failed to get base branch (${refResp.status}): ${body}`);
  }

  const refData = await refResp.json();
  const sha = refData.object.sha;

  // Create the new branch ref
  const createResp = await fetch(
    `${BASE_URL}/repos/${settings.githubOwner}/${settings.githubRepo}/git/refs`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha,
      }),
    }
  );

  if (!createResp.ok) {
    const body = await createResp.text();
    // 422 "Reference already exists" is fine
    if (createResp.status === 422 && body.includes('Reference already exists')) {
      return;
    }
    if (createResp.status === 401) throw new Error('Invalid GitHub token (401).');
    throw new Error(`Failed to create branch (${createResp.status}): ${body}`);
  }
}

/**
 * Commit a snapshot file to the GitHub repo on a new branch.
 *
 * @param {string} snapshotName - Folder name for the snapshot
 * @param {string} branchName - New branch to create and commit to
 * @param {string} htmlContent - The full self-contained HTML
 * @returns {{ filePath: string, branch: string, commitUrl: string }}
 */
export async function commitSnapshot(snapshotName, branchName, htmlContent, fileName = 'original.html') {
  const settings = await getSettings();
  const basePath = settings.basePath || 'snapshots';
  const filePath = `${basePath}/${snapshotName}/${fileName}`;

  const headers = {
    'Authorization': `Bearer ${settings.githubToken}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // Create the new branch from the base branch
  await createBranch(settings, branchName);

  // Check if file already exists on this branch to get its SHA (needed for updates)
  let existingSha = null;
  try {
    const checkResp = await fetch(
      `${BASE_URL}/repos/${settings.githubOwner}/${settings.githubRepo}/contents/${filePath}?ref=${encodeURIComponent(branchName)}`,
      { headers }
    );
    if (checkResp.ok) {
      const fileData = await checkResp.json();
      existingSha = fileData.sha;
    }
  } catch {
    // File doesn't exist, will create
  }

  // Commit the file using the Contents API
  const body = {
    message: `Mocker: ${fileName === 'original.html' ? 'snapshot' : 'remix'} of ${snapshotName} (${fileName})`,
    branch: branchName,
    content: btoa(unescape(encodeURIComponent(htmlContent))),
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const resp = await fetch(
    `${BASE_URL}/repos/${settings.githubOwner}/${settings.githubRepo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const respBody = await resp.text();
    if (resp.status === 401) throw new Error('Invalid GitHub token (401).');
    if (resp.status === 404) throw new Error('GitHub repository not found (404).');
    throw new Error(`GitHub commit failed (${resp.status}): ${respBody}`);
  }

  const data = await resp.json();
  return {
    filePath,
    branch: branchName,
    commitUrl: data.commit?.html_url || '',
    fileUrl: `https://github.com/${settings.githubOwner}/${settings.githubRepo}/blob/${branchName}/${filePath}`,
  };
}
