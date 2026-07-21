'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { checkAuth } = require('../lib/auth');
const { toolSchemas, execute, isMutating, previewWriteFile, previewEditFile } = require('../lib/tools');
const { ensureBranch } = require('../lib/github');
const buildSystemPrompt = require('../lib/systemPrompt');

// The V1 workflow (analyze -> plan -> implement -> self-review -> verify)
// chains more model/tool round-trips per request than a simple Q&A turn,
// so this has more headroom than a basic chat loop needs — still well
// within Vercel's 60s function limit since safe (auto-executed) tool
// calls like read_file/search_code are fast GitHub API round-trips.
const MAX_ROUNDS = 10;
const MAX_ATTACHMENTS = 3;
const MAX_BASE64_CHARS = 6_000_000; // ~4.5MB raw, keeps us under Vercel's request body cap
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DOCUMENT_TYPES = new Set(['application/pdf']);

/**
 * Builds the Anthropic content-block array for a user turn, mixing text
 * with any image/PDF attachments the client sent as base64.
 */
function buildUserContent(message, attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length > MAX_ATTACHMENTS) {
    throw new Error(`Too many attachments (max ${MAX_ATTACHMENTS} per message).`);
  }

  const blocks = [];
  for (const att of list) {
    const mediaType = att && att.mediaType;
    const data = att && att.data;
    if (typeof data !== 'string' || !data || data.length > MAX_BASE64_CHARS) {
      throw new Error('Attachment is missing data or exceeds the size limit (~4.5MB).');
    }
    if (IMAGE_TYPES.has(mediaType)) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    } else if (DOCUMENT_TYPES.has(mediaType)) {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: mediaType, data } });
    } else {
      throw new Error(`Unsupported attachment type: ${mediaType}. Only images and PDF are supported.`);
    }
  }

  if (typeof message === 'string' && message.trim()) {
    blocks.push({ type: 'text', text: message });
  }

  return blocks;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    checkAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  let { history, message, resume, attachments, repoConfig } = req.body || {};
  repoConfig = repoConfig && typeof repoConfig === 'object' ? repoConfig : {};

  // .trim() guards against a trailing newline/space sneaking in when a
  // secret is copy-pasted from a mobile notes app into Vercel's env var UI —
  // that stray whitespace otherwise breaks the outgoing HTTP headers and
  // surfaces as an opaque "Connection error." with no useful detail.
  //
  // owner/repo/branch are NOT secret, so the client may override the
  // server's env-var defaults per request (the UI's repo switcher) — only
  // the GitHub token and Anthropic key stay strictly server-side.
  const owner = String(repoConfig.owner || process.env.GITHUB_OWNER || '').trim();
  const repo = String(repoConfig.repo || process.env.GITHUB_REPO || '').trim();
  const branch = String(repoConfig.branch || process.env.GITHUB_BRANCH || 'code-agent').trim();
  const baseBranch = String(repoConfig.baseBranch || process.env.GITHUB_BASE_BRANCH || 'main').trim();
  const githubToken = (process.env.GITHUB_TOKEN || '').trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();

  if (!owner || !repo || !githubToken || !anthropicKey) {
    return res.status(500).json({
      error: 'Server misconfigured: missing GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN / ANTHROPIC_API_KEY env vars.',
    });
  }

  const ctx = { token: githubToken, owner, repo, branch, baseBranch };
  const client = new Anthropic({ apiKey: anthropicKey });
  const systemPrompt = buildSystemPrompt(owner, repo, branch);
  history = Array.isArray(history) ? history : [];

  try {
    if (resume) {
      const outcome = await resolvePending(resume, ctx);
      if (outcome.confirmRequired) {
        return res.status(200).json({ status: 'confirm_required', ...outcome.confirmRequired, history });
      }
      history.push({ role: 'user', content: outcome.results });
    } else if ((typeof message === 'string' && message.trim()) || (Array.isArray(attachments) && attachments.length)) {
      let userContent;
      try {
        userContent = buildUserContent(message, attachments);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      history.push({ role: 'user', content: userContent });
    } else {
      return res.status(400).json({ error: 'Request must include a non-empty "message" or a "resume".' });
    }

    // From here on we stream: the model call itself is the slow part, and
    // writing its text as it arrives (NDJSON lines) is what lets the client
    // render replies incrementally instead of waiting for the whole turn.
    // Once writeHead below fires we can no longer change the HTTP status,
    // so failures past this point are reported as an in-stream error event
    // instead (see the catch block).
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    });
    const emit = (obj) => res.write(JSON.stringify(obj) + '\n');

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stream = client.messages.stream({
        model: process.env.CODE_AGENT_MODEL || 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: history,
        tools: toolSchemas,
      });
      stream.on('text', (delta) => emit({ type: 'text', delta }));

      const response = await stream.finalMessage();
      history.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        const text = response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        emit({ type: 'final', status: 'done', reply: text, history });
        return res.end();
      }

      const blocks = response.content.filter((b) => b.type === 'tool_use');
      const outcome = await processBlocks(blocks, [], ctx);

      if (outcome.confirmRequired) {
        emit({ type: 'final', status: 'confirm_required', ...outcome.confirmRequired, history });
        return res.end();
      }

      history.push({ role: 'user', content: outcome.results });
    }

    emit({
      type: 'final',
      status: 'done',
      reply: `Stopped after ${MAX_ROUNDS} tool rounds in this request to stay under the serverless time limit — send a follow-up to continue.`,
      history,
    });
    return res.end();
  } catch (err) {
    // Log full detail server-side (visible in Vercel's Runtime Logs) since
    // SDK network errors often collapse to a generic "Connection error."
    // with the real cause only available on err.cause.
    console.error('agent.js failure:', err, err && err.cause);
    const causeMessage = err && err.cause && err.cause.message ? ` (${err.cause.message})` : '';
    const message = (err.message || 'Unknown error') + causeMessage;
    if (res.headersSent) {
      res.write(JSON.stringify({ type: 'error', error: message }) + '\n');
      return res.end();
    }
    return res.status(500).json({ error: message });
  }
};

