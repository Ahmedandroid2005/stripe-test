'use strict';

function validateRelPath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('..')) {
    const err = new Error(`Invalid path: "${p}"`);
    err.status = 400;
    throw err;
  }
  return p;
}

function simpleGlobToRegExp(glob) {
  const escapeRegExp = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const escaped = glob
    .split('**')
    .map((part) => escapeRegExp(part).replace(/\*/g, '[^/]*').replace(/\?/g, '.'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

module.exports = { validateRelPath, simpleGlobToRegExp };
