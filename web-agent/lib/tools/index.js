'use strict';

// Aggregates every tool module into the single (name, description, schema)
// list the model sees and the single execute(name, input, ctx) dispatcher
// api/agent.js calls. Adding a new module (e.g. lib/tools/securityTools.js)
// means adding one require + one line each below — nothing else in the
// codebase needs to change. See ../../ARCHITECTURE.md.

const fileTools = require('./fileTools');
const execTools = require('./execTools');
const repoTools = require('./repoTools');

const MODULES = [fileTools, execTools, repoTools];

const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);

function isMutating(name) {
  return MUTATING_TOOLS.has(name);
}

const toolSchemas = MODULES.flatMap((m) => m.schemas);

const executors = Object.assign({}, ...MODULES.map((m) => m.execute));

async function execute(name, input, ctx) {
  const fn = executors[name];
  if (!fn) {
    const err = new Error(`Unknown tool: ${name}`);
    err.status = 400;
    throw err;
  }
  return fn(input, ctx);
}

module.exports = {
  toolSchemas,
  execute,
  isMutating,
  previewWriteFile: fileTools.previewWriteFile,
  previewEditFile: fileTools.previewEditFile,
};
