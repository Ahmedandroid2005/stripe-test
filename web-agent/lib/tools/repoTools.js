'use strict';

// Module: Repo discovery & switching. Lets the model see what the GitHub
// token can access and change the active project mid-conversation, instead
// of requiring the user to type owner/repo into the settings panel every
// time they want to work on something else.

const { listRepos, repoExists } = require('../github');

const schemas = [
  {
    name: 'list_repos',
    description:
      "List GitHub repositories accessible to the configured token (the user's own repos and anything they " +
      'collaborate on). Use this to find a project when the user names it without giving an exact owner/repo, ' +
      'or when they ask what repos you can see.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_repo',
    description:
      'Switch the active repository/branch that all file and command tools operate on for the rest of this ' +
      'conversation. Call this when the user asks to work on a different project than the one currently ' +
      'configured (use list_repos first if you need to find the exact name). Verifies the repo is accessible ' +
      'before switching. Has no side effects on GitHub itself, so it does not require confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        branch: { type: 'string', description: 'Optional; defaults to "code-agent" if omitted.' },
      },
      required: ['owner', 'repo'],
    },
  },
];

async function listReposTool(input, ctx) {
  const repos = await listRepos(ctx.token);
  if (!repos.length) return 'No repositories are accessible to this token.';
  return repos
    .map(
      (r) =>
        `${r.fullName}${r.private ? ' (private)' : ''} — default branch "${r.defaultBranch}"` +
        (r.description ? `: ${r.description}` : '')
    )
    .join('\n');
}

async function switchRepoTool(input, ctx) {
  const owner = String(input.owner || '').trim();
  const repo = String(input.repo || '').trim();
  const branch = String(input.branch || 'code-agent').trim();

  if (!owner || !repo) {
    const err = new Error('switch_repo requires both "owner" and "repo".');
    err.status = 400;
    throw err;
  }

  const accessible = await repoExists(ctx.token, owner, repo);
  if (!accessible) {
    return (
      `Cannot access ${owner}/${repo} — either it does not exist or the configured GitHub token does not have ` +
      'permission. Ask the user to check the repo name or grant the token access, then try again.'
    );
  }

  // Mutates the shared ctx object so every tool call for the rest of this
  // request (and, via activeRepo in the response, every later request in
  // this conversation) targets the new repo.
  ctx.owner = owner;
  ctx.repo = repo;
  ctx.branch = branch;

  return `Switched the active repository to ${owner}/${repo} (branch "${branch}"). All file/command tools now target it.`;
}

module.exports = {
  schemas,
  execute: { list_repos: listReposTool, switch_repo: switchRepoTool },
};
