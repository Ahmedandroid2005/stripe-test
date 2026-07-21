'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { checkAuth } = require('../lib/auth');
const { toolSchemas, execute, isMutating, previewWriteFile, previewEditFile } = require('../lib/tools');
const buildSystemPrompt = require('../lib/systemPrompt');

const MAX_ROUNDS = 6;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    checkAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  // .trim() guards against a trailing newline/space sneaking in when a
  // secret is copy-pasted from a mobile notes app into Vercel's env var UI —
  // that stray whitespace otherwise breaks the outgoing HTTP headers and
  // surfaces as an opaque "Connection error." with no useful detail.
  const owner = (process.env.GITHUB_OWNER || '').trim();
  const repo = (process.env.GITHUB_REPO || '').trim();
  const branch = (process.env.GITHUB_BRANCH || 'code-agent').trim();
  const baseBranch = (process.env.GITHUB_BASE_BRANCH || 'main').trim();
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

  let { history, message, resume } = req.body || {};
  history = Array.isArray(history) ? history : [];

  try {
    if (resume) {
      const outcome = await resolvePending(resume, ctx);
      if (outcome.confirmRequired) {
        return res.status(200).json({ status: 'confirm_required', ...outcome.confirmRequired, history });
      }
      history.push({ role: 'user', content: outcome.results });
    } else if (typeof message === 'string' && message.trim()) {
      history.push({ role: 'user', content: message });
    } else {
      return res.status(400).json({ error: 'Request must include a non-empty "message" or a "resume".' });
    }

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await client.messages.create({
        model: process.env.CODE_AGENT_MODEL || 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: history,
        tools: toolSchemas,
      });

      history.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        const text = response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        return res.status(200).json({ status: 'done', reply: text, history });
      }

      const blocks = response.content.filter((b) => b.type === 'tool_use');
      const outcome = await processBlocks(blocks, [], ctx);

      if (outcome.confirmRequired) {
        return res.status(200).json({ status: 'confirm_required', ...outcome.confirmRequired, history });
      }

      history.push({ role: 'user', content: outcome.results });
    }

    return res.status(200).json({
      status: 'done',
      reply: `Stopped after ${MAX_ROUNDS} tool rounds in this request to stay under the serverless time limit — send a follow-up to continue.`,
      history,
    });
  } catch (err) {
    // Log full detail server-side (visible in Vercel's Runtime Logs) since
    // SDK network errors often collapse to a generic "Connection error."
    // with the real cause only available on err.cause.
    console.error('agent.js failure:', err, err && err.cause);
    const causeMessage = err && err.cause && err.cause.message ? ` (${err.cause.message})` : '';
    return res.status(500).json({ error: (err.message || 'Unknown error') + causeMessage });
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
