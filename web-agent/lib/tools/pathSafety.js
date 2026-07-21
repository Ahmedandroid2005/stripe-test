'use strict';

function validateRelPath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('..')) {
    const err = new Error(`Invalid path: "${p}"`);
    err.status = 400;
    throw err;
  }
  return p;
}

// Directories that show up in real-world repos (dependency caches, build
// output, IDE state) but are never useful to read/search/checkout and can
// easily contain tens of thousands of files — enumerating them is what
// makes a request to a real production repo hang or time out, unlike the
// small demo repos this was first tested against.
const IGNORED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'dist',
  'build',
  'out',
  'coverage',
  '.dart_tool',
  'Pods',
  '.gradle',
  '.idea',
  '.vscode',
  '.vercel',
  '.turbo',
  '.cache',
  'DerivedData',
  '.expo',
  'target',
  '__pycache__',
  'vendor',
]);

function isIgnoredPath(p) {
  return p.split('/').some((segment) => IGNORED_SEGMENTS.has(segment));
}

function simpleGlobToRegExp(glob) {
  const escapeLiteral = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Tokenize first, then map each token independently — sequential global
  // string-replace passes are NOT safe here, because a fragment inserted by
  // an earlier pass (e.g. "(?:.*/)?" for "**/") itself contains a "*" that
  // a later pass would then re-match and corrupt.
  const tokens = glob.match(/\*\*\/|\*\*|\*|\?|[^*?]+/g) || [];
  const pattern = tokens
    .map((tok) => {
      // "**/" = this directory or any number of subdirectories, including
      // none — must be optional, or the default "**/*" pattern never
      // matches root-level files like README.md (a real bug this fixes).
      if (tok === '**/') return '(?:.*/)?';
      if (tok === '**') return '.*';
      if (tok === '*') return '[^/]*';
      if (tok === '?') return '.';
      return escapeLiteral(tok);
    })
    .join('');
  return new RegExp(`^${pattern}$`);
}

module.exports = { validateRelPath, simpleGlobToRegExp, isIgnoredPath };
