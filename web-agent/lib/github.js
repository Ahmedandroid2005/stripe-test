'use strict';

const API_BASE = 'https://api.github.com';

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'code-agent-web',
  };
}

function encodeGitPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function ghFetch(token, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...ghHeaders(token), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`GitHub API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function getFile(token, owner, repo, branch, path) {
  const data = await ghFetch(
    token,
    `/repos/${owner}/${repo}/contents/${encodeGitPath(path)}?ref=${encodeURIComponent(branch)}`
  );
  if (Array.isArray(data)) {
    const err = new Error(`"${path}" is a directory, not a file.`);
    err.status = 400;
    throw err;
  }
  const content = Buffer.from(data.content, data.encoding || 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

async function putFile(token, owner, repo, branch, path, content, message, existingSha) {
  const body = {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch,
  };
  if (existingSha) body.sha = existingSha;
  return ghFetch(token, `/repos/${owner}/${repo}/contents/${encodeGitPath(path)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

async function getTree(token, owner, repo, branch) {
  const branchInfo = await ghFetch(token, `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  const treeSha = branchInfo.commit.commit.tree.sha;
  const tree = await ghFetch(token, `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`);
  return (tree.tree || []).filter((entry) => entry.type === 'blob');
}

/** Creates `branch` from `baseBranch` if it doesn't already exist. No-op otherwise. */
async function ensureBranch(token, owner, repo, branch, baseBranch) {
  try {
    await ghFetch(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    return;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const base = await ghFetch(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  await ghFetch(token, `/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }),
  });
}

/** Lists repositories the token can access (owned + collaborator), newest-updated first. */
async function listRepos(token) {
  const repos = await ghFetch(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator');
  return repos.map((r) => ({
    fullName: r.full_name,
    private: r.private,
    description: r.description || '',
    updatedAt: r.updated_at,
    defaultBranch: r.default_branch,
  }));
}

/** True if the token can read this repo, false on 404/403, throws on any other failure. */
async function repoExists(token, owner, repo) {
  try {
    await ghFetch(token, `/repos/${owner}/${repo}`);
    return true;
  } catch (err) {
    if (err.status === 404 || err.status === 403) return false;
    throw err;
  }
}

module.exports = { getFile, putFile, getTree, ensureBranch, listRepos, repoExists };
