'use strict';

// Module: Project Analysis & Code Generation (reads, searches, and writes
// the repository via GitHub's API — see ../../ARCHITECTURE.md for how this
// fits into the rest of the system).

const { getFile, putFile, getTree, ensureBranch } = require('../github');
const { validateRelPath, simpleGlobToRegExp } = require('./pathSafety');

const MAX_CHARS = 60000;
const BINARY_EXT = /\.(png|jpe?g|gif|ico|webp|pdf|zip|gz|tar|mp4|mp3|woff2?|ttf|eot|bin|exe|lock)$/i;

const schemas = [
  {
    name: 'read_file',
    description: 'Read a text file from the repository at the configured branch.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to repo root.' } },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: "List files in the repository, optionally filtered by a glob pattern (e.g. 'src/**/*.js').",
    input_schema: {
      type: 'object',
      properties: { pattern: { type: 'string' } },
    },
  },
  {
    name: 'search_code',
    description: 'Search file contents across the repository for a literal string or regular expression.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        glob: { type: 'string' },
        isRegex: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a file. Commits directly to the configured branch as a real git commit, automatically creating that branch first if it does not exist yet — no separate branch-creation step is needed. Requires user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace one exact, unique occurrence of oldText with newText in an existing file, then commit (automatically creating the configured branch first if it does not exist yet). Requires user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
      },
      required: ['path', 'oldText', 'newText'],
    },
  },
];

async function readFileTool(input, ctx) {
  const relPath = validateRelPath(input.path);
  const { content } = await getFile(ctx.token, ctx.owner, ctx.repo, ctx.branch, relPath);
  const truncated = content.length > MAX_CHARS;
  const body = truncated ? content.slice(0, MAX_CHARS) : content;
  const numbered = body
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(5, ' ')}| ${line}`)
    .join('\n');
  return truncated ? `${numbered}\n\n[...truncated]` : numbered;
}

async function listFilesTool(input, ctx) {
  const entries = await getTree(ctx.token, ctx.owner, ctx.repo, ctx.branch);
  const pattern = typeof input.pattern === 'string' && input.pattern ? input.pattern : '**/*';
  const re = simpleGlobToRegExp(pattern);
  const matched = entries.map((e) => e.path).filter((p) => re.test(p));
  if (matched.length === 0) return 'No files matched.';
  const capped = matched.slice(0, 500);
  return capped.join('\n') + (matched.length > 500 ? `\n\n[...${matched.length - 500} more]` : '');
}

async function searchCodeTool(input, ctx) {
  const entries = await getTree(ctx.token, ctx.owner, ctx.repo, ctx.branch);
  const glob = typeof input.glob === 'string' && input.glob ? input.glob : '**/*';
  const re = simpleGlobToRegExp(glob);
  const candidates = entries
    .filter((e) => re.test(e.path) && e.size < 300000 && !BINARY_EXT.test(e.path))
    .slice(0, 200);
  const matcher = input.isRegex ? new RegExp(input.query) : null;

  const results = [];
  for (const entry of candidates) {
    if (results.length >= 200) break;
    let content;
    try {
      ({ content } = await getFile(ctx.token, ctx.owner, ctx.repo, ctx.branch, entry.path));
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const hit = matcher ? matcher.test(lines[i]) : lines[i].includes(input.query);
      if (hit) {
        results.push(`${entry.path}:${i + 1}: ${lines[i].trim()}`);
        if (results.length >= 200) break;
      }
    }
  }
  return results.length ? results.join('\n') : 'No matches found.';
}

// Split into preview (read-only, safe to call before confirmation) and the
// real execute (only called after the user approves).

async function previewWriteFile(input, ctx) {
  const relPath = validateRelPath(input.path);
  let oldContent = '';
  let sha = null;
  try {
    const existing = await getFile(ctx.token, ctx.owner, ctx.repo, ctx.branch, relPath);
    oldContent = existing.content;
    sha = existing.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  return { path: relPath, oldContent, newContent: String(input.content ?? ''), sha };
}

async function writeFileTool(input, ctx) {
  const { path: relPath, newContent, sha } = await previewWriteFile(input, ctx);
  await ensureBranch(ctx.token, ctx.owner, ctx.repo, ctx.branch, ctx.baseBranch);
  await putFile(ctx.token, ctx.owner, ctx.repo, ctx.branch, relPath, newContent, `Nexus Code: write ${relPath}`, sha);
  return `Committed ${relPath} to branch "${ctx.branch}".`;
}

async function previewEditFile(input, ctx) {
  const relPath = validateRelPath(input.path);
  const { content: original, sha } = await getFile(ctx.token, ctx.owner, ctx.repo, ctx.branch, relPath);
  const oldText = String(input.oldText ?? '');
  const occurrences = oldText ? original.split(oldText).length - 1 : 0;

  if (occurrences !== 1) {
    return {
      path: relPath,
      oldContent: original,
      newContent: original,
      sha,
      error:
        occurrences === 0
          ? `oldText not found in ${relPath}. Re-read the file and try again with an exact match.`
          : `oldText matches ${occurrences} locations in ${relPath}; include more context so it is unique.`,
    };
  }

  const updated = original.replace(oldText, String(input.newText ?? ''));
  return { path: relPath, oldContent: original, newContent: updated, sha };
}

async function editFileTool(input, ctx) {
  const preview = await previewEditFile(input, ctx);
  if (preview.error) return preview.error;
  await ensureBranch(ctx.token, ctx.owner, ctx.repo, ctx.branch, ctx.baseBranch);
  await putFile(
    ctx.token,
    ctx.owner,
    ctx.repo,
    ctx.branch,
    preview.path,
    preview.newContent,
    `Nexus Code: edit ${preview.path}`,
    preview.sha
  );
  return `Committed edit to ${preview.path} on branch "${ctx.branch}".`;
}

module.exports = {
  schemas,
  execute: {
    read_file: readFileTool,
    list_files: listFilesTool,
    search_code: searchCodeTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
  },
  previewWriteFile,
  previewEditFile,
  BINARY_EXT,
};
