'use strict';

// Module: Testing / Verification (runs commands — build, lint, test — in a
// throwaway sandbox checked out fresh from GitHub each call). This is also
// where a future DevOps module would plug in additional executors (see
// ../../ARCHITECTURE.md) without touching fileTools.js.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { getFile, getTree } = require('../github');
const { BINARY_EXT } = require('./fileTools');
const { isIgnoredPath } = require('./pathSafety');

const MAX_OUTPUT_CHARS = 20000;

const schemas = [
  {
    name: 'run_command',
    description:
      'Run a shell command against a fresh checkout of the current branch in an isolated, throwaway sandbox. ' +
      'The checkout is fetched fresh at the start of every call and discarded afterward — nothing persists ' +
      'between separate run_command calls, and anything the command writes is NOT saved back to the repo. ' +
      'Use it to run tests/lints/builds, not to save changes (use write_file/edit_file for that). ' +
      'Combine setup and action into one command, e.g. "npm install && npm test". Requires user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['command'],
    },
  },
];

const HARD_BLOCKLIST = [
  /\brm\s+-rf\s+\/(\s|$)/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
  />\s*\/dev\/sd[a-z]/,
];

async function runCommandTool(input, ctx) {
  const command = String(input.command || '');
  if (HARD_BLOCKLIST.some((re) => re.test(command))) {
    return 'This command matches a hard-blocked destructive pattern and was not run.';
  }

  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-code-'));
  try {
    await checkoutTreeToDisk(ctx, workdir);
    const { stdout, stderr, exitCode } = await runShell(command, workdir, input.timeoutMs);
    const combined = `exit code: ${exitCode}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`;
    return combined.length > MAX_OUTPUT_CHARS ? combined.slice(0, MAX_OUTPUT_CHARS) + '\n[...truncated]' : combined;
  } finally {
    await fs.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function checkoutTreeToDisk(ctx, workdir) {
  const entries = await getTree(ctx.token, ctx.owner, ctx.repo, ctx.branch);
  const textLike = entries
    .filter((e) => e.size < 500000 && !BINARY_EXT.test(e.path) && !isIgnoredPath(e.path))
    .slice(0, 300);
  for (const entry of textLike) {
    const { content } = await getFile(ctx.token, ctx.owner, ctx.repo, ctx.branch, entry.path);
    const dest = path.join(workdir, entry.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, 'utf-8');
  }
}

function runShell(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', command],
      { cwd, timeout: Math.min(Number(timeoutMs) || 45000, 50000), maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || (error && !stdout ? error.message : ''),
          exitCode: error ? (error.code ?? 1) : 0,
        });
      }
    );
  });
}

module.exports = {
  schemas,
  execute: { run_command: runCommandTool },
};
