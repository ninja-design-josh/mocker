const STORAGE_KEY = 'mocker_settings';

async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];
  if (!settings || !settings.gitlabUrl || !settings.accessToken || !settings.projectId) {
    throw new Error('GitLab settings not configured. Open extension options to set up.');
  }
  return settings;
}

/**
 * Create a new branch from the configured base branch.
 * If the branch already exists, this is a no-op.
 */
async function createBranch(settings, branchName) {
  const projectPath = encodeURIComponent(settings.projectId);
  const baseBranch = settings.branch || 'main';

  const resp = await fetch(`${settings.gitlabUrl}/api/v4/projects/${projectPath}/repository/branches`, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': settings.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      branch: branchName,
      ref: baseBranch,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    // 400 with "already exists" is fine — branch was already created
    if (resp.status === 400 && body.includes('already exists')) {
      return;
    }
    if (resp.status === 401) throw new Error('Invalid GitLab token (401).');
    if (resp.status === 404) throw new Error('GitLab project or base branch not found (404).');
    throw new Error(`Failed to create branch (${resp.status}): ${body}`);
  }
}

/**
 * Commit a snapshot file to the GitLab repo on a new branch.
 *
 * @param {string} snapshotName - Folder name for the snapshot
 * @param {string} branchName - New branch to create and commit to
 * @param {string} htmlContent - The full self-contained HTML
 * @returns {{ filePath: string, branch: string, commitUrl: string }}
 */
export async function commitSnapshot(snapshotName, branchName, htmlContent) {
  const settings = await getSettings();
  const projectPath = encodeURIComponent(settings.projectId);
  const basePath = settings.basePath || 'snapshots';
  const filePath = `${basePath}/${snapshotName}/original.html`;

  // Create the new branch from the base branch
  await createBranch(settings, branchName);

  // Check if file already exists on this branch to decide create vs update
  let action = 'create';
  try {
    const checkUrl = `${settings.gitlabUrl}/api/v4/projects/${projectPath}/repository/files/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branchName)}`;
    const checkResp = await fetch(checkUrl, {
      headers: { 'PRIVATE-TOKEN': settings.accessToken },
    });
    if (checkResp.ok) {
      action = 'update';
    }
  } catch {
    // File doesn't exist, will create
  }

  const commitUrl = `${settings.gitlabUrl}/api/v4/projects/${projectPath}/repository/commits`;

  const resp = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': settings.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      branch: branchName,
      commit_message: `Mocker: snapshot of ${snapshotName}`,
      actions: [
        {
          action,
          file_path: filePath,
          content: htmlContent,
          encoding: 'text',
        },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    if (resp.status === 401) throw new Error('Invalid GitLab token (401).');
    if (resp.status === 404) throw new Error('GitLab project not found (404).');
    throw new Error(`GitLab commit failed (${resp.status}): ${body}`);
  }

  const commit = await resp.json();
  const projectBase = commit.web_url ? commit.web_url.replace(/\/-\/commit\/.*$/, '') : '';
  return {
    filePath,
    branch: branchName,
    commitUrl: commit.web_url || '',
    fileUrl: projectBase ? `${projectBase}/-/blob/${branchName}/${filePath}` : '',
  };
}