/** Resumes a paused batch after the client approves/denies one mutating tool call. */
async function resolvePending(resume, ctx) {
  const { toolUseId, toolName, input, approved, pendingBlocks, completedResults } = resume;
  const results = Array.isArray(completedResults) ? [...completedResults] : [];

  if (approved) {
    try {
      const content = await execute(toolName, input, ctx);
      results.push({ type: 'tool_result', tool_use_id: toolUseId, content });
    } catch (err) {
      results.push({ type: 'tool_result', tool_use_id: toolUseId, content: err.message, is_error: true });
    }
  } else {
    results.push({
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: 'User denied this action. Do not retry without asking first.',
    });
  }

  return processBlocks(Array.isArray(pendingBlocks) ? pendingBlocks : [], results, ctx);
}

/**
 * Executes safe (read-only) tools immediately. Stops at the first mutating
 * tool call and returns a confirmation payload instead of running it — the
 * caller must round-trip through the client for approval before continuing.
 */
async function processBlocks(blocks, resultsSoFar, ctx) {
  const results = [...resultsSoFar];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (!isMutating(block.name)) {
      try {
        const content = await execute(block.name, block.input, ctx);
        results.push({ type: 'tool_result', tool_use_id: block.id, content });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: block.id, content: err.message, is_error: true });
      }
      continue;
    }

    const preview = await buildPreview(block.name, block.input, ctx);

    if (preview.error) {
      results.push({ type: 'tool_result', tool_use_id: block.id, content: preview.error, is_error: true });
      continue;
    }

    return {
      confirmRequired: {
        toolUseId: block.id,
        toolName: block.name,
        input: block.input,
        preview,
        pendingBlocks: blocks.slice(i + 1),
        completedResults: results,
      },
    };
  }

  return { results };
}

async function buildPreview(name, input, ctx) {
  if (name === 'write_file' || name === 'edit_file') {
    // Branch creation is a no-op if it already exists, and creates an empty
    // ref (no content change) otherwise — safe to do before confirmation.
    // Doing it here (not just inside the real write) matters: without it,
    // the very first write on a not-yet-created branch would diff the
    // proposed content against "file doesn't exist" instead of the real
    // current content inherited from the base branch, showing a misleading
    // all-green diff that looks like a fresh file instead of an overwrite.
    await ensureBranch(ctx.token, ctx.owner, ctx.repo, ctx.branch, ctx.baseBranch);
  }

  if (name === 'write_file') {
    const p = await previewWriteFile(input, ctx);
    return { kind: 'diff', path: p.path, oldContent: p.oldContent, newContent: p.newContent };
  }
  if (name === 'edit_file') {
    const p = await previewEditFile(input, ctx);
    return { kind: 'diff', path: p.path, oldContent: p.oldContent, newContent: p.newContent, error: p.error };
  }
  if (name === 'run_command') {
    return { kind: 'command', command: input.command };
  }
  return { kind: 'raw', input };
}
