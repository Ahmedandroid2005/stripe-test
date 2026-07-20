'use strict';

const crypto = require('node:crypto');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkAuth(req) {
  const expected = process.env.AGENT_ACCESS_TOKEN;
  if (!expected) {
    const err = new Error('Server misconfigured: AGENT_ACCESS_TOKEN is not set.');
    err.status = 500;
    throw err;
  }
  const header = req.headers['authorization'] || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !safeEqual(provided, expected)) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}

module.exports = { checkAuth };
