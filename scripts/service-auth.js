'use strict';

const path = require('path');
const { loadConfig } = require(path.join(__dirname, 'run-sql.js'));
const { serviceAuthHeader } = require(path.join(__dirname, '..', 'shared', 'util', 'service-token.js'));

// Returns { Authorization: 'Bearer <service jwt>' } for a protected stage, or {} for
// local (unprotected). Scripts spread this into their request headers so they pass the
// API authorizer once modules are protected. The JWT_SECRET comes from the stage config
// (loadConfig) — no stored credential. Uses a 1h expiry so a long import/seed run doesn't
// outlive its token.
function serviceAuthHeaders(stage, name) {
  if (!stage || stage === 'local') return {};
  let cfg;
  try {
    cfg = loadConfig(stage);
  } catch {
    return {};
  }
  if (!cfg || !cfg.JWT_SECRET) return {};
  return {
    Authorization: serviceAuthHeader({
      secret: cfg.JWT_SECRET,
      magicKey: cfg.JWT_MAGIC_KEY,
      name: name || 'script',
      expiresIn: '1h',
    }),
  };
}

module.exports = { serviceAuthHeaders };
