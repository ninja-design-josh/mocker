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
 * Commit a snapshot file to the GitLab repo.
 * Uses the Commits API to create or update a file.
 *
 * @param {string} snapshotName - Folder name for the snapshot
 * @param {string} htmlContent - The full self-contained HTML
 * @returns {{ filePath: string, commitUrl: string }}
 */
export async function commitSnapshot(snapshotName, htmlContent) {
  const settings = await getSettings();
  const projectPath = encodeURIComponent(settings.projectId);
  const basePath = settings.basePath || 'snapshots';
  const branch = settings.branch || 'main';
  const filePath = `${basePath}/${snapshotName}/original.html`;

  // First, check if file already exists to decide create vs update
  let action = 'create';
  try {
    const checkUrl = `${settings.gitlabUrl}/api/v4/projects/${projectPath}/repository/files/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`;
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
      branch,
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
  return {
    filePath,
    commitUrl: commit.web_url || '',
  };
}
