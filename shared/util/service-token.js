'use strict';

// Mints a short-lived "service" JWT for machine-to-machine API calls (inter-module
// HTTP calls, dev workers, seed scripts) once the API authorizer is enforced. The
// token is signed with the same JWT_SECRET the auth module uses, so the shared
// verify-token authorizer accepts it. It carries no roles, so in-handler role gates
// (e.g. contact masking) treat it as unprivileged — least privilege for machines.
//
// No long-lived credential is stored: Lambdas already have JWT_SECRET/JWT_MAGIC_KEY
// in their environment; scripts pass them in from loadConfig(stage).
//
//   Lambda (TS/JS):  signServiceToken({ name: 'attendance' })            // reads process.env
//   Script (JS):     signServiceToken({ secret: cfg.JWT_SECRET, magicKey: cfg.JWT_MAGIC_KEY })

const jwt = require('jsonwebtoken');

function signServiceToken(opts = {}) {
  const secret = opts.secret !== undefined ? opts.secret : process.env.JWT_SECRET;
  // JWT_MAGIC_KEY may be undefined in every environment; that's fine — verify-token
  // compares decoded.auth === process.env.JWT_MAGIC_KEY, and both being undefined passes.
  const magicKey = opts.magicKey !== undefined ? opts.magicKey : process.env.JWT_MAGIC_KEY;
  return jwt.sign(
    {
      auth: magicKey,
      // `id` becomes the authorizer principalId → the audit actor (createdby_userid,
      // varchar(12)). 'service' clearly marks a machine write (vs the 'system' fallback
      // that means "no identity"). Keep any custom actorId <= 12 chars.
      id: opts.actorId || 'service',
      type: 'service',
      login_name: opts.name || 'service',
      // Least privilege by default. A call site that genuinely needs a role-gated
      // action opts in explicitly, e.g. serviceAuthHeader({ name, roles: ['admin'] }).
      roles: opts.roles || [],
    },
    secret,
    { expiresIn: opts.expiresIn || '5m' }
  );
}

// Convenience: ready-to-use Authorization header value.
function serviceAuthHeader(opts = {}) {
  return `Bearer ${signServiceToken(opts)}`;
}

module.exports = { signServiceToken, serviceAuthHeader };
